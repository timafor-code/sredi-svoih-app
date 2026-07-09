"""Create community event locations.

Revision ID: 20260709120000
Revises: 20260706152217
Create Date: 2026-07-09 12:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260709120000"
down_revision: str | Sequence[str] | None = "20260706152217"
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
        "community_event_locations",
        id_pk(),
        sa.Column(
            "community_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("communities.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("address", sa.Text(), nullable=False),
        sa.Column(
            "is_default",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "is_active",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column(
            "sort_order",
            sa.Integer(),
            server_default=sa.text("100"),
            nullable=False,
        ),
        timestamptz_now("created_at"),
        timestamptz_now("updated_at"),
        sa.CheckConstraint(
            "btrim(title) <> ''",
            name="community_event_locations_title_not_empty_check",
        ),
        sa.CheckConstraint(
            "btrim(address) <> ''",
            name="community_event_locations_address_not_empty_check",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "community_event_locations_community_id_idx",
        "community_event_locations",
        ["community_id"],
    )
    op.create_index(
        "community_event_locations_active_sort_idx",
        "community_event_locations",
        [
            "community_id",
            "is_active",
            sa.text("is_default DESC"),
            "sort_order",
            "title",
        ],
    )
    op.create_index(
        "community_event_locations_one_default_idx",
        "community_event_locations",
        ["community_id"],
        unique=True,
        postgresql_where=sa.text("is_default"),
    )


def downgrade() -> None:
    op.drop_index(
        "community_event_locations_one_default_idx",
        table_name="community_event_locations",
    )
    op.drop_index(
        "community_event_locations_active_sort_idx",
        table_name="community_event_locations",
    )
    op.drop_index(
        "community_event_locations_community_id_idx",
        table_name="community_event_locations",
    )
    op.drop_table("community_event_locations")
