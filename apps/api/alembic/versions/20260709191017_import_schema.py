"""Create website import schema.

Revision ID: 20260709191017
Revises: 20260709173041
Create Date: 2026-07-09 19:10:17.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260709191017"
down_revision: str | Sequence[str] | None = "20260709173041"
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


def jsonb_object(name: str) -> sa.Column:
    return sa.Column(
        name,
        postgresql.JSONB(astext_type=sa.Text()),
        server_default=sa.text("'{}'::jsonb"),
        nullable=False,
    )


def upgrade() -> None:
    op.create_table(
        "event_import_sources",
        id_pk(),
        sa.Column(
            "community_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("communities.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column(
            "source_type",
            sa.Text(),
            server_default=sa.text("'website_scrape'"),
            nullable=False,
        ),
        sa.Column("source_url", sa.Text(), nullable=False),
        jsonb_object("settings"),
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
        sa.Column(
            "updated_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app_users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        timestamptz_now("created_at"),
        timestamptz_now("updated_at"),
        sa.CheckConstraint(
            "key ~ '^[a-z0-9][a-z0-9_]{1,63}$'",
            name="event_import_sources_key_format_check",
        ),
        sa.CheckConstraint(
            "btrim(title) <> ''",
            name="event_import_sources_title_not_empty",
        ),
        sa.CheckConstraint(
            "btrim(source_type) <> ''",
            name="event_import_sources_source_type_not_empty",
        ),
        sa.CheckConstraint(
            "btrim(source_url) <> ''",
            name="event_import_sources_source_url_not_empty",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(settings) = 'object'",
            name="event_import_sources_settings_is_object",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "community_id",
            "key",
            name="event_import_sources_community_key_unique",
        ),
        sa.UniqueConstraint(
            "id",
            "community_id",
            name="event_import_sources_id_community_id_unique",
        ),
    )
    op.create_index(
        "event_import_sources_community_id_idx",
        "event_import_sources",
        ["community_id"],
    )
    op.create_index(
        "event_import_sources_active_idx",
        "event_import_sources",
        ["community_id", "key"],
        postgresql_where=sa.text("is_active"),
    )

    op.create_table(
        "event_import_runs",
        id_pk(),
        sa.Column("source_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("community_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "mode",
            sa.Text(),
            server_default=sa.text("'apply_review_only'"),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Text(),
            server_default=sa.text("'started'"),
            nullable=False,
        ),
        timestamptz_now("started_at"),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "found_count",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column("parsed_count", sa.Integer(), nullable=True),
        sa.Column(
            "created_count",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column(
            "updated_count",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column("error", sa.Text(), nullable=True),
        jsonb_object("summary"),
        jsonb_object("parser_metadata"),
        jsonb_object("debug_metadata"),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app_users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        timestamptz_now("created_at"),
        timestamptz_now("updated_at"),
        sa.ForeignKeyConstraint(
            ["source_id", "community_id"],
            ["event_import_sources.id", "event_import_sources.community_id"],
            name="event_import_runs_source_community_fkey",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "mode = 'apply_review_only'",
            name="event_import_runs_mode_check",
        ),
        sa.CheckConstraint(
            "status IN ('started', 'success', 'failed')",
            name="event_import_runs_status_check",
        ),
        sa.CheckConstraint(
            "found_count >= 0",
            name="event_import_runs_found_count_check",
        ),
        sa.CheckConstraint(
            "parsed_count IS NULL OR parsed_count >= 0",
            name="event_import_runs_parsed_count_check",
        ),
        sa.CheckConstraint(
            "created_count >= 0",
            name="event_import_runs_created_count_check",
        ),
        sa.CheckConstraint(
            "updated_count >= 0",
            name="event_import_runs_updated_count_check",
        ),
        sa.CheckConstraint(
            "finished_at IS NULL OR finished_at >= started_at",
            name="event_import_runs_finished_at_check",
        ),
        sa.CheckConstraint(
            "error IS NULL OR btrim(error) <> ''",
            name="event_import_runs_error_not_empty",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(summary) = 'object'",
            name="event_import_runs_summary_is_object",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(parser_metadata) = 'object'",
            name="event_import_runs_parser_metadata_is_object",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(debug_metadata) = 'object'",
            name="event_import_runs_debug_metadata_is_object",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "id",
            "source_id",
            name="event_import_runs_id_source_id_unique",
        ),
    )
    op.create_index(
        "event_import_runs_community_id_idx",
        "event_import_runs",
        ["community_id"],
    )
    op.create_index(
        "event_import_runs_source_status_started_at_idx",
        "event_import_runs",
        ["source_id", "status", sa.text("started_at DESC")],
    )
    op.create_index(
        "event_import_runs_one_started_per_source_idx",
        "event_import_runs",
        ["source_id"],
        unique=True,
        postgresql_where=sa.text("status = 'started'"),
    )

    op.create_table(
        "event_import_items",
        id_pk(),
        sa.Column("run_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("external_id", sa.Text(), nullable=True),
        sa.Column("source_url", sa.Text(), nullable=True),
        jsonb_object("raw_payload"),
        sa.Column("parsed_title", sa.Text(), nullable=True),
        sa.Column("parsed_starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("parsed_location", sa.Text(), nullable=True),
        sa.Column(
            "linked_event_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("events.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "status",
            sa.Text(),
            server_default=sa.text("'new'"),
            nullable=False,
        ),
        sa.Column("error", sa.Text(), nullable=True),
        timestamptz_now("created_at"),
        timestamptz_now("updated_at"),
        sa.ForeignKeyConstraint(
            ["run_id", "source_id"],
            ["event_import_runs.id", "event_import_runs.source_id"],
            name="event_import_items_run_source_fkey",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "external_id IS NULL OR btrim(external_id) <> ''",
            name="event_import_items_external_id_not_empty",
        ),
        sa.CheckConstraint(
            "source_url IS NULL OR btrim(source_url) <> ''",
            name="event_import_items_source_url_not_empty",
        ),
        sa.CheckConstraint(
            "parsed_title IS NULL OR btrim(parsed_title) <> ''",
            name="event_import_items_parsed_title_not_empty",
        ),
        sa.CheckConstraint(
            "parsed_location IS NULL OR btrim(parsed_location) <> ''",
            name="event_import_items_parsed_location_not_empty",
        ),
        sa.CheckConstraint(
            "status IN ('new', 'linked', 'ignored', 'error')",
            name="event_import_items_status_check",
        ),
        sa.CheckConstraint(
            "error IS NULL OR btrim(error) <> ''",
            name="event_import_items_error_not_empty",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(raw_payload) = 'object'",
            name="event_import_items_raw_payload_is_object",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "event_import_items_run_id_idx",
        "event_import_items",
        ["run_id"],
    )
    op.create_index(
        "event_import_items_status_idx",
        "event_import_items",
        ["status"],
    )
    op.create_index(
        "event_import_items_linked_event_id_idx",
        "event_import_items",
        ["linked_event_id"],
        postgresql_where=sa.text("linked_event_id IS NOT NULL"),
    )
    op.create_index(
        "event_import_items_external_id_idx",
        "event_import_items",
        ["source_id", "external_id"],
        postgresql_where=sa.text("external_id IS NOT NULL"),
    )
    op.create_index(
        "event_import_items_run_external_id_unique",
        "event_import_items",
        ["run_id", "external_id"],
        unique=True,
        postgresql_where=sa.text("external_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "event_import_items_run_external_id_unique",
        table_name="event_import_items",
    )
    op.drop_index(
        "event_import_items_external_id_idx",
        table_name="event_import_items",
    )
    op.drop_index(
        "event_import_items_linked_event_id_idx",
        table_name="event_import_items",
    )
    op.drop_index(
        "event_import_items_status_idx",
        table_name="event_import_items",
    )
    op.drop_index(
        "event_import_items_run_id_idx",
        table_name="event_import_items",
    )
    op.drop_table("event_import_items")

    op.drop_index(
        "event_import_runs_one_started_per_source_idx",
        table_name="event_import_runs",
    )
    op.drop_index(
        "event_import_runs_source_status_started_at_idx",
        table_name="event_import_runs",
    )
    op.drop_index(
        "event_import_runs_community_id_idx",
        table_name="event_import_runs",
    )
    op.drop_table("event_import_runs")

    op.drop_index(
        "event_import_sources_active_idx",
        table_name="event_import_sources",
    )
    op.drop_index(
        "event_import_sources_community_id_idx",
        table_name="event_import_sources",
    )
    op.drop_table("event_import_sources")
