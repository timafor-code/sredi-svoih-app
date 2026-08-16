from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


PROMOTE_PATH = Path(__file__).resolve().parents[1] / "promote_api_data.py"
SPEC = importlib.util.spec_from_file_location("migration_api_promotion", PROMOTE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("API promotion test module could not be loaded.")
PROMOTE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = PROMOTE
SPEC.loader.exec_module(PROMOTE)


class ConfigurationTests(unittest.TestCase):
    def test_help_does_not_require_pg_environment(self) -> None:
        with patch.dict(os.environ, {}, clear=True), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(SystemExit) as raised:
                PROMOTE.build_parser().parse_args(["--help"])
        self.assertEqual(raised.exception.code, 0)

    def test_sqlalchemy_asyncpg_uri_is_normalized_for_asyncpg(self) -> None:
        self.assertEqual(
            PROMOTE.normalize_pg_uri(
                "postgresql+asyncpg://owner:secret@api_postgres:5432/sredi_api"
            ),
            "postgresql://owner:secret@api_postgres:5432/sredi_api",
        )

    def test_pg_uri_is_owner_environment_only(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(PROMOTE.PromotionError, PROMOTE.DEFAULT_PG_ENV):
                PROMOTE.load_pg_uri(PROMOTE.DEFAULT_PG_ENV)

        with patch.dict(
            os.environ,
            {"SOURCE_PROMOTION_PG_URI": "postgresql://owner@localhost:55432/sredi_api"},
            clear=True,
        ):
            self.assertEqual(
                PROMOTE.load_pg_uri("SOURCE_PROMOTION_PG_URI"),
                "postgresql://owner@localhost:55432/sredi_api",
            )

    def test_export_and_apply_acknowledgements_are_separate(self) -> None:
        with patch.dict(os.environ, {PROMOTE.ACK_ENV: PROMOTE.EXPORT_ACK}, clear=True):
            PROMOTE.require_ack(PROMOTE.EXPORT_ACK)
            with self.assertRaises(PROMOTE.PromotionError):
                PROMOTE.require_ack(PROMOTE.APPLY_ACK)

    def test_unsafe_environment_variable_name_is_rejected(self) -> None:
        with self.assertRaisesRegex(PROMOTE.PromotionError, "environment variable name"):
            PROMOTE.load_pg_uri("PROMOTION_URI;echo")


class ClassificationTests(unittest.TestCase):
    def test_promoted_and_excluded_tables_are_disjoint(self) -> None:
        self.assertFalse(set(PROMOTE.PROMOTED_TABLES) & set(PROMOTE.EXCLUDED_TABLES))

    def test_required_durable_product_graph_is_promoted(self) -> None:
        required = {
            "app_users",
            "profiles",
            "community_memberships",
            "communities",
            "events",
            "event_occurrences",
            "event_participation_options",
            "event_capacity_units",
            "event_registrations",
            "event_registration_answers",
            "event_seating_layouts",
            "event_seating_assignments",
            "legal_documents",
            "legal_acceptances",
            "prayer_activity_logs",
            "profile_avatars",
            "event_images",
        }
        self.assertTrue(required <= set(PROMOTE.PROMOTED_TABLES))

    def test_secret_bound_and_transient_tables_are_excluded(self) -> None:
        required = {
            "auth_sessions",
            "auth_email_verification_codes",
            "password_reset_codes",
            "auth_set_password_codes",
            "invites",
            "privacy_access_codes",
            "privacy_access_sessions",
            "web_registration_intents",
            "web_registration_verification_codes",
            "device_tokens",
            "push_notification_jobs",
            "push_notification_deliveries",
        }
        self.assertTrue(required <= set(PROMOTE.EXCLUDED_TABLES))

    def test_app_users_remains_promoted_so_argon2_password_hashes_are_preserved(self) -> None:
        self.assertIn("app_users", PROMOTE.PROMOTED_TABLES)
        self.assertNotIn("app_users", PROMOTE.EXCLUDED_TABLES)


class GraphTests(unittest.TestCase):
    def test_topological_order_places_dependencies_first(self) -> None:
        schemas = {
            "users": PROMOTE.TableSchema(
                name="users",
                columns=(("id", "uuid"),),
                primary_key=("id",),
                dependencies=(),
            ),
            "profiles": PROMOTE.TableSchema(
                name="profiles",
                columns=(("id", "uuid"), ("user_id", "uuid")),
                primary_key=("id",),
                dependencies=("users",),
            ),
            "registrations": PROMOTE.TableSchema(
                name="registrations",
                columns=(("id", "uuid"), ("user_id", "uuid")),
                primary_key=("id",),
                dependencies=("users",),
            ),
        }
        order = PROMOTE.topological_order(set(schemas), schemas)
        self.assertLess(order.index("users"), order.index("profiles"))
        self.assertLess(order.index("users"), order.index("registrations"))

    def test_topological_order_fails_on_cycle(self) -> None:
        schemas = {
            "a": PROMOTE.TableSchema("a", (("id", "uuid"),), ("id",), ("b",)),
            "b": PROMOTE.TableSchema("b", (("id", "uuid"),), ("id",), ("a",)),
        }
        with self.assertRaisesRegex(PROMOTE.PromotionError, "cycle"):
            PROMOTE.topological_order(set(schemas), schemas)


class ArtifactValidationTests(unittest.TestCase):
    def test_jsonl_validation_rejects_duplicate_primary_key(self) -> None:
        entry = {
            "name": "events",
            "columns": [
                {"name": "id", "type": "uuid"},
                {"name": "title", "type": "text"},
            ],
            "primary_key": ["id"],
            "row_count": 2,
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "events.jsonl"
            path.write_text(
                json.dumps({"id": "same", "title": "First"})
                + "\n"
                + json.dumps({"id": "same", "title": "Second"})
                + "\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(PROMOTE.PromotionError, "Duplicate primary key"):
                PROMOTE.validate_jsonl(entry, path)

    def test_jsonl_validation_rejects_column_mismatch(self) -> None:
        entry = {
            "name": "events",
            "columns": [
                {"name": "id", "type": "uuid"},
                {"name": "title", "type": "text"},
            ],
            "primary_key": ["id"],
            "row_count": 1,
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "events.jsonl"
            path.write_text(json.dumps({"id": "one"}) + "\n", encoding="utf-8")
            with self.assertRaisesRegex(PROMOTE.PromotionError, "Column mismatch"):
                PROMOTE.validate_jsonl(entry, path)

    def test_object_storage_metadata_requires_explicit_ready_ack(self) -> None:
        manifest = {"object_storage": {"requires_object_copy": True}}
        with self.assertRaisesRegex(PROMOTE.PromotionError, "object keys"):
            PROMOTE.require_object_storage_ack(manifest, False)
        PROMOTE.require_object_storage_ack(manifest, True)


if __name__ == "__main__":
    unittest.main()
