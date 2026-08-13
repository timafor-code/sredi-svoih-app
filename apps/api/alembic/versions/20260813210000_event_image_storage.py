"""Create API-owned event image storage metadata.

Revision ID: 20260813210000
Revises: 20260813120000
Create Date: 2026-08-13 21:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260813210000"
down_revision: str | Sequence[str] | None = "20260813120000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "event_images",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "event_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("events.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "community_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("communities.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("object_key", sa.Text(), nullable=False),
        sa.Column(
            "content_type",
            sa.Text(),
            server_default=sa.text("'image/webp'"),
            nullable=False,
        ),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("content_sha256", sa.Text(), nullable=False),
        sa.Column("etag", sa.Text(), nullable=True),
        sa.Column(
            "version_token",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Text(),
            server_default=sa.text("'pending'"),
            nullable=False,
        ),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app_users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "content_type = 'image/webp'",
            name="event_images_content_type_check",
        ),
        sa.CheckConstraint(
            "size_bytes > 0",
            name="event_images_size_positive_check",
        ),
        sa.CheckConstraint(
            "width > 0 AND height > 0",
            name="event_images_dimensions_positive_check",
        ),
        sa.CheckConstraint(
            "content_sha256 ~ '^[0-9a-f]{64}$'",
            name="event_images_content_sha256_check",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'active', 'delete_pending', 'deleted')",
            name="event_images_status_check",
        ),
        sa.CheckConstraint(
            "status <> 'active' OR (activated_at IS NOT NULL AND deleted_at IS NULL)",
            name="event_images_active_lifecycle_check",
        ),
        sa.CheckConstraint(
            "status <> 'deleted' OR deleted_at IS NOT NULL",
            name="event_images_deleted_lifecycle_check",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("object_key", name="event_images_object_key_key"),
    )
    op.create_index("event_images_event_id_idx", "event_images", ["event_id"])
    op.create_index(
        "event_images_community_id_idx",
        "event_images",
        ["community_id"],
    )
    op.create_index(
        "event_images_status_updated_idx",
        "event_images",
        ["status", "updated_at"],
    )
    op.create_index(
        "event_images_one_active_per_event_idx",
        "event_images",
        ["event_id"],
        unique=True,
        postgresql_where=sa.text("status = 'active' AND deleted_at IS NULL"),
    )


def downgrade() -> None:
    # Operational warning: run object inventory/orphan cleanup before downgrading
    # any non-disposable environment. Dropping metadata cannot remove S3 objects.
    op.drop_index(
        "event_images_one_active_per_event_idx",
        table_name="event_images",
    )
    op.drop_index("event_images_status_updated_idx", table_name="event_images")
    op.drop_index("event_images_community_id_idx", table_name="event_images")
    op.drop_index("event_images_event_id_idx", table_name="event_images")
    op.drop_table("event_images")
