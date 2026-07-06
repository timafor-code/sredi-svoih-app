"""Create auth storage tables.

Revision ID: 20260706152217
Revises: 20260706135613
Create Date: 2026-07-06 15:22:17.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260706152217"
down_revision: str | Sequence[str] | None = "20260706135613"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def id_pk() -> sa.Column:
    return sa.Column(
        "id",
        postgresql.UUID(as_uuid=True),
        server_default=sa.text("gen_random_uuid()"),
        nullable=False,
    )


def user_fk() -> sa.Column:
    return sa.Column(
        "user_id",
        postgresql.UUID(as_uuid=True),
        sa.ForeignKey("app_users.id", ondelete="CASCADE"),
        nullable=False,
    )


def timestamptz_now(name: str) -> sa.Column:
    return sa.Column(
        name,
        sa.DateTime(timezone=True),
        server_default=sa.func.now(),
        nullable=False,
    )


def code_storage_columns() -> tuple[sa.Column, sa.Column, sa.Column, sa.Column, sa.Column]:
    return (
        sa.Column("code_hash", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        timestamptz_now("created_at"),
        timestamptz_now("updated_at"),
    )


def upgrade() -> None:
    op.create_table(
        "auth_sessions",
        id_pk(),
        user_fk(),
        sa.Column("refresh_token_hash", sa.Text(), nullable=False),
        sa.Column("device_name", sa.Text(), nullable=True),
        sa.Column("user_agent_hash", sa.Text(), nullable=True),
        sa.Column("ip_hash", sa.Text(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        timestamptz_now("created_at"),
        timestamptz_now("updated_at"),
        sa.CheckConstraint(
            "btrim(refresh_token_hash) <> ''",
            name="auth_sessions_refresh_token_hash_not_empty",
        ),
        sa.CheckConstraint(
            "expires_at > created_at",
            name="auth_sessions_expires_after_created_check",
        ),
        sa.CheckConstraint(
            "revoked_at IS NULL OR revoked_at >= created_at",
            name="auth_sessions_revoked_after_created_check",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "refresh_token_hash",
            name="auth_sessions_refresh_token_hash_key",
        ),
    )
    op.create_index("auth_sessions_user_id_idx", "auth_sessions", ["user_id"])
    op.create_index("auth_sessions_expires_at_idx", "auth_sessions", ["expires_at"])
    op.create_index("auth_sessions_revoked_at_idx", "auth_sessions", ["revoked_at"])

    op.create_table(
        "auth_email_verification_codes",
        id_pk(),
        user_fk(),
        *code_storage_columns(),
        sa.CheckConstraint(
            "btrim(code_hash) <> ''",
            name="auth_email_verification_codes_code_hash_not_empty",
        ),
        sa.CheckConstraint(
            "expires_at > created_at",
            name="auth_email_verification_codes_expires_after_created_check",
        ),
        sa.CheckConstraint(
            "consumed_at IS NULL OR consumed_at >= created_at",
            name="auth_email_verification_codes_consumed_after_created_check",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "code_hash",
            name="auth_email_verification_codes_code_hash_key",
        ),
    )
    op.create_index(
        "auth_email_verification_codes_user_id_idx",
        "auth_email_verification_codes",
        ["user_id"],
    )
    op.create_index(
        "auth_email_verification_codes_expires_at_idx",
        "auth_email_verification_codes",
        ["expires_at"],
    )
    op.create_index(
        "auth_email_verification_codes_consumed_at_idx",
        "auth_email_verification_codes",
        ["consumed_at"],
    )

    op.create_table(
        "password_reset_codes",
        id_pk(),
        user_fk(),
        *code_storage_columns(),
        sa.CheckConstraint(
            "btrim(code_hash) <> ''",
            name="password_reset_codes_code_hash_not_empty",
        ),
        sa.CheckConstraint(
            "expires_at > created_at",
            name="password_reset_codes_expires_after_created_check",
        ),
        sa.CheckConstraint(
            "consumed_at IS NULL OR consumed_at >= created_at",
            name="password_reset_codes_consumed_after_created_check",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code_hash", name="password_reset_codes_code_hash_key"),
    )
    op.create_index(
        "password_reset_codes_user_id_idx",
        "password_reset_codes",
        ["user_id"],
    )
    op.create_index(
        "password_reset_codes_expires_at_idx",
        "password_reset_codes",
        ["expires_at"],
    )
    op.create_index(
        "password_reset_codes_consumed_at_idx",
        "password_reset_codes",
        ["consumed_at"],
    )

    op.create_table(
        "auth_set_password_codes",
        id_pk(),
        user_fk(),
        *code_storage_columns(),
        sa.CheckConstraint(
            "btrim(code_hash) <> ''",
            name="auth_set_password_codes_code_hash_not_empty",
        ),
        sa.CheckConstraint(
            "expires_at > created_at",
            name="auth_set_password_codes_expires_after_created_check",
        ),
        sa.CheckConstraint(
            "consumed_at IS NULL OR consumed_at >= created_at",
            name="auth_set_password_codes_consumed_after_created_check",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code_hash", name="auth_set_password_codes_code_hash_key"),
    )
    op.create_index(
        "auth_set_password_codes_user_id_idx",
        "auth_set_password_codes",
        ["user_id"],
    )
    op.create_index(
        "auth_set_password_codes_expires_at_idx",
        "auth_set_password_codes",
        ["expires_at"],
    )
    op.create_index(
        "auth_set_password_codes_consumed_at_idx",
        "auth_set_password_codes",
        ["consumed_at"],
    )


def downgrade() -> None:
    op.drop_table("auth_set_password_codes")
    op.drop_table("password_reset_codes")
    op.drop_table("auth_email_verification_codes")
    op.drop_table("auth_sessions")
