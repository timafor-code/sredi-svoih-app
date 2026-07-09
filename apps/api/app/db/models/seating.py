from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    Numeric,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models.base import Base
from app.db.models.core import timestamptz_now, uuid_pk


class EventSeatingLayoutTemplate(Base):
    __tablename__ = "event_seating_layout_templates"
    __table_args__ = (
        CheckConstraint(
            "btrim(title) <> ''",
            name="event_seating_layout_templates_title_not_empty",
        ),
        CheckConstraint(
            "description IS NULL OR btrim(description) <> ''",
            name="event_seating_layout_templates_description_not_empty",
        ),
        CheckConstraint(
            "jsonb_typeof(snapshot) = 'object'",
            name="event_seating_layout_templates_snapshot_is_object",
        ),
        Index(
            "event_seating_layout_templates_community_active_idx",
            "community_id",
            "is_active",
            "title",
        ),
    )

    id: Mapped[UUID] = uuid_pk()
    community_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("communities.id", ondelete="CASCADE"),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    snapshot: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'{}'::jsonb"),
    )
    is_builtin: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("true"),
    )
    created_by: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("app_users.id", ondelete="SET NULL"),
    )
    created_at: Mapped[datetime] = timestamptz_now()
    updated_at: Mapped[datetime] = timestamptz_now()


class EventSeatingLayout(Base):
    __tablename__ = "event_seating_layouts"
    __table_args__ = (
        ForeignKeyConstraint(
            ["capacity_unit_id", "event_id"],
            ["event_capacity_units.id", "event_capacity_units.event_id"],
            name="event_seating_layouts_unit_event_fkey",
            ondelete="CASCADE",
        ),
        CheckConstraint(
            "title IS NULL OR btrim(title) <> ''",
            name="event_seating_layouts_title_not_empty",
        ),
        CheckConstraint(
            "capacity_limit_snapshot IS NULL OR capacity_limit_snapshot > 0",
            name="event_seating_layouts_capacity_limit_snapshot_check",
        ),
        Index("event_seating_layouts_community_idx", "community_id"),
        Index(
            "event_seating_layouts_event_occurrence_idx",
            "event_id",
            "occurrence_id",
        ),
        Index("event_seating_layouts_capacity_unit_idx", "capacity_unit_id"),
        Index("event_seating_layouts_template_idx", "template_id"),
        Index(
            "event_seating_layouts_slot_occurrence_unique",
            "event_id",
            "occurrence_id",
            "capacity_unit_id",
            unique=True,
            postgresql_where=text("occurrence_id IS NOT NULL"),
        ),
        Index(
            "event_seating_layouts_slot_event_unique",
            "event_id",
            "capacity_unit_id",
            unique=True,
            postgresql_where=text("occurrence_id IS NULL"),
        ),
    )

    id: Mapped[UUID] = uuid_pk()
    community_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("communities.id", ondelete="CASCADE"),
        nullable=False,
    )
    event_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("events.id", ondelete="CASCADE"),
        nullable=False,
    )
    occurrence_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("event_occurrences.id", ondelete="CASCADE"),
    )
    capacity_unit_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        nullable=False,
    )
    template_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("event_seating_layout_templates.id", ondelete="SET NULL"),
    )
    title: Mapped[str | None] = mapped_column(Text)
    capacity_limit_snapshot: Mapped[int | None] = mapped_column(Integer)
    seating_done: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )
    created_by: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("app_users.id", ondelete="SET NULL"),
    )
    created_at: Mapped[datetime] = timestamptz_now()
    updated_at: Mapped[datetime] = timestamptz_now()


class EventSeatingTable(Base):
    __tablename__ = "event_seating_tables"
    __table_args__ = (
        UniqueConstraint(
            "layout_id",
            "client_table_id",
            name="event_seating_tables_layout_client_id_unique",
        ),
        UniqueConstraint(
            "id",
            "layout_id",
            name="event_seating_tables_id_layout_id_unique",
        ),
        CheckConstraint(
            "btrim(client_table_id) <> ''",
            name="event_seating_tables_client_table_id_not_empty",
        ),
        CheckConstraint("w > 0", name="event_seating_tables_w_check"),
        CheckConstraint("h > 0", name="event_seating_tables_h_check"),
        CheckConstraint(
            "angle IN (0, 90, 180, 270)",
            name="event_seating_tables_angle_check",
        ),
        CheckConstraint(
            "long_side_seats IN (2, 3)",
            name="event_seating_tables_long_side_seats_check",
        ),
        CheckConstraint("sort_order >= 0", name="event_seating_tables_sort_order_check"),
        Index("event_seating_tables_layout_idx", "layout_id"),
        Index(
            "event_seating_tables_layout_sort_idx",
            "layout_id",
            "sort_order",
            "client_table_id",
        ),
        Index(
            "event_seating_tables_one_rabbi_table_idx",
            "layout_id",
            unique=True,
            postgresql_where=text("is_rabbi_table"),
        ),
    )

    id: Mapped[UUID] = uuid_pk()
    layout_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("event_seating_layouts.id", ondelete="CASCADE"),
        nullable=False,
    )
    client_table_id: Mapped[str] = mapped_column(Text, nullable=False)
    cx: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    cy: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    w: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    h: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    angle: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("0"),
    )
    long_side_seats: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("3"),
    )
    is_rabbi_table: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )
    sort_order: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("0"),
    )
    created_at: Mapped[datetime] = timestamptz_now()
    updated_at: Mapped[datetime] = timestamptz_now()


