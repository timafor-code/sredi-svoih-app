"""Add reversible privacy erasure lifecycle state.

Revision ID: 20260806160000
Revises: 20260806120000
Create Date: 2026-08-06 16:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260806160000"
down_revision: str | Sequence[str] | None = "20260806120000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "privacy_requests",
        sa.Column("pre_deletion_user_status", sa.Text(), nullable=True),
    )
    op.add_column(
        "privacy_requests",
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_check_constraint(
        "privacy_requests_pre_deletion_status_not_empty",
        "privacy_requests",
        "pre_deletion_user_status IS NULL OR "
        "btrim(pre_deletion_user_status) <> ''",
    )
    op.create_check_constraint(
        "privacy_requests_pre_deletion_status_not_pending",
        "privacy_requests",
        "pre_deletion_user_status IS NULL OR "
        "pre_deletion_user_status <> 'deletion_pending'",
    )
    op.create_check_constraint(
        "privacy_requests_processing_requires_pre_status",
        "privacy_requests",
        "processing_stopped_at IS NULL OR "
        "(pre_deletion_user_status IS NOT NULL AND "
        "btrim(pre_deletion_user_status) <> '')",
    )
    op.create_check_constraint(
        "privacy_requests_cancelled_requires_processing_stop",
        "privacy_requests",
        "cancelled_at IS NULL OR processing_stopped_at IS NOT NULL",
    )
    op.create_check_constraint(
        "privacy_requests_cancelled_after_processing_stop",
        "privacy_requests",
        "cancelled_at IS NULL OR cancelled_at >= processing_stopped_at",
    )
    op.create_check_constraint(
        "privacy_requests_cancelled_without_completion",
        "privacy_requests",
        "cancelled_at IS NULL OR completed_at IS NULL",
    )
    op.create_check_constraint(
        "privacy_requests_cancelled_without_evidence",
        "privacy_requests",
        "cancelled_at IS NULL OR destruction_evidence_id IS NULL",
    )
    op.create_check_constraint(
        "privacy_requests_cancelled_before_execution",
        "privacy_requests",
        "cancelled_at IS NULL OR execution_started_at IS NULL",
    )

    op.create_index(
        "privacy_requests_deletion_queue_idx",
        "privacy_requests",
        ["created_at", "id"],
        postgresql_where=sa.text(
            "request_type = 'deletion' "
            "AND processing_stopped_at IS NOT NULL "
            "AND cancelled_at IS NULL "
            "AND completed_at IS NULL"
        ),
    )


def downgrade() -> None:
    op.drop_index(
        "privacy_requests_deletion_queue_idx",
        table_name="privacy_requests",
    )
    op.drop_constraint(
        "privacy_requests_cancelled_before_execution",
        "privacy_requests",
        type_="check",
    )
    op.drop_constraint(
        "privacy_requests_cancelled_without_evidence",
        "privacy_requests",
        type_="check",
    )
    op.drop_constraint(
        "privacy_requests_cancelled_without_completion",
        "privacy_requests",
        type_="check",
    )
    op.drop_constraint(
        "privacy_requests_cancelled_after_processing_stop",
        "privacy_requests",
        type_="check",
    )
    op.drop_constraint(
        "privacy_requests_cancelled_requires_processing_stop",
        "privacy_requests",
        type_="check",
    )
    op.drop_constraint(
        "privacy_requests_processing_requires_pre_status",
        "privacy_requests",
        type_="check",
    )
    op.drop_constraint(
        "privacy_requests_pre_deletion_status_not_pending",
        "privacy_requests",
        type_="check",
    )
    op.drop_constraint(
        "privacy_requests_pre_deletion_status_not_empty",
        "privacy_requests",
        type_="check",
    )
    op.drop_column("privacy_requests", "cancelled_at")
    op.drop_column("privacy_requests", "pre_deletion_user_status")
