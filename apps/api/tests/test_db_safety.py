from __future__ import annotations

import unittest

from tests.db_safety import DatabaseSafetyError, validate_test_database_environment


class TestDatabaseSafetyTests(unittest.TestCase):
    def test_accepts_dedicated_test_database(self) -> None:
        validate_test_database_environment(
            app_env="test",
            db_dsn=(
                "postgresql+asyncpg://sredi_api_test:synthetic-secret@"
                "api_test_postgres:5432/sredi_api_test"
            ),
        )

    def test_rejects_working_local_database(self) -> None:
        with self.assertRaises(DatabaseSafetyError):
            validate_test_database_environment(
                app_env="test",
                db_dsn=(
                    "postgresql+asyncpg://sredi_api:sredi_api@"
                    "api_postgres:5432/sredi_api"
                ),
            )

    def test_rejects_non_test_environment(self) -> None:
        with self.assertRaises(DatabaseSafetyError):
            validate_test_database_environment(
                app_env="local",
                db_dsn=(
                    "postgresql+asyncpg://sredi_api_test:synthetic-secret@"
                    "api_test_postgres:5432/sredi_api_test"
                ),
            )

    def test_rejects_remote_or_production_like_target(self) -> None:
        with self.assertRaises(DatabaseSafetyError):
            validate_test_database_environment(
                app_env="test",
                db_dsn=(
                    "postgresql+asyncpg://sredi_api_test:synthetic-secret@"
                    "db.example.com:5432/sredi_api_test"
                ),
            )

    def test_error_does_not_echo_connection_secret_or_full_dsn(self) -> None:
        secret = "do-not-echo-this-password"
        dsn = (
            f"postgresql+asyncpg://sredi_api_test:{secret}@"
            "db.example.com:5432/sredi_api_test"
        )
        with self.assertRaises(DatabaseSafetyError) as context:
            validate_test_database_environment(app_env="test", db_dsn=dsn)

        message = str(context.exception)
        self.assertNotIn(secret, message)
        self.assertNotIn(dsn, message)


if __name__ == "__main__":
    unittest.main()