class EventSeatingTableConnection(Base):
    __tablename__ = "event_seating_table_connections"
    __table_args__ = (
        ForeignKeyConstraint(
            ["layout_id", "from_client_table_id"],
            ["event_seating_tables.layout_id", "event_seating_tables.client_table_id"],
            name="event_seating_table_connections_from_table_fkey",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["layout_id", "to_client_table_id"],
            ["event_seating_tables.layout_id", "event_seating_tables.client_table_id"],
            name="event_seating_table_connections_to_table_fkey",
            ondelete="CASCADE",
        ),
        CheckConstraint(
            "btrim(from_client_table_id) <> ''",
            name="event_seating_table_connections_from_not_empty",
        ),
        CheckConstraint(
            "btrim(to_client_table_id) <> ''",
            name="event_seating_table_connections_to_not_empty",
        ),
        CheckConstraint(
            "from_client_table_id <> to_client_table_id",
            name="event_seating_table_connections_distinct_tables",
        ),
        CheckConstraint(
            "from_end IS NULL OR from_end IN ('a', 'b')",
            name="event_seating_table_connections_from_end_check",
        ),
        CheckConstraint(
            "to_end IS NULL OR to_end IN ('a', 'b')",
            name="event_seating_table_connections_to_end_check",
        ),
        UniqueConstraint(
            "layout_id",
            "from_client_table_id",
            "from_end",
            "to_client_table_id",
            "to_end",
            name="event_seating_table_connections_layout_pair_unique",
        ),
        Index("event_seating_table_connections_layout_idx", "layout_id"),
    )

    id: Mapped[UUID] = uuid_pk()
    layout_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    from_client_table_id: Mapped[str] = mapped_column(Text, nullable=False)
    from_end: Mapped[str | None] = mapped_column(Text)
    to_client_table_id: Mapped[str] = mapped_column(Text, nullable=False)
    to_end: Mapped[str | None] = mapped_column(Text)
    anchor_x: Mapped[Decimal | None] = mapped_column(Numeric)
    anchor_y: Mapped[Decimal | None] = mapped_column(Numeric)
    created_at: Mapped[datetime] = timestamptz_now()


class EventSeatingAssignment(Base):
    __tablename__ = "event_seating_assignments"
    __table_args__ = (
        CheckConstraint(
            "assignment_type IN ('guest', 'reserve')",
            name="event_seating_assignments_type_check",
        ),
        CheckConstraint(
            "seat_key IS NULL OR btrim(seat_key) <> ''",
            name="event_seating_assignments_seat_key_not_empty",
        ),
        CheckConstraint(
            "guest_index IS NULL OR guest_index >= 0",
            name="event_seating_assignments_guest_index_check",
        ),
        CheckConstraint(
            "guest_label IS NULL OR btrim(guest_label) <> ''",
            name="event_seating_assignments_guest_label_not_empty",
        ),
        CheckConstraint(
            "guest_initials IS NULL OR btrim(guest_initials) <> ''",
            name="event_seating_assignments_guest_initials_not_empty",
        ),
        CheckConstraint(
            "assignment_type <> 'reserve' OR registration_id IS NULL",
            name="event_seating_assignments_reserve_registration_check",
        ),
        UniqueConstraint(
            "layout_id",
            "seat_key",
            name="event_seating_assignments_layout_seat_unique",
        ),
        Index("event_seating_assignments_layout_idx", "layout_id"),
        Index("event_seating_assignments_registration_idx", "registration_id"),
        Index("event_seating_assignments_user_id_idx", "user_id"),
        Index(
            "event_seating_assignments_registration_guest_unique",
            "layout_id",
            "registration_id",
            "guest_index",
            unique=True,
            postgresql_where=text(
                "registration_id IS NOT NULL AND guest_index IS NOT NULL",
            ),
        ),
    )

    id: Mapped[UUID] = uuid_pk()
    layout_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("event_seating_layouts.id", ondelete="CASCADE"),
        nullable=False,
    )
    registration_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("event_registrations.id", ondelete="CASCADE"),
    )
    guest_index: Mapped[int | None] = mapped_column(Integer)
    user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("app_users.id", ondelete="SET NULL"),
    )
    seat_key: Mapped[str | None] = mapped_column(Text)
    guest_label: Mapped[str | None] = mapped_column(Text)
    guest_initials: Mapped[str | None] = mapped_column(Text)
    assignment_type: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'guest'"),
    )
    created_by: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("app_users.id", ondelete="SET NULL"),
    )
    created_at: Mapped[datetime] = timestamptz_now()
    updated_at: Mapped[datetime] = timestamptz_now()
