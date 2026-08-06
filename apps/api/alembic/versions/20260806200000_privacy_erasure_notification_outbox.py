"""Add the encrypted privacy-erasure notification outbox.

Revision ID: 20260806200000
Revises: 20260806190000
Create Date: 2026-08-06 20:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260806200000"
down_revision: str | Sequence[str] | None = "20260806190000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_ROW_COUNT = sa.text(
    "SELECT count(*) FROM privacy_erasure_notification_outbox",
)


def upgrade() -> None:
    op.create_table(
        "privacy_erasure_notification_outbox",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("privacy_request_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "destruction_evidence_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column("notification_kind", sa.Text(), nullable=False),
        sa.Column(
            "status",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'pending'"),
        ),
        sa.Column("recipient_ciphertext", sa.LargeBinary(), nullable=True),
        sa.Column("recipient_nonce", sa.LargeBinary(), nullable=True),
        sa.Column("encryption_key_id", sa.Text(), nullable=False),
        sa.Column(
            "attempt_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("failure_code", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "notification_kind IN ('completed', 'completed_with_retention')",
            name="privacy_erasure_notification_outbox_kind_check",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'failed', 'sent', 'expired')",
            name="privacy_erasure_notification_outbox_status_check",
        ),
        sa.CheckConstraint(
            "attempt_count >= 0",
            name="privacy_erasure_notification_outbox_attempt_count_check",
        ),
        sa.CheckConstraint(
            "expires_at > created_at",
            name="privacy_erasure_notification_outbox_expiry_check",
        ),
        sa.CheckConstraint(
            "btrim(encryption_key_id) <> ''",
            name="privacy_erasure_notification_outbox_key_id_not_empty",
        ),
        sa.CheckConstraint(
            "failure_code IS NULL OR btrim(failure_code) <> ''",
            name="privacy_erasure_notification_outbox_failure_code_not_empty",
        ),
        sa.CheckConstraint(
            "((status IN ('pending', 'failed') "
            "AND recipient_ciphertext IS NOT NULL AND recipient_nonce IS NOT NULL) "
            "OR (status IN ('sent', 'expired') "
            "AND recipient_ciphertext IS NULL AND recipient_nonce IS NULL))",
            name="privacy_erasure_notification_outbox_recipient_lifecycle_check",
        ),
        sa.CheckConstraint(
            "((status = 'sent' AND sent_at IS NOT NULL) "
            "OR (status <> 'sent' AND sent_at IS NULL))",
            name="privacy_erasure_notification_outbox_sent_at_status_check",
        ),
        sa.CheckConstraint(
            "status <> 'sent' OR failure_code IS NULL",
            name="privacy_erasure_notification_outbox_sent_without_failure_check",
        ),
        sa.CheckConstraint(
            "last_attempt_at IS NULL OR last_attempt_at >= created_at",
            name="privacy_erasure_notification_outbox_attempt_after_created_check",
        ),
        sa.CheckConstraint(
            "sent_at IS NULL OR sent_at >= created_at",
            name="privacy_erasure_notification_outbox_sent_after_created_check",
        ),
        sa.ForeignKeyConstraint(
            ["privacy_request_id"],
            ["privacy_requests.id"],
            name="privacy_erasure_notification_outbox_privacy_request_id_fkey",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["destruction_evidence_id"],
            ["privacy_destruction_evidence.id"],
            name="privacy_erasure_notification_outbox_evidence_id_fkey",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint(
            "id",
            name="privacy_erasure_notification_outbox_pkey",
        ),
        sa.UniqueConstraint(
            "privacy_request_id",
            name="privacy_erasure_notification_outbox_privacy_request_id_key",
        ),
        sa.UniqueConstraint(
            "destruction_evidence_id",
            name="privacy_erasure_notification_outbox_evidence_id_key",
        ),
    )
    op.create_index(
        "privacy_erasure_notification_outbox_status_created_idx",
        "privacy_erasure_notification_outbox",
        ["status", "created_at"],
        unique=False,
    )
    op.create_index(
        "privacy_erasure_notification_outbox_expires_at_idx",
        "privacy_erasure_notification_outbox",
        ["expires_at"],
        unique=False,
    )


def downgrade() -> None:
    row_count = int(op.get_bind().scalar(_ROW_COUNT) or 0)
    if row_count:
        raise RuntimeError(
            "privacy erasure notification outbox downgrade blocked; "
            f"aggregate row count: {row_count}",
        )

    op.drop_index(
        "privacy_erasure_notification_outbox_expires_at_idx",
        table_name="privacy_erasure_notification_outbox",
    )
    op.drop_index(
        "privacy_erasure_notification_outbox_status_created_idx",
        table_name="privacy_erasure_notification_outbox",
    )
    op.drop_table("privacy_erasure_notification_outbox")
