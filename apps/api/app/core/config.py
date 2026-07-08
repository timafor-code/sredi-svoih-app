from functools import lru_cache

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_DB_DSN_ENV = "DATABASE" + "_URL"
_SUPABASE_SIGNING_KEY_ENV = "SUPABASE" + "_JWT_SECRET"
_LOCAL_CORS_ALLOWED_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8081",
    "http://127.0.0.1:8081",
)


class Settings(BaseSettings):
    app_name: str = "sredi-svoih-api"
    app_env: str = "local"
    api_version: str = "0.1.0-local"
    git_sha: str | None = None
    log_level: str = "INFO"
    api_jwt_secret: str = "local-dev-jwt-secret-change-me-minimum-32-bytes"
    api_access_token_ttl_minutes: int = Field(default=15, gt=0)
    api_refresh_token_ttl_days: int = Field(default=30, gt=0)
    api_token_hash_secret: str = "local-dev-token-hash-secret-change-me-minimum-32-bytes"
    api_jwt_issuer: str = "sredi-svoih-api"
    api_jwt_audience: str | None = None
    migration_accept_supabase_jwt: bool = False
    supabase_jwt_signing_key: str = Field(
        default="",
        validation_alias=AliasChoices(_SUPABASE_SIGNING_KEY_ENV),
    )
    supabase_jwt_issuer: str = ""
    supabase_jwt_audience: str = ""
    api_auth_code_ttl_minutes: int = Field(default=30, gt=0)
    api_email_enabled: bool = False
    api_email_from_address: str = "dev-null@example.invalid"
    api_email_from_name: str = "Sredi Svoih"
    api_email_smtp_host: str = ""
    api_email_smtp_port: int = Field(default=587, gt=0, le=65535)
    api_email_smtp_username: str = ""
    api_email_smtp_password: str = ""
    api_email_smtp_starttls: bool = True
    api_auth_email_rate_limit_window_seconds: int = Field(default=900, gt=0)
    api_auth_email_rate_limit_max_attempts: int = Field(default=5, gt=0)
    api_public_app_base_url: str = "http://localhost:8081"
    api_cors_allowed_origins: str = ",".join(_LOCAL_CORS_ALLOWED_ORIGINS)
    db_dsn: str = Field(
        default="postgresql+asyncpg://sredi_api:sredi_api@localhost:55432/sredi_api",
        validation_alias=AliasChoices(_DB_DSN_ENV, "API_DB_DSN"),
    )

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def cors_allowed_origins(self) -> list[str]:
        return [
            origin.strip().rstrip("/")
            for origin in self.api_cors_allowed_origins.split(",")
            if origin.strip()
        ]


@lru_cache
def get_settings() -> Settings:
    return Settings()
