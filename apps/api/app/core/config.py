from functools import lru_cache

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_DB_DSN_ENV = "DATABASE" + "_URL"


class Settings(BaseSettings):
    app_name: str = "sredi-svoih-api"
    app_env: str = "local"
    api_version: str = "0.1.0-local"
    git_sha: str | None = None
    log_level: str = "INFO"
    api_jwt_secret: str = "local-dev-jwt-secret-change-me-minimum-32-bytes"
    api_access_token_ttl_minutes: int = Field(default=15, gt=0)
    api_token_hash_secret: str = "local-dev-token-hash-secret-change-me-minimum-32-bytes"
    api_jwt_issuer: str = "sredi-svoih-api"
    api_jwt_audience: str | None = None
    db_dsn: str = Field(
        default="postgresql+asyncpg://sredi_api:sredi_api@localhost:55432/sredi_api",
        validation_alias=AliasChoices(_DB_DSN_ENV, "API_DB_DSN"),
    )

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
