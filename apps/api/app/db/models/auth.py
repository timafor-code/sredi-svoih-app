from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models.base import Base
from app.db.models.core import timestamptz_now, uuid_pk


class AuthSession(Base):
    __tablename__ = "auth_sessions"
    __table_args__ = (
        CheckConstraint(
            "btrim(refresh_token_hash) <> ''",
            name="auth_sessions_refresh_token_hash_not_empty",
        ),
        CheckConstraint(
            "expires_at > created_at",
            name="auth_sessions_expires_after_created_check",
        ),
        CheckConstraint(
            "revoked_at IS NULL OR revoked_at >= created_at",
            name="auth_sessions_revoked_after_created_check",
        ),
        UniqueConstraint("refresh_token_hash", name="auth_sessions_refresh_token_hash_key"),
        Index("auth_sessions_user_id_idx", "user_id"),
        Index("auth_sessions_expires_at_idx", "expires_at"),
        Index("auth_sessions_revoked_at_idx", "revoked_at"),
    )

    id: Mapped[UUID] = uuid_pk()
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("app_users.id", ondelete="CASCADE"),
        nullable=False,
    )
    refresh_token_hash: Mapped[str] = mapped_column(Text, nullable=False)
    device_name: Mapped[str | None] = mapped_column(Text)
    user_agent_hash: Mapped[str | None] = mapped_column(Text)
    ip_hash: Mapped[str | None] = mapped_column(Text)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = timestamptz_now()
    updated_at: Mapped[datetime] = timestamptz_now()


class AuthEmailVerificationCode(Base):
    __tablename__ = "auth_email_verification_codes"
    __table_args__ = (
        CheckConstraint(
            "btrim(code_hash) <> ''",
            name="auth_email_verification_codes_code_hash_not_empty",
        ),
        CheckConstraint(
            "expires_at > created_at",
            name="auth_email_verification_codes_expires_after_created_check",
        ),
        CheckConstraint(
            "consumed_at IS NULL OR consumed_at >= created_at",
            name="auth_email_verification_codes_consumed_after_created_check",
        ),
        UniqueConstraint(
            "code_hash",
            name="auth_email_verification_codes_code_hash_key",
        ),
        Index("auth_email_verification_codes_user_id_idx", "user_id"),
        Index("auth_email_verification_codes_expires_at_idx", "expires_at"),
        Index("auth_email_verification_codes_consumed_at_idx", "consumed_at"),
    )

    id: Mapped[UUID] = uuid_pk()
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("app_users.id", ondelete="CASCADE"),
        nullable=False,
    )
    code_hash: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = timestamptz_now()


class PasswordResetCode(Base):
    __tablename__ = "password_reset_codes"
    __table_args__ = (
        CheckConstraint(
            "btrim(code_hash) <> ''",
            name="password_reset_codes_code_hash_not_empty",
        ),
        CheckConstraint(
            "expires_at > created_at",
            name="password_reset_codes_expires_after_created_check",
        ),
        CheckConstraint(
            "consumed_at IS NULL OR consumed_at >= created_at",
            name="password_reset_codes_consumed_after_created_check",
        ),
        UniqueConstraint("code_hash", name="password_reset_codes_code_hash_key"),
        Index("password_reset_codes_user_id_idx", "user_id"),
        Index("password_reset_codes_expires_at_idx", "expires_at"),
        Index("password_reset_codes_consumed_at_idx", "consumed_at"),
    )

    id: Mapped[UUID] = uuid_pk()
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("app_users.id", ondelete="CASCADE"),
        nullable=False,
    )
    code_hash: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = timestamptz_now()


class AuthSetPasswordCode(Base):
    __tablename__ = "auth_set_password_codes"
    __table_args__ = (
        CheckConstraint(
            "btrim(code_hash) <> ''",
            name="auth_set_password_codes_code_hash_not_empty",
        ),
        CheckConstraint(
            "expires_at > created_at",
            name="auth_set_password_codes_expires_after_created_check",
        ),
        CheckConstraint(
            "consumed_at IS NULL OR consumed_at >= created_at",
            name="auth_set_password_codes_consumed_after_created_check",
        ),
        UniqueConstraint("code_hash", name="auth_set_password_codes_code_hash_key"),
        Index("auth_set_password_codes_user_id_idx", "user_id"),
        Index("auth_set_password_codes_expires_at_idx", "expires_at"),
        Index("auth_set_password_codes_consumed_at_idx", "consumed_at"),
    )

    id: Mapped[UUID] = uuid_pk()
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("app_users.id", ondelete="CASCADE"),
        nullable=False,
    )
    code_hash: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = timestamptz_now()
