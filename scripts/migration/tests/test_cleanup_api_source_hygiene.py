from __future__ import annotations

import argparse
import importlib.util
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch


CLEANUP_PATH = Path(__file__).resolve().parents[1] / "cleanup_api_source_hygiene.py"
SPEC = importlib.util.spec_from_file_location("migration_api_source_cleanup", CLEANUP_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("API source cleanup module could not be loaded.")
CLEANUP = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = CLEANUP
SPEC.loader.exec_module(CLEANUP)

VALID_URI = "postgresql://sredi_api:sredi_api@api_postgres:5432/sredi_api"


class TargetSafetyTests(unittest.TestCase):
    def test_only_local_app_environment_is_allowed(self) -> None:
        with patch.dict(os.environ, {"APP_ENV": "local"}, clear=True):
            CLEANUP.validate_local_environment()
        for value in ("production", "staging", "", "development"):
            with self.subTest(app_env=value):
                with patch.dict(os.environ, {"APP_ENV": value}, clear=True):
                    with self.assertRaises(CLEANUP.LocalCleanupError):
                        CLEANUP.validate_local_environment()

    def test_exact_local_compose_target_is_allowed(self) -> None:
        CLEANUP.validate_local_source_uri(VALID_URI)
        CLEANUP.validate_local_source_uri(
            "postgresql+asyncpg://sredi_api:sredi_api@api_postgres:5432/sredi_api"
        )

    def test_remote_and_tunneled_targets_are_rejected(self) -> None:
        invalid = (
            "postgresql://sredi_api:x@db.example.com:5432/sredi_api",
            "postgresql://sredi_api:x@127.0.0.1:5432/sredi_api",
            "postgresql://sredi_api:x@localhost:5432/sredi_api",
            "postgresql://prod:x@api_postgres:5432/sredi_api",
            "postgresql://sredi_api:x@api_postgres:5432/production",
            "postgresql://sredi_api:x@api_postgres:5433/sredi_api",
            "postgresql://sredi_api:x@api_postgres:5432/sredi_api?sslmode=require",
            "postgresql://sredi_api:wrong-password@api_postgres:5432/sredi_api",
        )
        for uri in invalid:
            with self.subTest(uri=uri):
                with self.assertRaises(CLEANUP.LocalCleanupError):
                    CLEANUP.validate_local_source_uri(uri)

    def test_cleanup_table_scope_is_reviewed_and_narrow(self) -> None:
        self.assertEqual(
            set(CLEANUP.TRANSIENT_TABLES),
            set(CLEANUP.PROMOTE.EXCLUDED_TABLES),
        )
        self.assertEqual(
            set(CLEANUP.SYNTHETIC_ROOT_TABLES),
            {"app_users", "communities", "events", "event_registrations"},
        )
        self.assertTrue(
            set(CLEANUP.SYNTHETIC_ROOT_TABLES)
            <= set(CLEANUP.PROMOTE.PROMOTED_TABLES)
        )


class ApprovalTests(unittest.TestCase):
    def _args(self, **overrides):
        values = {
            "apply": False,
            "ack_dry_run_reviewed": False,
            "ack_backup_restored": False,
        }
        values.update(overrides)
        return argparse.Namespace(**values)

    def test_dry_run_needs_no_mutation_ack(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            CLEANUP.require_apply_approval(self._args())

    def test_apply_requires_exact_env_ack_and_both_owner_gates(self) -> None:
        args = self._args(
            apply=True,
            ack_dry_run_reviewed=True,
            ack_backup_restored=True,
        )
        with patch.dict(
            os.environ,
            {CLEANUP.ACK_ENV: CLEANUP.APPLY_ACK},
            clear=True,
        ):
            CLEANUP.require_apply_approval(args)

        failure_cases = (
            ({}, args),
            (
                {CLEANUP.ACK_ENV: CLEANUP.APPLY_ACK},
                self._args(apply=True, ack_backup_restored=True),
            ),
            (
                {CLEANUP.ACK_ENV: CLEANUP.APPLY_ACK},
                self._args(apply=True, ack_dry_run_reviewed=True),
            ),
        )
        for env, case_args in failure_cases:
            with self.subTest(env=env, args=case_args):
                with patch.dict(os.environ, env, clear=True):
                    with self.assertRaises(CLEANUP.LocalCleanupError):
                        CLEANUP.require_apply_approval(case_args)

    def test_parser_defaults_to_dry_run(self) -> None:
        args = CLEANUP.build_parser().parse_args([])
        self.assertFalse(args.apply)
        self.assertFalse(args.ack_dry_run_reviewed)
        self.assertFalse(args.ack_backup_restored)


class QuerySafetyTests(unittest.TestCase):
    def test_root_delete_is_parameterized_and_has_where_clause(self) -> None:
        schema = CLEANUP.PROMOTE.TableSchema(
            name="events",
            columns=(("id", "uuid"), ("title", "text"), ("slug", "text")),
            primary_key=("id",),
            dependencies=(),
        )
        query, params = CLEANUP._root_delete_query(schema)
        self.assertTrue(query.startswith('DELETE FROM public."events" WHERE '))
        self.assertIn("ILIKE $1", query)
        self.assertNotIn("%@example.invalid%", query)
        self.assertNotIn("Synthetic %", query)
        self.assertNotIn("%synthetic-%", query)
        self.assertGreater(len(params), 0)

    def test_no_text_root_cannot_match_any_row(self) -> None:
        schema = CLEANUP.PROMOTE.TableSchema(
            name="events",
            columns=(("id", "uuid"),),
            primary_key=("id",),
            dependencies=(),
        )
        query, params = CLEANUP._root_delete_query(schema)
        self.assertEqual(query, 'DELETE FROM public."events" WHERE FALSE')
        self.assertEqual(params, ())

    def test_durable_root_delete_is_never_blanket(self) -> None:
        source = CLEANUP_PATH.read_text(encoding="utf-8")
        self.assertNotIn('DELETE FROM public."app_users"', source)
        self.assertNotIn('DELETE FROM public."events"', source)
        self.assertNotIn("TRUNCATE ", source.upper())


class FakeTransaction:
    def __init__(self) -> None:
        self.started = False
        self.committed = False
        self.rolled_back = False

    async def start(self) -> None:
        self.started = True

    async def commit(self) -> None:
        self.committed = True

    async def rollback(self) -> None:
        self.rolled_back = True


class FakeConnection:
    def __init__(self) -> None:
        self.tx = FakeTransaction()
        self.closed = False

    def transaction(self, **_kwargs):
        return self.tx

    async def close(self) -> None:
        self.closed = True


class TransactionTests(unittest.IsolatedAsyncioTestCase):
    def _snapshot(self, verdict: str = "review_required"):
        return {
            "promoted_table_counts": {},
            "transient_table_counts": {name: 0 for name in CLEANUP.TRANSIENT_TABLES},
            "synthetic_root_candidates": {
                name: 0 for name in CLEANUP.SYNTHETIC_ROOT_TABLES
            },
            "hygiene": {
                "verdict": verdict,
                "promoted_summary": {},
                "privacy_history_summary": {},
                "live_state": {},
            },
        }

    async def test_dry_run_rolls_back_exact_simulation(self) -> None:
        conn = FakeConnection()
        before = self._snapshot()
        after = self._snapshot("no_direct_hygiene_blockers_detected")
        with (
            patch.dict(os.environ, {"APP_ENV": "local"}, clear=False),
            patch.object(CLEANUP.PROMOTE, "connect", AsyncMock(return_value=conn)),
            patch.object(CLEANUP.PROMOTE, "configure_stable_session", AsyncMock()),
            patch.object(
                CLEANUP.PROMOTE,
                "validate_schema_classification",
                AsyncMock(return_value={}),
            ),
            patch.object(CLEANUP, "_snapshot", AsyncMock(side_effect=[before, after])),
            patch.object(
                CLEANUP,
                "_execute_cleanup",
                AsyncMock(
                    return_value={
                        "transient_rows_deleted": {},
                        "synthetic_roots_deleted": {},
                    }
                ),
            ),
        ):
            report = await CLEANUP.run_cleanup(VALID_URI, apply=False)

        self.assertTrue(conn.tx.started)
        self.assertTrue(conn.tx.rolled_back)
        self.assertFalse(conn.tx.committed)
        self.assertTrue(conn.closed)
        self.assertFalse(report["cleanup_performed"])
        self.assertTrue(report["simulation_performed"])

    async def test_apply_commits_only_after_post_cleanup_assertion(self) -> None:
        conn = FakeConnection()
        before = self._snapshot()
        after = self._snapshot("no_direct_hygiene_blockers_detected")
        with (
            patch.dict(os.environ, {"APP_ENV": "local"}, clear=False),
            patch.object(CLEANUP.PROMOTE, "connect", AsyncMock(return_value=conn)),
            patch.object(CLEANUP.PROMOTE, "configure_stable_session", AsyncMock()),
            patch.object(
                CLEANUP.PROMOTE,
                "validate_schema_classification",
                AsyncMock(return_value={}),
            ),
            patch.object(CLEANUP, "_snapshot", AsyncMock(side_effect=[before, after])),
            patch.object(
                CLEANUP,
                "_execute_cleanup",
                AsyncMock(
                    return_value={
                        "transient_rows_deleted": {},
                        "synthetic_roots_deleted": {},
                    }
                ),
            ),
        ):
            report = await CLEANUP.run_cleanup(VALID_URI, apply=True)

        self.assertTrue(conn.tx.started)
        self.assertTrue(conn.tx.committed)
        self.assertFalse(conn.tx.rolled_back)
        self.assertTrue(conn.closed)
        self.assertTrue(report["cleanup_performed"])
        self.assertFalse(report["simulation_performed"])

    async def test_failure_rolls_back(self) -> None:
        conn = FakeConnection()
        before = self._snapshot()
        with (
            patch.dict(os.environ, {"APP_ENV": "local"}, clear=False),
            patch.object(CLEANUP.PROMOTE, "connect", AsyncMock(return_value=conn)),
            patch.object(CLEANUP.PROMOTE, "configure_stable_session", AsyncMock()),
            patch.object(
                CLEANUP.PROMOTE,
                "validate_schema_classification",
                AsyncMock(return_value={}),
            ),
            patch.object(CLEANUP, "_snapshot", AsyncMock(return_value=before)),
            patch.object(
                CLEANUP,
                "_execute_cleanup",
                AsyncMock(side_effect=CLEANUP.LocalCleanupError("synthetic failure")),
            ),
        ):
            with self.assertRaises(CLEANUP.LocalCleanupError):
                await CLEANUP.run_cleanup(VALID_URI, apply=True)

        self.assertTrue(conn.tx.rolled_back)
        self.assertFalse(conn.tx.committed)
        self.assertTrue(conn.closed)


if __name__ == "__main__":
    unittest.main()
