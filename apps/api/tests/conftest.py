from __future__ import annotations

import pytest

from app.core.config import get_settings
from tests.db_safety import DatabaseSafetyError, validate_test_database_environment


def pytest_configure(config: pytest.Config) -> None:
    del config
    settings = get_settings()
    try:
        validate_test_database_environment(
            app_env=settings.app_env,
            db_dsn=settings.db_dsn,
        )
    except DatabaseSafetyError as exc:
        raise pytest.UsageError(str(exc)) from None
