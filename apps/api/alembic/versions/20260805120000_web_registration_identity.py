"""Add web registration identity and legal schema.

Revision ID: 20260805120000
Revises: 20260713120000
Create Date: 2026-08-05 12:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260805120000"
down_revision: str | Sequence[str] | None = "20260713120000"
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
    op.add_column("app_users", sa.Column("account_origin", sa.Text(), nullable=True))
    op.add_column("app_users", sa.Column("claim_state", sa.Text(), nullable=True))
    op.add_column(
        "app_users",
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "app_users",
        sa.Column("deletion_requested_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "app_users",
        sa.Column("erased_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute("UPDATE app_users SET account_origin = 'migration'")
    op.execute(
        "UPDATE app_users SET claim_state = CASE "
        "WHEN password_hash IS NOT NULL THEN 'claimed' ELSE 'legacy_external' END",
    )
    op.alter_column(
        "app_users",
        "account_origin",
        nullable=False,
    )
    op.alter_column(
        "app_users",
        "claim_state",
        nullable=False,
    )
    op.create_check_constraint(
        "app_users_account_origin_check",
        "app_users",
        "account_origin IN ('password_signup', 'invite', 'web_guest', 'migration', 'admin')",
    )
    op.create_check_constraint(
        "app_users_claim_state_check",
        "app_users",
        "claim_state IN ('unclaimed', 'claimed', 'legacy_external')",
    )

    op.add_column(
        "event_registrations",
        sa.Column("source_channel", sa.Text(), nullable=True),
    )
    op.execute("UPDATE event_registrations SET source_channel = 'mobile'")
    op.alter_column("event_registrations", "source_channel", nullable=False)
    op.create_check_constraint(
        "event_registrations_source_channel_check",
        "event_registrations",
        "source_channel IN ('mobile', 'public_web', 'admin')",
    )

    op.create_table(
        "legal_documents",
        _uuid_pk(),
        sa.Column("document_type", sa.Text(), nullable=False),
        sa.Column("version", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.Text(), nullable=False),
        sa.Column("published_url", sa.Text(), nullable=False),
        sa.Column("effective_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("retired_at", sa.DateTime(timezone=True), nullable=True),
        _timestamptz_now("created_at"),
        _timestamptz_now("updated_at"),
        sa.CheckConstraint(
            "document_type IN ('privacy_policy', 'event_registration_consent', 'marketing_consent')",
            name="legal_documents_document_type_check",
        ),
        sa.CheckConstraint(
            "btrim(version) <> ''",
            name="legal_documents_version_not_empty",
        ),
        sa.CheckConstraint("btrim(title) <> ''", name="legal_documents_title_not_empty"),
        sa.CheckConstraint(
            "btrim(content_hash) <> ''",
            name="legal_documents_content_hash_not_empty",
        ),
        sa.CheckConstraint(
            "btrim(published_url) <> ''",
            name="legal_documents_published_url_not_empty",
        ),
        sa.CheckConstraint(
            "retired_at IS NULL OR retired_at >= effective_at",
            name="legal_documents_retired_after_effective_check",
        ),
        sa.UniqueConstraint(
            "document_type",
            "version",
            name="legal_documents_document_type_version_key",
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "legal_acceptances",
        _uuid_pk(),
        # User deletion removes personal acceptance evidence.
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # Registration deletion leaves account-level evidence and clears this link.
        sa.Column(
            "registration_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("event_registrations.id", ondelete="SET NULL"),
            nullable=True,
        ),
        # Immutable published versions are restricted while referenced.
        sa.Column(
            "legal_document_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("legal_documents.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("acceptance_method", sa.Text(), nullable=False),
        sa.Column("source_channel", sa.Text(), nullable=False),
        sa.Column("evidence_version", sa.Text(), nullable=False),
        sa.Column("retention_until", sa.DateTime(timezone=True), nullable=True),
        _timestamptz_now("created_at"),
        sa.CheckConstraint(
            "acceptance_method IN ('checkbox_plus_email_verification', 'authenticated_action')",
            name="legal_acceptances_acceptance_method_check",
        ),
        sa.CheckConstraint(
            "source_channel IN ('mobile', 'public_web', 'admin')",
            name="legal_acceptances_source_channel_check",
        ),
        sa.CheckConstraint(
            "btrim(evidence_version) <> ''",
            name="legal_acceptances_evidence_version_not_empty",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("legal_acceptances_user_id_idx", "legal_acceptances", ["user_id"])
    op.create_index(
        "legal_acceptances_registration_id_idx",
        "legal_acceptances",
        ["registration_id"],
    )
    op.create_index(
        "legal_acceptances_legal_document_id_idx",
        "legal_acceptances",
        ["legal_document_id"],
    )
    op.create_index(
        "legal_acceptances_accepted_at_idx",
        "legal_acceptances",
        ["accepted_at"],
    )


def downgrade() -> None:
    op.drop_index("legal_acceptances_accepted_at_idx", table_name="legal_acceptances")
    op.drop_index(
        "legal_acceptances_legal_document_id_idx",
        table_name="legal_acceptances",
    )
    op.drop_index(
        "legal_acceptances_registration_id_idx",
        table_name="legal_acceptances",
    )
    op.drop_index("legal_acceptances_user_id_idx", table_name="legal_acceptances")
    op.drop_table("legal_acceptances")
    op.drop_table("legal_documents")
    op.drop_constraint(
        "event_registrations_source_channel_check",
        "event_registrations",
        type_="check",
    )
    op.drop_column("event_registrations", "source_channel")
    op.drop_constraint("app_users_claim_state_check", "app_users", type_="check")
    op.drop_constraint("app_users_account_origin_check", "app_users", type_="check")
    op.drop_column("app_users", "erased_at")
    op.drop_column("app_users", "deletion_requested_at")
    op.drop_column("app_users", "claimed_at")
    op.drop_column("app_users", "claim_state")
    op.drop_column("app_users", "account_origin")
