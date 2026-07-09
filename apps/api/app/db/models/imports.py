from __future__ import annotations

from datetime import datetime
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
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models.base import Base
from app.db.models.core import timestamptz_now, uuid_pk


class EventImportSource(Base):
    __tablename__ = "event_import_sources"
    __table_args__ = (
        UniqueConstraint(
            "community_id",
            "key",
            name="event_import_sources_community_key_unique",
        ),
        UniqueConstraint(
            "id",
            "community_id",
            name="event_import_sources_id_community_id_unique",
        ),
        CheckConstraint(
            "key ~ '^[a-z0-9][a-z0-9_]{1,63}$'",
            name="event_import_sources_key_format_check",
        ),
        CheckConstraint(
            "btrim(title) <> ''",
            name="event_import_sources_title_not_empty",
        ),
        CheckConstraint(
            "btrim(source_type) <> ''",
            name="event_import_sources_source_type_not_empty",
        ),
        CheckConstraint(
            "btrim(source_url) <> ''",
            name="event_import_sources_source_url_not_empty",
        ),
        CheckConstraint(
            "jsonb_typeof(settings) = 'object'",
            name="event_import_sources_settings_is_object",
        ),
        Index("event_import_sources_community_id_idx", "community_id"),
        Index(
            "event_import_sources_active_idx",
            "community_id",
            "key",
            postgresql_where=text("is_active"),
        ),
    )

    id: Mapped[UUID] = uuid_pk()
    community_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("communities.id", ondelete="CASCADE"),
        nullable=False,
    )
    key: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    source_type: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'website_scrape'"),
    )
    source_url: Mapped[str] = mapped_column(Text, nullable=False)
    settings: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'{}'::jsonb"),
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
    updated_by: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("app_users.id", ondelete="SET NULL"),
    )
    created_at: Mapped[datetime] = timestamptz_now()
    updated_at: Mapped[datetime] = timestamptz_now()


class EventImportRun(Base):
    __tablename__ = "event_import_runs"
    __table_args__ = (
        ForeignKeyConstraint(
            ["source_id", "community_id"],
            ["event_import_sources.id", "event_import_sources.community_id"],
            name="event_import_runs_source_community_fkey",
            ondelete="CASCADE",
        ),
        UniqueConstraint(
            "id",
            "source_id",
            name="event_import_runs_id_source_id_unique",
        ),
        CheckConstraint(
            "mode = 'apply_review_only'",
            name="event_import_runs_mode_check",
        ),
        CheckConstraint(
            "status IN ('started', 'success', 'failed')",
            name="event_import_runs_status_check",
        ),
        CheckConstraint(
            "found_count >= 0",
            name="event_import_runs_found_count_check",
        ),
        CheckConstraint(
            "parsed_count IS NULL OR parsed_count >= 0",
            name="event_import_runs_parsed_count_check",
        ),
        CheckConstraint(
            "created_count >= 0",
            name="event_import_runs_created_count_check",
        ),
        CheckConstraint(
            "updated_count >= 0",
            name="event_import_runs_updated_count_check",
        ),
        CheckConstraint(
            "finished_at IS NULL OR finished_at >= started_at",
            name="event_import_runs_finished_at_check",
        ),
        CheckConstraint(
            "error IS NULL OR btrim(error) <> ''",
            name="event_import_runs_error_not_empty",
        ),
        CheckConstraint(
            "jsonb_typeof(summary) = 'object'",
            name="event_import_runs_summary_is_object",
        ),
        CheckConstraint(
            "jsonb_typeof(parser_metadata) = 'object'",
            name="event_import_runs_parser_metadata_is_object",
        ),
        CheckConstraint(
            "jsonb_typeof(debug_metadata) = 'object'",
            name="event_import_runs_debug_metadata_is_object",
        ),
        Index("event_import_runs_community_id_idx", "community_id"),
        Index(
            "event_import_runs_source_status_started_at_idx",
            "source_id",
            "status",
            text("started_at DESC"),
        ),
        Index(
            "event_import_runs_one_started_per_source_idx",
            "source_id",
            unique=True,
            postgresql_where=text("status = 'started'"),
        ),
    )

    id: Mapped[UUID] = uuid_pk()
    source_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    community_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    mode: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'apply_review_only'"),
    )
    status: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'started'"),
    )
    started_at: Mapped[datetime] = timestamptz_now()
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    found_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("0"),
    )
    parsed_count: Mapped[int | None] = mapped_column(Integer)
    created_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("0"),
    )
    updated_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("0"),
    )
    error: Mapped[str | None] = mapped_column(Text)
    summary: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'{}'::jsonb"),
    )
    parser_metadata: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'{}'::jsonb"),
    )
    debug_metadata: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'{}'::jsonb"),
    )
    created_by: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("app_users.id", ondelete="SET NULL"),
    )
    created_at: Mapped[datetime] = timestamptz_now()
    updated_at: Mapped[datetime] = timestamptz_now()


class EventImportItem(Base):
    __tablename__ = "event_import_items"
    __table_args__ = (
        ForeignKeyConstraint(
            ["run_id", "source_id"],
            ["event_import_runs.id", "event_import_runs.source_id"],
            name="event_import_items_run_source_fkey",
            ondelete="CASCADE",
        ),
        CheckConstraint(
            "external_id IS NULL OR btrim(external_id) <> ''",
            name="event_import_items_external_id_not_empty",
        ),
        CheckConstraint(
            "source_url IS NULL OR btrim(source_url) <> ''",
            name="event_import_items_source_url_not_empty",
        ),
        CheckConstraint(
            "parsed_title IS NULL OR btrim(parsed_title) <> ''",
            name="event_import_items_parsed_title_not_empty",
        ),
        CheckConstraint(
            "parsed_location IS NULL OR btrim(parsed_location) <> ''",
            name="event_import_items_parsed_location_not_empty",
        ),
        CheckConstraint(
            "status IN ('new', 'linked', 'ignored', 'error')",
            name="event_import_items_status_check",
        ),
        CheckConstraint(
            "error IS NULL OR btrim(error) <> ''",
            name="event_import_items_error_not_empty",
        ),
        CheckConstraint(
            "jsonb_typeof(raw_payload) = 'object'",
            name="event_import_items_raw_payload_is_object",
        ),
        Index("event_import_items_run_id_idx", "run_id"),
        Index("event_import_items_status_idx", "status"),
        Index(
            "event_import_items_linked_event_id_idx",
            "linked_event_id",
            postgresql_where=text("linked_event_id IS NOT NULL"),
        ),
        Index(
            "event_import_items_external_id_idx",
            "source_id",
            "external_id",
            postgresql_where=text("external_id IS NOT NULL"),
        ),
        Index(
            "event_import_items_run_external_id_unique",
            "run_id",
            "external_id",
            unique=True,
            postgresql_where=text("external_id IS NOT NULL"),
        ),
    )

    id: Mapped[UUID] = uuid_pk()
    run_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    source_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    external_id: Mapped[str | None] = mapped_column(Text)
    source_url: Mapped[str | None] = mapped_column(Text)
    raw_payload: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'{}'::jsonb"),
    )
    parsed_title: Mapped[str | None] = mapped_column(Text)
    parsed_starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    parsed_location: Mapped[str | None] = mapped_column(Text)
    linked_event_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("events.id", ondelete="SET NULL"),
    )
    status: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'new'"),
    )
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = timestamptz_now()
    updated_at: Mapped[datetime] = timestamptz_now()
