from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


AUDIT_PATH = Path(__file__).resolve().parents[1] / "audit_api_source_hygiene.py"
SPEC = importlib.util.spec_from_file_location("migration_api_source_hygiene", AUDIT_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("API source hygiene audit module could not be loaded.")
AUDIT = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = AUDIT
SPEC.loader.exec_module(AUDIT)


class ClassificationTests(unittest.TestCase):
    def test_all_promoted_tables_are_audited(self) -> None:
        self.assertEqual(
            set(AUDIT.AUDITED_PROMOTED_TABLES),
            set(AUDIT.PROMOTE.PROMOTED_TABLES),
        )
        self.assertTrue(AUDIT.AUDITED_PROMOTED_TABLES)

    def test_privacy_history_tables_are_explicitly_excluded_from_promotion(self) -> None:
        self.assertTrue(
            set(AUDIT.PRIVACY_HISTORY_TABLES)
            <= set(AUDIT.PROMOTE.EXCLUDED_TABLES),
        )

    def test_privacy_review_evidence_is_part_of_privacy_history(self) -> None:
        self.assertIn(
            "privacy_financial_review_evidence",
            AUDIT.PRIVACY_HISTORY_TABLES,
        )

    def test_text_columns_only_returns_textual_schema_columns(self) -> None:
        schema = AUDIT.PROMOTE.TableSchema(
            name="events",
            columns=(
                ("id", "uuid"),
                ("title", "text"),
                ("slug", "character varying(255)"),
                ("starts_at", "timestamp with time zone"),
            ),
            primary_key=("id",),
            dependencies=(),
        )
        self.assertEqual(AUDIT.text_columns(schema), ("title", "slug"))


class QuerySafetyTests(unittest.TestCase):
    def test_signature_query_is_count_only_and_parameterized(self) -> None:
        query, params = AUDIT._count_query_for_ilike(
            "events",
            ("title", "description"),
            "%synthetic-%",
        )
        self.assertTrue(query.startswith('SELECT count(*) FROM public."events"'))
        self.assertNotIn("%synthetic-%", query)
        self.assertEqual(params, ("%synthetic-%", "%synthetic-%"))

    def test_exact_privacy_fixture_query_is_parameterized(self) -> None:
        query, params = AUDIT._count_query_for_exact(
            "privacy_requests",
            "message",
            "Synthetic own request",
        )
        self.assertTrue(
            query.startswith('SELECT count(*) FROM public."privacy_requests"'),
        )
        self.assertNotIn("Synthetic own request", query)
        self.assertEqual(params, ("Synthetic own request",))

    def test_no_text_columns_returns_row_independent_constant_select(self) -> None:
        query, params = AUDIT._count_query_for_ilike(
            "event_capacity_units",
            (),
            "%synthetic-%",
        )
        self.assertEqual(query, "SELECT 0::bigint")
        self.assertEqual(params, ())

    def test_combined_query_without_signatures_is_row_independent(self) -> None:
        query, params = AUDIT._combined_direct_query(
            "event_capacity_units",
            (),
            include_privacy_messages=False,
        )
        self.assertEqual(query, "SELECT 0::bigint")
        self.assertEqual(params, ())

    def test_audit_module_has_no_direct_database_write_call(self) -> None:
        source = AUDIT_PATH.read_text(encoding="utf-8")
        self.assertNotIn("conn.execute(", source)
        self.assertNotIn("conn.executemany(", source)
        self.assertNotIn("conn.copy_", source)


class AsyncQuerySafetyTests(unittest.IsolatedAsyncioTestCase):
    async def test_missing_scalar_result_fails_closed(self) -> None:
        class EmptyResultConnection:
            async def fetchval(self, _query, *_params):
                return None

        with self.assertRaisesRegex(
            AUDIT.HygieneAuditError,
            "returned no scalar result",
        ):
            await AUDIT._fetch_count(
                EmptyResultConnection(),
                "SELECT 0::bigint",
            )


class ReportTests(unittest.TestCase):
    def test_report_requires_review_for_direct_synthetic_rows(self) -> None:
        promoted = [
            AUDIT.TableAudit(
                table="events",
                row_count=10,
                direct_synthetic_rows=2,
                unclassified_rows=8,
                signature_hits={"synthetic_label_prefix": 2},
            ),
        ]
        privacy = [
            AUDIT.TableAudit(
                table="privacy_requests",
                row_count=0,
                direct_synthetic_rows=0,
                unclassified_rows=0,
                signature_hits={},
            ),
        ]
        live = AUDIT.LiveStateAudit(0, 0, 0, 0)
        report = AUDIT.build_report(promoted, privacy, live)
        self.assertEqual(report["verdict"], "review_required")
        self.assertFalse(report["cleanup_performed"])
        self.assertFalse(report["automatic_cleanup_allowed"])
        self.assertEqual(
            report["promoted_summary"]["direct_synthetic_rows"],
            2,
        )

    def test_any_privacy_history_requires_review_even_without_direct_signature(self) -> None:
        promoted: list[AUDIT.TableAudit] = []
        privacy = [
            AUDIT.TableAudit(
                table="privacy_destruction_evidence",
                row_count=1,
                direct_synthetic_rows=0,
                unclassified_rows=1,
                signature_hits={},
            ),
        ]
        live = AUDIT.LiveStateAudit(0, 0, 0, 0)
        report = AUDIT.build_report(promoted, privacy, live)
        self.assertEqual(report["verdict"], "review_required")

    def test_clean_aggregate_state_has_no_direct_hygiene_blockers(self) -> None:
        report = AUDIT.build_report(
            [],
            [],
            AUDIT.LiveStateAudit(0, 0, 0, 0),
        )
        self.assertEqual(
            report["verdict"],
            "no_direct_hygiene_blockers_detected",
        )

    def test_report_contains_counts_not_database_values(self) -> None:
        report = AUDIT.build_report(
            [
                AUDIT.TableAudit(
                    table="profiles",
                    row_count=5,
                    direct_synthetic_rows=1,
                    unclassified_rows=4,
                    signature_hits={"reserved_invalid_domain": 1},
                ),
            ],
            [],
            AUDIT.LiveStateAudit(0, 0, 0, 0),
        )
        rendered = repr(report)
        self.assertNotIn("@example.invalid", rendered)
        self.assertNotIn("Synthetic own request", rendered)
        self.assertIn("reserved_invalid_domain", rendered)


class SignatureTests(unittest.TestCase):
    def test_known_privacy_fixture_signatures_are_explicit(self) -> None:
        self.assertEqual(
            dict(AUDIT.KNOWN_PRIVACY_REQUEST_MESSAGES),
            {
                "privacy_fixture_own_request": "Synthetic own request",
                "privacy_fixture_ordinary_request": "Synthetic ordinary request",
            },
        )

    def test_reserved_invalid_domain_is_high_confidence_signature(self) -> None:
        signatures = dict(AUDIT.GENERIC_SIGNATURES)
        self.assertEqual(
            signatures["reserved_invalid_domain"],
            "%@example.invalid%",
        )


if __name__ == "__main__":
    unittest.main()
