from __future__ import annotations

from urllib.parse import urlsplit

EXPECTED_TEST_DATABASE = "sredi_api_test"
EXPECTED_TEST_HOST = "api_test_postgres"
EXPECTED_TEST_USER = "sredi_api_test"
_ALLOWED_SCHEMES = {"postgresql", "postgresql+asyncpg"}


class TestDatabaseSafetyError(RuntimeError):
    """Safe test-database configuration error without connection details."""


def validate_test_database_environment(*, app_env: str, db_dsn: str) -> None:
    if app_env.strip().lower() != "test":
        raise TestDatabaseSafetyError(
            "API test database guard: APP_ENV must be test."
        )

    try:
        parsed = urlsplit(db_dsn.strip())
    except (TypeError, ValueError):
        raise TestDatabaseSafetyError(
            "API test database guard: database target is invalid."
        ) from None

    database = parsed.path.removeprefix("/")
    if (
        parsed.scheme not in _ALLOWED_SCHEMES
        or parsed.hostname != EXPECTED_TEST_HOST
        or parsed.username != EXPECTED_TEST_USER
        or database != EXPECTED_TEST_DATABASE
    ):
        raise TestDatabaseSafetyError(
            "API test database guard: database target is not the dedicated test database."
        )
