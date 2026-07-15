from __future__ import annotations

import asyncio
import contextlib
import importlib.util
import io
import json
import os
import re
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4


COMPARE_PATH = Path(__file__).resolve().parents[1] / "compare_shadow_reads.py"
SPEC = importlib.util.spec_from_file_location("migration_shadow_compare", COMPARE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Shadow comparison test module could not be loaded.")
COMPARE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = COMPARE
SPEC.loader.exec_module(COMPARE)


def local_environment(source: str = "postgresql://owner@localhost:5432/source", target: str = "postgresql://owner@localhost:5433/target") -> dict[str, str]:
    return {
        COMPARE.ACK_ENV: COMPARE.ACKNOWLEDGEMENT,
        COMPARE.SOURCE_ENV: source,
        COMPARE.TARGET_ENV: target,
    }


class SingleOperationFakeConnection:
    """Fail deterministically if two operations overlap on this connection."""

    def __init__(self, fetch_rows: list[dict[str, object]] | None = None) -> None:
        self.active_operations: list[str] = []
        self.max_active_operations = 0
        self.operations: list[str] = []
        self.fetch_rows = fetch_rows or []

    async def _operation(self, operation: str, result: object) -> object:
        if self.active_operations:
            raise RuntimeError("same-connection async operation overlap")
        self.active_operations.append(operation)
        self.max_active_operations = max(self.max_active_operations, len(self.active_operations))
        try:
            await asyncio.sleep(0)
            self.operations.append(operation)
            return result
        finally:
            self.active_operations.pop()

    async def fetchval(self, statement: str) -> int:
        return await self._operation("fetchval", 0)  # type: ignore[return-value]

    async def fetchrow(self, statement: str, *values: object) -> dict[str, int]:
        return await self._operation("fetchrow", {
            "total_count": 0,
            "directory_true_count": 0,
            "phone_true_count": 0,
            "email_true_count": 0,
            "birth_date_true_count": 0,
            "hebrew_birth_date_true_count": 0,
            "city_true_count": 0,
            "hebrew_name_true_count": 0,
            "birthday_reminders_true_count": 0,
        })  # type: ignore[return-value]

    async def fetch(self, statement: str, *values: object) -> list[dict[str, object]]:
        return await self._operation("fetch", self.fetch_rows)  # type: ignore[return-value]


class ConnectionConcurrencyTests(unittest.TestCase):
    def assert_runs_without_same_connection_overlap(self, callback: object, schema: dict[tuple[str, str], set[str]], expected_operations: int) -> None:
        source = SingleOperationFakeConnection()
        target = SingleOperationFakeConnection()
        result = asyncio.run(callback(source, target, schema, schema))  # type: ignore[operator]
        self.assertEqual(result["status"], "matched")
        for connection in (source, target):
            self.assertEqual(connection.max_active_operations, 1)
            self.assertEqual(connection.active_operations, [])
            self.assertEqual(len(connection.operations), expected_operations)

    def test_compare_seating_sequences_each_connection(self) -> None:
        schema = {
            ("public", "event_seating_layout_templates"): {"id"},
            ("public", "event_seating_layouts"): {"id", "event_id", "occurrence_id", "capacity_unit_id"},
            ("public", "event_seating_tables"): {"id", "layout_id"},
            ("public", "event_seating_table_connections"): {"id", "layout_id"},
            ("public", "event_seating_assignments"): {"id", "layout_id"},
        }
        self.assert_runs_without_same_connection_overlap(COMPARE.compare_seating, schema, 9)

    def test_compare_contacts_sequences_each_connection(self) -> None:
        schema = {
            ("public", "community_contacts"): {"id", "community_id"},
            ("public", "profile_contact_visibility"): {"user_id", "show_in_community_directory", "share_phone", "share_email", "share_birth_date", "share_hebrew_birth_date", "share_city", "share_hebrew_name", "birthday_reminders_enabled"},
            ("public", "synced_contacts"): {"id", "user_id"},
        }
        self.assert_runs_without_same_connection_overlap(COMPARE.compare_contacts, schema, 5)

    def test_compare_device_tokens_sequences_each_connection(self) -> None:
        schema = {("public", "device_tokens"): {"id", "is_active", "environment", "platform", "push_provider"}}
        self.assert_runs_without_same_connection_overlap(COMPARE.compare_device_tokens, schema, 5)

    def test_compare_push_jobs_sequences_each_connection(self) -> None:
        schema = {("public", "push_notification_jobs"): {"id", "status", "notification_kind", "audience"}}
        self.assert_runs_without_same_connection_overlap(COMPARE.compare_push_jobs, schema, 4)


class ConfigurationTests(unittest.TestCase):
    def test_help_does_not_require_environment_variables(self) -> None:
        with patch.dict(os.environ, {}, clear=True), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(SystemExit) as raised:
                COMPARE.build_parser().parse_args(["--help"])
        self.assertEqual(raised.exception.code, 0)

    def test_missing_acknowledgement_fails_closed(self) -> None:
        environment = local_environment()
        environment.pop(COMPARE.ACK_ENV)
        with patch.dict(os.environ, environment, clear=True):
            with self.assertRaisesRegex(COMPARE.ShadowCompareError, COMPARE.ACK_ENV):
                COMPARE.validate_owner_environment(False, False)

    def test_missing_source_and_target_urls_fail_closed(self) -> None:
        with patch.dict(os.environ, {COMPARE.ACK_ENV: COMPARE.ACKNOWLEDGEMENT}, clear=True):
            with self.assertRaisesRegex(COMPARE.ShadowCompareError, COMPARE.SOURCE_ENV):
                COMPARE.validate_owner_environment(False, False)
        source_only = local_environment()
        source_only.pop(COMPARE.TARGET_ENV)
        with patch.dict(os.environ, source_only, clear=True):
            with self.assertRaisesRegex(COMPARE.ShadowCompareError, COMPARE.TARGET_ENV):
                COMPARE.validate_owner_environment(False, False)

    def test_identical_source_and_target_urls_are_rejected(self) -> None:
        value = "postgresql://owner@localhost:5432/shadow"
        with patch.dict(os.environ, local_environment(value, value), clear=True):
            with self.assertRaisesRegex(COMPARE.ShadowCompareError, "same database endpoint"):
                COMPARE.validate_owner_environment(False, False)

    def test_hosted_source_and_target_approval_boundaries_are_independent(self) -> None:
        source_hosted = local_environment("postgresql://owner@source.example.test/shadow", "postgresql://owner@localhost/target")
        with patch.dict(os.environ, source_hosted, clear=True):
            with self.assertRaisesRegex(COMPARE.ShadowCompareError, "Hosted source"):
                COMPARE.validate_owner_environment(False, False)
            settings = COMPARE.validate_owner_environment(True, False)
        self.assertTrue(settings.source_hosted)
        self.assertFalse(settings.target_hosted)

        target_hosted = local_environment("postgresql://owner@localhost/source", "postgresql://owner@target.example.test/shadow")
        with patch.dict(os.environ, target_hosted, clear=True):
            with self.assertRaisesRegex(COMPARE.ShadowCompareError, "Hosted target"):
                COMPARE.validate_owner_environment(False, False)
            settings = COMPARE.validate_owner_environment(False, True)
        self.assertFalse(settings.source_hosted)
        self.assertTrue(settings.target_hosted)

    def test_local_connection_classification(self) -> None:
        for hostname in ("localhost", "127.0.0.1", "host.docker.internal", "api.local"):
            self.assertFalse(COMPARE.is_hosted_connection(f"postgresql://owner@{hostname}/shadow"))
        self.assertTrue(COMPARE.is_hosted_connection("postgresql://owner@db.example.test/shadow"))


class AggregateComparisonTests(unittest.TestCase):
    def test_aggregate_comparison_reports_matched_mismatched_and_incomplete_states(self) -> None:
        matched = COMPARE.completed_domain({"totalCount": 4}, {"totalCount": 4}, {"totalCountMismatchCount": 0})
        mismatched = COMPARE.completed_domain({"totalCount": 4}, {"totalCount": 3}, {"totalCountMismatchCount": 1})
        incomplete = COMPARE.incomplete_domain("required_schema_unavailable")
        self.assertEqual(matched["status"], "matched")
        self.assertEqual(mismatched["status"], "mismatched")
        self.assertEqual(incomplete["status"], "incomplete")
        report = COMPARE.make_report({"events": matched, "registrations": mismatched, "avatars": incomplete})
        self.assertEqual(report["outcome"], "incomplete")
        self.assertEqual(report["summary"], {"matchedDomains": 1, "mismatchedDomains": 1, "incompleteDomains": 1})

    def test_per_user_signature_mismatch_exposes_only_a_count(self) -> None:
        first_user = uuid4()
        second_user = uuid4()
        source = {(first_user,): 4, (second_user,): 1}
        target = {(first_user,): 4, (second_user,): 2}
        mismatch_count = COMPARE.count_differences(source, target)
        domain = COMPARE.completed_domain({"totalCount": 5}, {"totalCount": 6}, {"perUserCountMismatchCount": mismatch_count})
        serialized = json.dumps(COMPARE.make_report({"prayerTracker": domain}))
        self.assertEqual(mismatch_count, 1)
        self.assertNotIn(str(first_user), serialized)
        self.assertNotIn(str(second_user), serialized)

    def test_capacity_bucket_comparison_exposes_only_aggregate_mismatches(self) -> None:
        first_bucket = (uuid4(), None, uuid4())
        second_bucket = (uuid4(), uuid4(), uuid4())
        source = {first_bucket: (12, 2, 5, 2)}
        target = {first_bucket: (12, 3, 6, 2), second_bucket: (8, 0, 0, 0)}
        comparison = COMPARE.compare_capacity_bucket_sets(source, target)
        report = COMPARE.make_report({"capacityBuckets": COMPARE.completed_domain(COMPARE.capacity_totals(source), COMPARE.capacity_totals(target), comparison)})
        serialized = json.dumps(report)
        self.assertEqual(comparison["matchedBucketCount"], 0)
        self.assertEqual(comparison["missingSourceBucketCount"], 1)
        self.assertEqual(comparison["missingTargetBucketCount"], 0)
        self.assertEqual(comparison["mismatchedBucketCount"], 1)
        for bucket_part in (*first_bucket, *second_bucket):
            if bucket_part is not None:
                self.assertNotIn(str(bucket_part), serialized)

    def test_capacity_buckets_preserve_unlimited_capacity_semantics(self) -> None:
        bucket = ("event", "occurrence", "unit")
        unlimited = {bucket: (None, 2, 5, 2)}
        numeric = {bucket: (12, 2, 5, 2)}
        self.assertEqual(COMPARE.compare_capacity_bucket_sets(unlimited, unlimited), {
            "matchedBucketCount": 1,
            "missingSourceBucketCount": 0,
            "missingTargetBucketCount": 0,
            "mismatchedBucketCount": 0,
        })
        self.assertEqual(COMPARE.compare_capacity_bucket_sets(unlimited, numeric)["mismatchedBucketCount"], 1)
        self.assertEqual(COMPARE.compare_capacity_bucket_sets(numeric, unlimited)["mismatchedBucketCount"], 1)
        self.assertEqual(COMPARE.compare_capacity_bucket_sets(numeric, numeric)["matchedBucketCount"], 1)

    def test_capacity_bucket_adapter_and_totals_keep_unlimited_capacity_distinct_from_zero(self) -> None:
        connection = SingleOperationFakeConnection([
            {"event_id": "event-a", "occurrence_id": None, "capacity_unit_id": "unit-a", "configured_capacity": None, "reservation_count": 1, "occupied_seats": 2, "represented_registration_count": 1},
            {"event_id": "event-b", "occurrence_id": None, "capacity_unit_id": "unit-b", "configured_capacity": 12, "reservation_count": 2, "occupied_seats": 3, "represented_registration_count": 2},
            {"event_id": "event-c", "occurrence_id": None, "capacity_unit_id": "unit-c", "configured_capacity": 8, "reservation_count": 0, "occupied_seats": 0, "represented_registration_count": 0},
        ])
        buckets = asyncio.run(COMPARE.read_capacity_buckets(connection))
        self.assertIsNone(buckets[("event-a", None, "unit-a")][0])
        self.assertEqual(COMPARE.capacity_totals(buckets), {
            "totalBucketCount": 3,
            "limitedBucketCount": 2,
            "unlimitedBucketCount": 1,
            "limitedConfiguredCapacity": 20,
            "occupiedSeats": 5,
            "reservationCount": 3,
        })


class ReportSafetyTests(unittest.TestCase):
    def test_generated_report_has_no_representative_pii_token_or_identifier_values(self) -> None:
        report = COMPARE.make_report({"events": COMPARE.completed_domain({"totalCount": 2}, {"totalCount": 2}, {"totalCountMismatchCount": 0})})
        with tempfile.TemporaryDirectory() as temporary_directory:
            destination = COMPARE.write_report(report, temporary_directory)
            serialized = destination.read_text(encoding="utf-8")
        forbidden_values = (
            "person@example.test",
            "+79991234567",
            "ExponentPushToken[secret]",
            "123e4567-e89b-12d3-a456-426614174000",
            "postgresql://owner:secret@localhost/shadow",
            "Sensitive prayer content",
        )
        for forbidden in forbidden_values:
            self.assertNotIn(forbidden, serialized)

    def test_privacy_validation_rejects_representative_unsafe_values(self) -> None:
        for unsafe_value in ("person@example.test", "+79991234567", "ExponentPushToken[secret]", "123e4567-e89b-12d3-a456-426614174000", "postgresql://owner:secret@localhost/shadow"):
            with self.assertRaises(COMPARE.ShadowCompareError):
                COMPARE.assert_safe_report({"unsafe": unsafe_value})

    def test_existing_reports_are_not_overwritten(self) -> None:
        timestamp = datetime(2026, 7, 15, 12, 0, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as temporary_directory:
            destination = COMPARE.prepare_report_path(temporary_directory, timestamp)
            destination.write_text("existing", encoding="utf-8")
            with self.assertRaisesRegex(COMPARE.ShadowCompareError, "will not be overwritten"):
                COMPARE.prepare_report_path(temporary_directory, timestamp)
            self.assertEqual(destination.read_text(encoding="utf-8"), "existing")

    def test_symlink_report_paths_are_rejected(self) -> None:
        timestamp = datetime(2026, 7, 15, 12, 0, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            real_directory = root / "real"
            real_directory.mkdir()
            linked_directory = root / "linked"
            try:
                linked_directory.symlink_to(real_directory, target_is_directory=True)
            except OSError as exc:
                self.skipTest(f"Symbolic links are unavailable in this test environment: {exc}")
            with self.assertRaisesRegex(COMPARE.ShadowCompareError, "symbolic link"):
                COMPARE.prepare_report_path(str(linked_directory), timestamp)

            report_file = COMPARE.prepare_report_path(str(real_directory), timestamp)
            report_file.symlink_to(root / "not-a-report")
            with self.assertRaisesRegex(COMPARE.ShadowCompareError, "symbolic link"):
                COMPARE.prepare_report_path(str(real_directory), timestamp)


class QuerySafetyTests(unittest.TestCase):
    def test_comparison_query_layer_contains_no_write_sql(self) -> None:
        statements = [COMPARE.SCHEMA_SQL, *COMPARE.SQL.values()]
        for statement in statements:
            self.assertRegex(statement.lstrip().lower(), r"^(select|with)\b")
            self.assertIsNone(re.search(r"\b(insert|update|delete|truncate|create|alter|drop|call)\b", statement, flags=re.IGNORECASE))


if __name__ == "__main__":
    unittest.main()
