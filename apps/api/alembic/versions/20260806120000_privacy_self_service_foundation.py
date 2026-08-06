"""Add privacy self-service schema foundation.

Revision ID: 20260806120000
Revises: 20260805220000
Create Date: 2026-08-06 12:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260806120000"
down_revision: str | Sequence[str] | None = "20260805220000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _uuid_pk() -> sa.Column:
    return sa.Column(
        "id",
        postgresql.UUID(as_uuid=True),
        server_default=sa.text("gen_random_uuid()"),
        nullable=False,
    )


def _timestamptz_now(name: str) -> sa.Column:
    return sa.Column(
        name,
        sa.DateTime(timezone=True),
        server_default=sa.func.now(),
        nullable=False,
    )


def upgrade() -> None:
    op.create_table(
        "privacy_access_codes",
        _uuid_pk(),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("code_hash", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "attempt_count",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        _timestamptz_now("created_at"),
        _timestamptz_now("updated_at"),
        sa.CheckConstraint(
            "btrim(code_hash) <> ''",
            name="privacy_access_codes_code_hash_not_empty",
        ),
        sa.CheckConstraint(
            "expires_at > created_at",
            name="privacy_access_codes_expires_after_created_check",
        ),
        sa.CheckConstraint(
            "attempt_count >= 0",
            name="privacy_access_codes_attempt_count_check",
        ),
        sa.CheckConstraint(
            "consumed_at IS NULL OR consumed_at >= created_at",
            name="privacy_access_codes_consumed_after_created_check",
        ),
        sa.UniqueConstraint(
            "code_hash",
            name="privacy_access_codes_code_hash_key",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "privacy_access_codes_user_id_idx",
        "privacy_access_codes",
        ["user_id"],
    )
    op.create_index(
        "privacy_access_codes_expires_at_idx",
        "privacy_access_codes",
        ["expires_at"],
    )
    op.create_index(
        "privacy_access_codes_active_user_expires_idx",
        "privacy_access_codes",
        ["user_id", "expires_at"],
        postgresql_where=sa.text("consumed_at IS NULL"),
    )

    op.create_table(
        "privacy_access_sessions",
        _uuid_pk(),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("scope", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        _timestamptz_now("created_at"),
        sa.CheckConstraint(
            "btrim(token_hash) <> ''",
            name="privacy_access_sessions_token_hash_not_empty",
        ),
        sa.CheckConstraint(
            "scope = 'privacy_self_service'",
            name="privacy_access_sessions_scope_check",
        ),
        sa.CheckConstraint(
            "expires_at > created_at",
            name="privacy_access_sessions_expires_after_created_check",
        ),
        sa.CheckConstraint(
            "revoked_at IS NULL OR revoked_at >= created_at",
            name="privacy_access_sessions_revoked_after_created_check",
        ),
        sa.CheckConstraint(
            "last_used_at IS NULL OR last_used_at >= created_at",
            name="privacy_access_sessions_last_used_after_created_check",
        ),
        sa.UniqueConstraint(
            "token_hash",
            name="privacy_access_sessions_token_hash_key",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "privacy_access_sessions_user_id_idx",
        "privacy_access_sessions",
        ["user_id"],
    )
    op.create_index(
        "privacy_access_sessions_expires_at_idx",
        "privacy_access_sessions",
        ["expires_at"],
    )
    op.create_index(
        "privacy_access_sessions_active_user_expires_idx",
        "privacy_access_sessions",
        ["user_id", "expires_at"],
        postgresql_where=sa.text("revoked_at IS NULL"),
    )

    op.create_table(
        "privacy_destruction_evidence",
        _uuid_pk(),
        sa.Column("subject_ref_hash", sa.Text(), nullable=False),
        sa.Column("execution_version", sa.Text(), nullable=False),
        sa.Column("result_status", sa.Text(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "categories_deleted",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "categories_retained",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("retention_until", sa.DateTime(timezone=True), nullable=True),
        _timestamptz_now("created_at"),
        sa.CheckConstraint(
            "btrim(subject_ref_hash) <> ''",
            name="privacy_destruction_evidence_subject_hash_not_empty",
        ),
        sa.CheckConstraint(
            "btrim(execution_version) <> ''",
            name="privacy_destruction_evidence_execution_version_not_empty",
        ),
        sa.CheckConstraint(
            "result_status IN ('completed', 'completed_with_retention')",
            name="privacy_destruction_evidence_result_status_check",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(categories_deleted) = 'array' "
            "AND categories_deleted <@ "
            "'[\"account\", \"profile\", \"contact\", \"membership\", "
            "\"registration\", \"credential\", \"session\", \"device\", "
            "\"synced_contact\", \"avatar\", \"privacy_request_content\"]'::jsonb",
            name="privacy_destruction_evidence_categories_deleted_check",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(categories_retained) = 'array' "
            "AND categories_retained <@ "
            "'[\"account\", \"profile\", \"contact\", \"membership\", "
            "\"registration\", \"credential\", \"session\", \"device\", "
            "\"synced_contact\", \"avatar\", \"privacy_request_content\"]'::jsonb",
            name="privacy_destruction_evidence_categories_retained_check",
        ),
        sa.CheckConstraint(
            "retention_until IS NULL OR retention_until >= completed_at",
            name="privacy_destruction_evidence_retention_after_completed_check",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "privacy_destruction_evidence_subject_ref_hash_idx",
        "privacy_destruction_evidence",
        ["subject_ref_hash"],
    )
    op.create_index(
        "privacy_destruction_evidence_completed_at_idx",
        "privacy_destruction_evidence",
        ["completed_at"],
    )

    op.add_column(
        "privacy_requests",
        sa.Column("identity_verified_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "privacy_requests",
        sa.Column("processing_stopped_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "privacy_requests",
        sa.Column("execution_started_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "privacy_requests",
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "privacy_requests",
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "privacy_requests",
        sa.Column("failure_code", sa.Text(), nullable=True),
    )
    op.add_column(
        "privacy_requests",
        sa.Column(
            "destruction_evidence_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )

    op.drop_constraint(
        "privacy_requests_user_id_fkey",
        "privacy_requests",
        type_="foreignkey",
    )
    op.alter_column("privacy_requests", "user_id", nullable=True)
    op.create_foreign_key(
        "privacy_requests_user_id_fkey",
        "privacy_requests",
        "app_users",
        ["user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "privacy_requests_destruction_evidence_id_fkey",
        "privacy_requests",
        "privacy_destruction_evidence",
        ["destruction_evidence_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "privacy_requests_destruction_evidence_id_idx",
        "privacy_requests",
        ["destruction_evidence_id"],
    )

    op.create_check_constraint(
        "privacy_requests_identity_verified_order_check",
        "privacy_requests",
        "identity_verified_at IS NULL OR identity_verified_at >= created_at",
    )
    op.create_check_constraint(
        "privacy_requests_processing_stopped_order_check",
        "privacy_requests",
        "processing_stopped_at IS NULL OR "
        "(identity_verified_at IS NOT NULL "
        "AND processing_stopped_at >= identity_verified_at)",
    )
    op.create_check_constraint(
        "privacy_requests_execution_started_order_check",
        "privacy_requests",
        "execution_started_at IS NULL OR "
        "(processing_stopped_at IS NOT NULL "
        "AND execution_started_at >= processing_stopped_at)",
    )
    op.create_check_constraint(
        "privacy_requests_completed_order_check",
        "privacy_requests",
        "completed_at IS NULL OR "
        "(execution_started_at IS NOT NULL "
        "AND completed_at >= execution_started_at)",
    )
    op.create_check_constraint(
        "privacy_requests_due_after_created_check",
        "privacy_requests",
        "due_at IS NULL OR due_at >= created_at",
    )
    op.create_check_constraint(
        "privacy_requests_failure_code_not_empty",
        "privacy_requests",
        "failure_code IS NULL OR btrim(failure_code) <> ''",
    )
    op.create_check_constraint(
        "privacy_requests_completed_without_failure_check",
        "privacy_requests",
        "completed_at IS NULL OR failure_code IS NULL",
    )
    op.create_check_constraint(
        "privacy_requests_evidence_after_completed_check",
        "privacy_requests",
        "destruction_evidence_id IS NULL OR completed_at IS NOT NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "privacy_requests_evidence_after_completed_check",
        "privacy_requests",
        type_="check",
    )
    op.drop_constraint(
        "privacy_requests_completed_without_failure_check",
        "privacy_requests",
        type_="check",
    )
    op.drop_constraint(
        "privacy_requests_failure_code_not_empty",
        "privacy_requests",
        type_="check",
    )
    op.drop_constraint(
        "privacy_requests_due_after_created_check",
        "privacy_requests",
        type_="check",
    )
    op.drop_constraint(
        "privacy_requests_completed_order_check",
        "privacy_requests",
        type_="check",
    )
    op.drop_constraint(
        "privacy_requests_execution_started_order_check",
        "privacy_requests",
        type_="check",
    )
    op.drop_constraint(
        "privacy_requests_processing_stopped_order_check",
        "privacy_requests",
        type_="check",
    )
    op.drop_constraint(
        "privacy_requests_identity_verified_order_check",
        "privacy_requests",
        type_="check",
    )

    op.drop_index(
        "privacy_requests_destruction_evidence_id_idx",
        table_name="privacy_requests",
    )
    op.drop_constraint(
        "privacy_requests_destruction_evidence_id_fkey",
        "privacy_requests",
        type_="foreignkey",
    )
    op.drop_constraint(
        "privacy_requests_user_id_fkey",
        "privacy_requests",
        type_="foreignkey",
    )
    op.alter_column("privacy_requests", "user_id", nullable=False)
    op.create_foreign_key(
        "privacy_requests_user_id_fkey",
        "privacy_requests",
        "app_users",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_column("privacy_requests", "destruction_evidence_id")
    op.drop_column("privacy_requests", "failure_code")
    op.drop_column("privacy_requests", "due_at")
    op.drop_column("privacy_requests", "completed_at")
    op.drop_column("privacy_requests", "execution_started_at")
    op.drop_column("privacy_requests", "processing_stopped_at")
    op.drop_column("privacy_requests", "identity_verified_at")

    op.drop_index(
        "privacy_destruction_evidence_completed_at_idx",
        table_name="privacy_destruction_evidence",
    )
    op.drop_index(
        "privacy_destruction_evidence_subject_ref_hash_idx",
        table_name="privacy_destruction_evidence",
    )
    op.drop_table("privacy_destruction_evidence")

    op.drop_index(
        "privacy_access_sessions_active_user_expires_idx",
        table_name="privacy_access_sessions",
    )
    op.drop_index(
        "privacy_access_sessions_expires_at_idx",
        table_name="privacy_access_sessions",
    )
    op.drop_index(
        "privacy_access_sessions_user_id_idx",
        table_name="privacy_access_sessions",
    )
    op.drop_table("privacy_access_sessions")

    op.drop_index(
        "privacy_access_codes_active_user_expires_idx",
        table_name="privacy_access_codes",
    )
    op.drop_index(
        "privacy_access_codes_expires_at_idx",
        table_name="privacy_access_codes",
    )
    op.drop_index(
        "privacy_access_codes_user_id_idx",
        table_name="privacy_access_codes",
    )
    op.drop_table("privacy_access_codes")
