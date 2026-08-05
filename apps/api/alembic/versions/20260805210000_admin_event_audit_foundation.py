"""Add the minimal admin event audit foundation.

Revision ID: 20260805210000
Revises: 20260805200000
Create Date: 2026-08-05 21:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260805210000"
down_revision: str | Sequence[str] | None = "20260805200000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "admin_event_audit_entries",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "actor_user_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "event_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("old_state", sa.Text(), nullable=False),
        sa.Column("new_state", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "action = 'event_web_visibility_changed'",
            name="admin_event_audit_entries_action_check",
        ),
        sa.CheckConstraint(
            "old_state IN ('disabled', 'unlisted', 'listed')",
            name="admin_event_audit_entries_old_state_check",
        ),
        sa.CheckConstraint(
            "new_state IN ('disabled', 'unlisted', 'listed')",
            name="admin_event_audit_entries_new_state_check",
        ),
        sa.CheckConstraint(
            "old_state <> new_state",
            name="admin_event_audit_entries_state_changed_check",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "admin_event_audit_entries_actor_user_id_idx",
        "admin_event_audit_entries",
        ["actor_user_id"],
    )
    op.create_index(
        "admin_event_audit_entries_event_id_idx",
        "admin_event_audit_entries",
        ["event_id"],
    )
    op.create_index(
        "admin_event_audit_entries_created_at_idx",
        "admin_event_audit_entries",
        ["created_at"],
    )
    op.create_index(
        "admin_event_audit_entries_event_created_at_idx",
        "admin_event_audit_entries",
        ["event_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "admin_event_audit_entries_event_created_at_idx",
        table_name="admin_event_audit_entries",
    )
    op.drop_index(
        "admin_event_audit_entries_created_at_idx",
        table_name="admin_event_audit_entries",
    )
    op.drop_index(
        "admin_event_audit_entries_event_id_idx",
        table_name="admin_event_audit_entries",
    )
    op.drop_index(
        "admin_event_audit_entries_actor_user_id_idx",
        table_name="admin_event_audit_entries",
    )
    op.drop_table("admin_event_audit_entries")
