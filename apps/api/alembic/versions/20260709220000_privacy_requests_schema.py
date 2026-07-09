"""Create privacy_requests schema.

Revision ID: 20260709220000
Revises: 20260709210000
Create Date: 2026-07-09 22:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260709220000"
down_revision: str | Sequence[str] | None = "20260709210000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def id_pk() -> sa.Column:
    return sa.Column(
        "id",
        postgresql.UUID(as_uuid=True),
        server_default=sa.text("gen_random_uuid()"),
        nullable=False,
    )


def timestamptz_now(name: str) -> sa.Column:
    return sa.Column(
        name,
        sa.DateTime(timezone=True),
        server_default=sa.func.now(),
        nullable=False,
    )


def upgrade() -> None:
    op.create_table(
        "privacy_requests",
        id_pk(),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "community_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("communities.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("request_type", sa.Text(), nullable=False),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.Text(),
            server_default=sa.text("'open'"),
            nullable=False,
        ),
        sa.Column("resolution_note", sa.Text(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "resolved_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app_users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        timestamptz_now("created_at"),
        timestamptz_now("updated_at"),
        sa.CheckConstraint(
            "request_type IN ('data_export', 'deletion', 'correction', 'other')",
            name="privacy_requests_request_type_check",
        ),
        sa.CheckConstraint(
            "status IN ('open', 'reviewed', 'resolved', 'rejected', 'closed')",
            name="privacy_requests_status_check",
        ),
        sa.CheckConstraint(
            "message IS NULL OR char_length(message) <= 4000",
            name="privacy_requests_message_length_check",
        ),
        sa.CheckConstraint(
            "resolution_note IS NULL OR char_length(resolution_note) <= 4000",
            name="privacy_requests_resolution_note_length_check",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "privacy_requests_user_created_idx",
        "privacy_requests",
        ["user_id", sa.text("created_at DESC")],
    )
    op.create_index(
        "privacy_requests_community_created_idx",
        "privacy_requests",
        ["community_id", sa.text("created_at DESC")],
    )
    op.create_index(
        "privacy_requests_status_created_idx",
        "privacy_requests",
        ["status", sa.text("created_at DESC")],
    )


def downgrade() -> None:
    op.drop_index("privacy_requests_status_created_idx", table_name="privacy_requests")
    op.drop_index(
        "privacy_requests_community_created_idx",
        table_name="privacy_requests",
    )
    op.drop_index("privacy_requests_user_created_idx", table_name="privacy_requests")
    op.drop_table("privacy_requests")
