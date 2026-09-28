"""Add Admin registration actor provenance.

Revision ID: 20260928180000
Revises: 20260924120000
Create Date: 2026-09-28 18:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260928180000"
down_revision: str | Sequence[str] | None = "20260924120000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "event_registrations",
        sa.Column("created_by_admin_user_id", sa.UUID(), nullable=True),
    )
    op.create_foreign_key(
        "event_registrations_created_by_admin_user_id_fkey",
        "event_registrations",
        "app_users",
        ["created_by_admin_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "event_registrations_created_by_admin_user_id_idx",
        "event_registrations",
        ["created_by_admin_user_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "event_registrations_created_by_admin_user_id_idx",
        table_name="event_registrations",
    )
    op.drop_constraint(
        "event_registrations_created_by_admin_user_id_fkey",
        "event_registrations",
        type_="foreignkey",
    )
    op.drop_column("event_registrations", "created_by_admin_user_id")
