from __future__ import annotations

import importlib.util
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4


IMPORTER_PATH = Path(__file__).resolve().parents[1] / "import_to_api_postgres.py"
SPEC = importlib.util.spec_from_file_location("migration_importer", IMPORTER_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Migration importer test module could not be loaded.")
IMPORTER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = IMPORTER
SPEC.loader.exec_module(IMPORTER)


class FakeConnection:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[object, ...]]] = []

    async def fetchval(self, sql: str, *values: object) -> object:
        self.calls.append((sql, values))
        return values[0]


class InsertRowsTests(unittest.IsolatedAsyncioTestCase):
    async def test_omits_columns_missing_from_bootstrap_identity_insert(self) -> None:
        timestamp = datetime(2026, 7, 15, 12, 0, tzinfo=timezone.utc)
        profile_identity = {
            "id": uuid4(),
            "email": "profile@example.test",
            "status": "active",
            "created_at": timestamp,
            "updated_at": timestamp,
        }
        bootstrap_identity = {
            "id": uuid4(),
            "email": "bootstrap@example.test",
            "status": "active",
        }
        connection = FakeConnection()
        plan = SimpleNamespace(
            collector=IMPORTER.Collector(),
            report={
                "domains": {
                    "app_users": {
                        "unchanged_count": 0,
                        "conflict_count": 0,
                        "insert_count": 0,
                    },
                },
            },
        )

        with patch.object(IMPORTER, "existing_rows", return_value={}):
            await IMPORTER.insert_rows(
                connection,
                "app_users",
                "id",
                [profile_identity, bootstrap_identity],
                plan,
                "app_users",
            )

        bootstrap_sql, bootstrap_values = next(
            call for call in connection.calls if bootstrap_identity["id"] in call[1]
        )
        self.assertIn('insert into "app_users" ("email", "id", "status")', bootstrap_sql)
        self.assertNotIn('"created_at"', bootstrap_sql)
        self.assertNotIn('"updated_at"', bootstrap_sql)
        self.assertNotIn(None, bootstrap_values)
        self.assertNotIn(timestamp, bootstrap_values)


if __name__ == "__main__":
    unittest.main()
