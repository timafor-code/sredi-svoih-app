from __future__ import annotations

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
