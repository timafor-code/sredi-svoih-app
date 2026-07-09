"""Create seating schema.

Revision ID: 20260709173041
Revises: 20260709120000
Create Date: 2026-07-09 17:30:41.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260709173041"
down_revision: str | Sequence[str] | None = "20260709120000"
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
        "event_seating_layout_templates",
        id_pk(),
        sa.Column(
            "community_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("communities.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "snapshot",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "is_builtin",
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
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app_users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        timestamptz_now("created_at"),
        timestamptz_now("updated_at"),
        sa.CheckConstraint(
            "btrim(title) <> ''",
            name="event_seating_layout_templates_title_not_empty",
        ),
        sa.CheckConstraint(
            "description IS NULL OR btrim(description) <> ''",
            name="event_seating_layout_templates_description_not_empty",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(snapshot) = 'object'",
            name="event_seating_layout_templates_snapshot_is_object",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "event_seating_layout_templates_community_active_idx",
        "event_seating_layout_templates",
        ["community_id", "is_active", "title"],
    )

    op.create_table(
        "event_seating_layouts",
        id_pk(),
        sa.Column(
            "community_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("communities.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "event_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("events.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "occurrence_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("event_occurrences.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("capacity_unit_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "template_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("event_seating_layout_templates.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("capacity_limit_snapshot", sa.Integer(), nullable=True),
        sa.Column(
            "seating_done",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app_users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        timestamptz_now("created_at"),
        timestamptz_now("updated_at"),
        sa.ForeignKeyConstraint(
            ["capacity_unit_id", "event_id"],
            ["event_capacity_units.id", "event_capacity_units.event_id"],
            name="event_seating_layouts_unit_event_fkey",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "title IS NULL OR btrim(title) <> ''",
            name="event_seating_layouts_title_not_empty",
        ),
        sa.CheckConstraint(
            "capacity_limit_snapshot IS NULL OR capacity_limit_snapshot > 0",
            name="event_seating_layouts_capacity_limit_snapshot_check",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "event_seating_layouts_community_idx",
        "event_seating_layouts",
        ["community_id"],
    )
    op.create_index(
        "event_seating_layouts_event_occurrence_idx",
        "event_seating_layouts",
        ["event_id", "occurrence_id"],
    )
    op.create_index(
        "event_seating_layouts_capacity_unit_idx",
        "event_seating_layouts",
        ["capacity_unit_id"],
    )
    op.create_index(
        "event_seating_layouts_template_idx",
        "event_seating_layouts",
        ["template_id"],
    )
    op.create_index(
        "event_seating_layouts_slot_occurrence_unique",
        "event_seating_layouts",
        ["event_id", "occurrence_id", "capacity_unit_id"],
        unique=True,
        postgresql_where=sa.text("occurrence_id IS NOT NULL"),
    )
    op.create_index(
        "event_seating_layouts_slot_event_unique",
        "event_seating_layouts",
        ["event_id", "capacity_unit_id"],
        unique=True,
        postgresql_where=sa.text("occurrence_id IS NULL"),
    )

    op.create_table(
        "event_seating_tables",
        id_pk(),
        sa.Column(
            "layout_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("event_seating_layouts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("client_table_id", sa.Text(), nullable=False),
        sa.Column("cx", sa.Numeric(), nullable=False),
        sa.Column("cy", sa.Numeric(), nullable=False),
        sa.Column("w", sa.Numeric(), nullable=False),
        sa.Column("h", sa.Numeric(), nullable=False),
        sa.Column("angle", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column(
            "long_side_seats",
            sa.Integer(),
            server_default=sa.text("3"),
            nullable=False,
        ),
        sa.Column(
            "is_rabbi_table",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "sort_order",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        timestamptz_now("created_at"),
        timestamptz_now("updated_at"),
        sa.CheckConstraint(
            "btrim(client_table_id) <> ''",
            name="event_seating_tables_client_table_id_not_empty",
        ),
        sa.CheckConstraint("w > 0", name="event_seating_tables_w_check"),
        sa.CheckConstraint("h > 0", name="event_seating_tables_h_check"),
        sa.CheckConstraint(
            "angle IN (0, 90, 180, 270)",
            name="event_seating_tables_angle_check",
        ),
        sa.CheckConstraint(
            "long_side_seats IN (2, 3)",
            name="event_seating_tables_long_side_seats_check",
        ),
        sa.CheckConstraint(
            "sort_order >= 0",
            name="event_seating_tables_sort_order_check",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "layout_id",
            "client_table_id",
            name="event_seating_tables_layout_client_id_unique",
        ),
        sa.UniqueConstraint(
            "id",
            "layout_id",
            name="event_seating_tables_id_layout_id_unique",
        ),
    )
    op.create_index(
        "event_seating_tables_layout_idx",
        "event_seating_tables",
        ["layout_id"],
    )
    op.create_index(
        "event_seating_tables_layout_sort_idx",
        "event_seating_tables",
        ["layout_id", "sort_order", "client_table_id"],
    )
    op.create_index(
        "event_seating_tables_one_rabbi_table_idx",
        "event_seating_tables",
        ["layout_id"],
        unique=True,
        postgresql_where=sa.text("is_rabbi_table"),
    )

    op.create_table(
        "event_seating_table_connections",
        id_pk(),
        sa.Column("layout_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("from_client_table_id", sa.Text(), nullable=False),
        sa.Column("from_end", sa.Text(), nullable=True),
        sa.Column("to_client_table_id", sa.Text(), nullable=False),
        sa.Column("to_end", sa.Text(), nullable=True),
        sa.Column("anchor_x", sa.Numeric(), nullable=True),
        sa.Column("anchor_y", sa.Numeric(), nullable=True),
        timestamptz_now("created_at"),
        sa.ForeignKeyConstraint(
            ["layout_id", "from_client_table_id"],
            ["event_seating_tables.layout_id", "event_seating_tables.client_table_id"],
            name="event_seating_table_connections_from_table_fkey",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["layout_id", "to_client_table_id"],
            ["event_seating_tables.layout_id", "event_seating_tables.client_table_id"],
            name="event_seating_table_connections_to_table_fkey",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "btrim(from_client_table_id) <> ''",
            name="event_seating_table_connections_from_not_empty",
        ),
        sa.CheckConstraint(
            "btrim(to_client_table_id) <> ''",
            name="event_seating_table_connections_to_not_empty",
        ),
        sa.CheckConstraint(
            "from_client_table_id <> to_client_table_id",
            name="event_seating_table_connections_distinct_tables",
        ),
        sa.CheckConstraint(
            "from_end IS NULL OR from_end IN ('a', 'b')",
            name="event_seating_table_connections_from_end_check",
        ),
        sa.CheckConstraint(
            "to_end IS NULL OR to_end IN ('a', 'b')",
            name="event_seating_table_connections_to_end_check",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "layout_id",
            "from_client_table_id",
            "from_end",
            "to_client_table_id",
            "to_end",
            name="event_seating_table_connections_layout_pair_unique",
        ),
    )
    op.create_index(
        "event_seating_table_connections_layout_idx",
        "event_seating_table_connections",
        ["layout_id"],
    )

    op.create_table(
        "event_seating_assignments",
        id_pk(),
        sa.Column(
            "layout_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("event_seating_layouts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "registration_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("event_registrations.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("guest_index", sa.Integer(), nullable=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app_users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("seat_key", sa.Text(), nullable=True),
        sa.Column("guest_label", sa.Text(), nullable=True),
        sa.Column("guest_initials", sa.Text(), nullable=True),
        sa.Column(
            "assignment_type",
            sa.Text(),
            server_default=sa.text("'guest'"),
            nullable=False,
        ),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app_users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        timestamptz_now("created_at"),
        timestamptz_now("updated_at"),
        sa.CheckConstraint(
            "assignment_type IN ('guest', 'reserve')",
            name="event_seating_assignments_type_check",
        ),
        sa.CheckConstraint(
            "seat_key IS NULL OR btrim(seat_key) <> ''",
            name="event_seating_assignments_seat_key_not_empty",
        ),
        sa.CheckConstraint(
            "guest_index IS NULL OR guest_index >= 0",
            name="event_seating_assignments_guest_index_check",
        ),
        sa.CheckConstraint(
            "guest_label IS NULL OR btrim(guest_label) <> ''",
            name="event_seating_assignments_guest_label_not_empty",
        ),
        sa.CheckConstraint(
            "guest_initials IS NULL OR btrim(guest_initials) <> ''",
            name="event_seating_assignments_guest_initials_not_empty",
        ),
        sa.CheckConstraint(
            "assignment_type <> 'reserve' OR registration_id IS NULL",
            name="event_seating_assignments_reserve_registration_check",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "layout_id",
            "seat_key",
            name="event_seating_assignments_layout_seat_unique",
        ),
    )
    op.create_index(
        "event_seating_assignments_layout_idx",
        "event_seating_assignments",
        ["layout_id"],
    )
    op.create_index(
        "event_seating_assignments_registration_idx",
        "event_seating_assignments",
        ["registration_id"],
    )
    op.create_index(
        "event_seating_assignments_user_id_idx",
        "event_seating_assignments",
        ["user_id"],
    )
    op.create_index(
        "event_seating_assignments_registration_guest_unique",
        "event_seating_assignments",
        ["layout_id", "registration_id", "guest_index"],
        unique=True,
        postgresql_where=sa.text(
            "registration_id IS NOT NULL AND guest_index IS NOT NULL",
        ),
    )


def downgrade() -> None:
    op.drop_index(
        "event_seating_assignments_registration_guest_unique",
        table_name="event_seating_assignments",
    )
    op.drop_index(
        "event_seating_assignments_user_id_idx",
        table_name="event_seating_assignments",
    )
    op.drop_index(
        "event_seating_assignments_registration_idx",
        table_name="event_seating_assignments",
    )
    op.drop_index(
        "event_seating_assignments_layout_idx",
        table_name="event_seating_assignments",
    )
    op.drop_table("event_seating_assignments")

    op.drop_index(
        "event_seating_table_connections_layout_idx",
        table_name="event_seating_table_connections",
    )
    op.drop_table("event_seating_table_connections")

    op.drop_index(
        "event_seating_tables_one_rabbi_table_idx",
        table_name="event_seating_tables",
    )
    op.drop_index(
        "event_seating_tables_layout_sort_idx",
        table_name="event_seating_tables",
    )
    op.drop_index(
        "event_seating_tables_layout_idx",
        table_name="event_seating_tables",
    )
    op.drop_table("event_seating_tables")

    op.drop_index(
        "event_seating_layouts_slot_event_unique",
        table_name="event_seating_layouts",
    )
    op.drop_index(
        "event_seating_layouts_slot_occurrence_unique",
        table_name="event_seating_layouts",
    )
    op.drop_index(
        "event_seating_layouts_template_idx",
        table_name="event_seating_layouts",
    )
    op.drop_index(
        "event_seating_layouts_capacity_unit_idx",
        table_name="event_seating_layouts",
    )
    op.drop_index(
        "event_seating_layouts_event_occurrence_idx",
        table_name="event_seating_layouts",
    )
    op.drop_index(
        "event_seating_layouts_community_idx",
        table_name="event_seating_layouts",
    )
    op.drop_table("event_seating_layouts")

    op.drop_index(
        "event_seating_layout_templates_community_active_idx",
        table_name="event_seating_layout_templates",
    )
    op.drop_table("event_seating_layout_templates")
