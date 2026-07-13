"""Create profile avatar storage metadata.

Revision ID: 20260713120000
Revises: 20260709220000
Create Date: 2026-07-13 12:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260713120000"
down_revision: str | Sequence[str] | None = "20260709220000"
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
        "profile_avatars",
        id_pk(),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("object_key", sa.Text(), nullable=False),
        sa.Column("content_type", sa.Text(), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("etag", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.Text(),
            server_default=sa.text("'pending'"),
            nullable=False,
        ),
        timestamptz_now("created_at"),
        timestamptz_now("updated_at"),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            (
                "content_type IN ('image/jpeg', 'image/png', 'image/webp', "
                "'image/heic', 'image/heif')"
            ),
            name="profile_avatars_content_type_check",
        ),
        sa.CheckConstraint(
            "size_bytes IS NULL OR size_bytes > 0",
            name="profile_avatars_size_positive_check",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'active', 'deleted')",
            name="profile_avatars_status_check",
        ),
        sa.UniqueConstraint("object_key", name="profile_avatars_object_key_key"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "profile_avatars_user_status_idx",
        "profile_avatars",
        ["user_id", "status"],
    )
    op.create_index(
        "profile_avatars_user_created_idx",
        "profile_avatars",
        ["user_id", sa.text("created_at DESC")],
    )
    op.create_index(
        "profile_avatars_active_user_key",
        "profile_avatars",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("status = 'active' AND deleted_at IS NULL"),
    )

    op.add_column(
        "profiles",
        sa.Column("avatar_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index("profiles_avatar_id_idx", "profiles", ["avatar_id"])
    op.create_foreign_key(
        "profiles_avatar_id_fkey",
        "profiles",
        "profile_avatars",
        ["avatar_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("profiles_avatar_id_fkey", "profiles", type_="foreignkey")
    op.drop_index("profiles_avatar_id_idx", table_name="profiles")
    op.drop_column("profiles", "avatar_id")

    op.drop_index("profile_avatars_active_user_key", table_name="profile_avatars")
    op.drop_index("profile_avatars_user_created_idx", table_name="profile_avatars")
    op.drop_index("profile_avatars_user_status_idx", table_name="profile_avatars")
    op.drop_table("profile_avatars")
