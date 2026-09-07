"""Add hash-only remembered public-web participant sessions.

Revision ID: 20260907190000
Revises: 20260904180000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260907190000"
down_revision: str | Sequence[str] | None = "20260904180000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "web_participant_sessions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("btrim(token_hash) <> ''", name="web_participant_sessions_token_hash_not_empty"),
        sa.CheckConstraint("expires_at > created_at", name="web_participant_sessions_expiry_check"),
        sa.ForeignKeyConstraint(["user_id"], ["app_users.id"], name="web_participant_sessions_user_id_fkey", ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name="web_participant_sessions_pkey"),
        sa.UniqueConstraint("token_hash", name="web_participant_sessions_token_hash_key"),
    )
    op.create_index("web_participant_sessions_user_id_idx", "web_participant_sessions", ["user_id"])
    op.create_index("web_participant_sessions_expires_at_idx", "web_participant_sessions", ["expires_at"])


def downgrade() -> None:
    op.drop_index("web_participant_sessions_expires_at_idx", table_name="web_participant_sessions")
    op.drop_index("web_participant_sessions_user_id_idx", table_name="web_participant_sessions")
    op.drop_table("web_participant_sessions")
