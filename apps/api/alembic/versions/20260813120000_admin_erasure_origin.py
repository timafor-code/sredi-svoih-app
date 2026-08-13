"""Add privacy erasure origin and admin authorization metadata.

Revision ID: 20260813120000
Revises: 20260812120000
Create Date: 2026-08-13 12:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260813120000"
down_revision: str | Sequence[str] | None = "20260812120000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "privacy_requests",
        sa.Column(
            "origin",
            sa.Text(),
            server_default=sa.text("'self_service'"),
            nullable=True,
        ),
    )
    op.add_column(
        "privacy_requests",
        sa.Column(
            "initiated_by_user_id",
            sa.UUID(),
            nullable=True,
        ),
    )
    op.add_column(
        "privacy_requests",
        sa.Column(
            "admin_authorized_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.execute(
        "UPDATE privacy_requests "
        "SET origin = 'self_service' "
        "WHERE origin IS NULL",
    )
    op.alter_column("privacy_requests", "origin", nullable=False)
    op.create_foreign_key(
        "privacy_requests_initiated_by_user_id_fkey",
        "privacy_requests",
        "app_users",
        ["initiated_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_check_constraint(
        "privacy_requests_origin_check",
        "privacy_requests",
        "origin IN ('self_service', 'admin')",
    )
    op.create_check_constraint(
        "privacy_requests_admin_authorization_origin_check",
        "privacy_requests",
        "admin_authorized_at IS NULL OR origin = 'admin'",
    )
    op.create_check_constraint(
        "privacy_requests_admin_authorized_order_check",
        "privacy_requests",
        "admin_authorized_at IS NULL OR admin_authorized_at >= created_at",
    )
    op.drop_constraint(
        "privacy_requests_processing_stopped_order_check",
        "privacy_requests",
        type_="check",
    )
    op.create_check_constraint(
        "privacy_requests_processing_stopped_order_check",
        "privacy_requests",
        "processing_stopped_at IS NULL OR "
        "((origin = 'self_service' "
        "AND identity_verified_at IS NOT NULL "
        "AND processing_stopped_at >= identity_verified_at) OR "
        "(origin = 'admin' "
        "AND admin_authorized_at IS NOT NULL "
        "AND initiated_by_user_id IS NOT NULL "
        "AND processing_stopped_at >= admin_authorized_at))",
    )


def downgrade() -> None:
    op.drop_constraint(
        "privacy_requests_processing_stopped_order_check",
        "privacy_requests",
        type_="check",
    )
    op.create_check_constraint(
        "privacy_requests_processing_stopped_order_check",
        "privacy_requests",
        "processing_stopped_at IS NULL OR "
        "(identity_verified_at IS NOT NULL "
        "AND processing_stopped_at >= identity_verified_at)",
    )
    op.drop_constraint(
        "privacy_requests_admin_authorized_order_check",
        "privacy_requests",
        type_="check",
    )
    op.drop_constraint(
        "privacy_requests_admin_authorization_origin_check",
        "privacy_requests",
        type_="check",
    )
    op.drop_constraint(
        "privacy_requests_origin_check",
        "privacy_requests",
        type_="check",
    )
    op.drop_constraint(
        "privacy_requests_initiated_by_user_id_fkey",
        "privacy_requests",
        type_="foreignkey",
    )
    op.drop_column("privacy_requests", "admin_authorized_at")
    op.drop_column("privacy_requests", "initiated_by_user_id")
    op.drop_column("privacy_requests", "origin")
