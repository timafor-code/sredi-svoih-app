from __future__ import annotations

import argparse
import importlib.util
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch


RUNNER_PATH = Path(__file__).resolve().parents[1] / "cleanup_api_source_reviewed.py"
SPEC = importlib.util.spec_from_file_location("migration_api_source_reviewed", RUNNER_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Reviewed cleanup module could not be loaded.")
RUNNER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = RUNNER
SPEC.loader.exec_module(RUNNER)

VALID_URI = "postgresql://sredi_api:sredi_api@api_postgres:5432/sredi_api"


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


def snapshot(protected: int) -> dict:
    return {
        "promoted_table_counts": {},
        "transient_table_counts": {},
        "synthetic_root_candidates": {},
        "protected_synthetic_legal_documents": protected,
        "hygiene": {
            "verdict": "review_required",
            "promoted_summary": {},
            "privacy_history_summary": {},
            "live_state": {"active_deletion_lifecycle_users": 0},
        },
    }


class ApprovalTests(unittest.TestCase):
    def test_review_ack_is_required_only_for_apply(self) -> None:
        RUNNER.require_review_approval(
            argparse.Namespace(apply=False)
        )
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(RUNNER.ReviewedCleanupError):
                RUNNER.require_review_approval(argparse.Namespace(apply=True))
        with patch.dict(
            os.environ,
            {RUNNER.REVIEW_ACK_ENV: RUNNER.REVIEW_ACK},
            clear=True,
        ):
            RUNNER.require_review_approval(argparse.Namespace(apply=True))

    def test_exactly_one_protected_document_is_the_reviewed_state(self) -> None:
        self.assertEqual(RUNNER._assert_exact_reviewed_legal_evidence(snapshot(1)), 1)
        for value in (0, 2, 3):
            with self.subTest(value=value):
                with self.assertRaises(RUNNER.ReviewedCleanupError):
                    RUNNER._assert_exact_reviewed_legal_evidence(snapshot(value))


class TransactionTests(unittest.IsolatedAsyncioTestCase):
    async def _run(self, *, apply: bool, protected: int):
        conn = FakeConnection()
        before = snapshot(protected)
        after = snapshot(protected)
        deleted = {
            "transient_rows_deleted": {},
            "synthetic_roots_deleted": {},
        }
        with (
            patch.dict(os.environ, {"APP_ENV": "local"}, clear=False),
            patch.object(RUNNER.PROMOTE, "connect", AsyncMock(return_value=conn)),
            patch.object(RUNNER.PROMOTE, "configure_stable_session", AsyncMock()),
            patch.object(
                RUNNER.PROMOTE,
                "validate_schema_classification",
                AsyncMock(return_value={}),
            ),
            patch.object(RUNNER.CLEANUP, "_snapshot", AsyncMock(side_effect=[before, after])),
            patch.object(RUNNER.CLEANUP, "_execute_cleanup", AsyncMock(return_value=deleted)),
            patch.object(RUNNER.CLEANUP, "_assert_targeted_cleanup_complete"),
            patch.object(RUNNER.CLEANUP, "_assert_no_active_deletion_lifecycle"),
            patch.object(
                RUNNER.CLEANUP,
                "_build_report",
                return_value={
                    "apply_blocked": True,
                    "notes": ["Referenced deterministic synthetic legal documents are reported as protected and block apply."],
                },
            ),
        ):
            if protected == 1:
                report = await RUNNER.run_reviewed_cleanup(VALID_URI, apply=apply)
                return conn, report
            with self.assertRaises(RUNNER.ReviewedCleanupError):
                await RUNNER.run_reviewed_cleanup(VALID_URI, apply=apply)
            return conn, None

    async def test_apply_commits_when_exact_reviewed_evidence_count_is_one(self) -> None:
        conn, report = await self._run(apply=True, protected=1)
        self.assertTrue(conn.tx.committed)
        self.assertFalse(conn.tx.rolled_back)
        self.assertFalse(report["apply_blocked"])
        self.assertTrue(report["reviewed_legal_evidence_override"])
        self.assertEqual(report["preserved_referenced_legal_documents"], 1)

    async def test_dry_run_rolls_back_with_exact_reviewed_evidence_count(self) -> None:
        conn, report = await self._run(apply=False, protected=1)
        self.assertTrue(conn.tx.rolled_back)
        self.assertFalse(conn.tx.committed)
        self.assertEqual(report["preserved_referenced_legal_documents"], 1)

    async def test_changed_protected_count_rolls_back_before_commit(self) -> None:
        conn, _report = await self._run(apply=True, protected=2)
        self.assertTrue(conn.tx.rolled_back)
        self.assertFalse(conn.tx.committed)


if __name__ == "__main__":
    unittest.main()
