"""Add versioned web event questionnaire definitions.

Revision ID: 20260807120000
Revises: 20260806200000
Create Date: 2026-08-07 12:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260807120000"
down_revision: str | Sequence[str] | None = "20260806200000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "event_registration_forms",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("channel", sa.Text(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("purpose", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "channel = 'web'",
            name="event_registration_forms_channel_check",
        ),
        sa.CheckConstraint(
            "status IN ('draft', 'published', 'retired')",
            name="event_registration_forms_status_check",
        ),
        sa.CheckConstraint(
            "version > 0",
            name="event_registration_forms_version_positive_check",
        ),
        sa.CheckConstraint(
            "btrim(purpose) <> ''",
            name="event_registration_forms_purpose_not_empty_check",
        ),
        sa.CheckConstraint(
            "((status = 'draft' AND published_at IS NULL) OR "
            "(status IN ('published', 'retired') AND published_at IS NOT NULL))",
            name="event_registration_forms_published_at_status_check",
        ),
        sa.ForeignKeyConstraint(
            ["event_id"],
            ["events.id"],
            name="event_registration_forms_event_id_fkey",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["app_users.id"],
            name="event_registration_forms_created_by_fkey",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["app_users.id"],
            name="event_registration_forms_updated_by_fkey",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="event_registration_forms_pkey"),
        sa.UniqueConstraint(
            "event_id",
            "channel",
            "version",
            name="event_registration_forms_event_channel_version_key",
        ),
    )
    op.create_index(
        "event_registration_forms_event_id_idx",
        "event_registration_forms",
        ["event_id"],
        unique=False,
    )
    op.create_index(
        "event_registration_forms_one_draft_idx",
        "event_registration_forms",
        ["event_id", "channel"],
        unique=True,
        postgresql_where=sa.text("status = 'draft'"),
    )
    op.create_index(
        "event_registration_forms_one_published_idx",
        "event_registration_forms",
        ["event_id", "channel"],
        unique=True,
        postgresql_where=sa.text("status = 'published'"),
    )

    op.create_table(
        "event_registration_form_fields",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("form_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("field_key", sa.Text(), nullable=False),
        sa.Column("field_type", sa.Text(), nullable=False),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("required", sa.Boolean(), nullable=False),
        sa.Column("purpose", sa.Text(), nullable=False),
        sa.Column("retention_days", sa.Integer(), nullable=False),
        sa.Column(
            "options_payload",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "validation_payload",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("data_category", sa.Text(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "field_type IN ('short_text', 'long_text', 'single_select', "
            "'multi_select', 'boolean')",
            name="event_registration_form_fields_type_check",
        ),
        sa.CheckConstraint(
            "data_category = 'ordinary'",
            name="event_registration_form_fields_data_category_check",
        ),
        sa.CheckConstraint(
            "btrim(field_key) <> ''",
            name="event_registration_form_fields_key_not_empty_check",
        ),
        sa.CheckConstraint(
            "btrim(label) <> ''",
            name="event_registration_form_fields_label_not_empty_check",
        ),
        sa.CheckConstraint(
            "btrim(purpose) <> ''",
            name="event_registration_form_fields_purpose_not_empty_check",
        ),
        sa.CheckConstraint(
            "retention_days > 0",
            name="event_registration_form_fields_retention_positive_check",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(options_payload) = 'array'",
            name="event_registration_form_fields_options_array_check",
        ),
        sa.CheckConstraint(
            "((field_type IN ('single_select', 'multi_select') "
            "AND jsonb_array_length(options_payload) > 0) OR "
            "(field_type IN ('short_text', 'long_text', 'boolean') "
            "AND options_payload = '[]'::jsonb))",
            name="event_registration_form_fields_options_by_type_check",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(validation_payload) = 'object'",
            name="event_registration_form_fields_validation_object_check",
        ),
        sa.ForeignKeyConstraint(
            ["form_id"],
            ["event_registration_forms.id"],
            name="event_registration_form_fields_form_id_fkey",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "id",
            name="event_registration_form_fields_pkey",
        ),
        sa.UniqueConstraint(
            "form_id",
            "field_key",
            name="event_registration_form_fields_form_key_key",
        ),
    )
    op.create_index(
        "event_registration_form_fields_form_sort_idx",
        "event_registration_form_fields",
        ["form_id", "sort_order", "id"],
        unique=False,
    )

    op.execute(
        """
        CREATE FUNCTION protect_event_registration_form_versions()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          IF TG_OP = 'DELETE' THEN
            IF OLD.status IN ('published', 'retired') AND pg_trigger_depth() = 1 THEN
              RAISE EXCEPTION 'published questionnaire versions are immutable'
                USING ERRCODE = '23514';
            END IF;
            RETURN OLD;
          END IF;

          IF OLD.status = 'retired' THEN
            RAISE EXCEPTION 'retired questionnaire versions are immutable'
              USING ERRCODE = '23514';
          END IF;

          IF OLD.status = 'published' THEN
            IF NEW.status = 'retired'
               AND NEW.event_id IS NOT DISTINCT FROM OLD.event_id
               AND NEW.channel IS NOT DISTINCT FROM OLD.channel
               AND NEW.version IS NOT DISTINCT FROM OLD.version
               AND NEW.purpose IS NOT DISTINCT FROM OLD.purpose
               AND NEW.created_by IS NOT DISTINCT FROM OLD.created_by
               AND NEW.published_at IS NOT DISTINCT FROM OLD.published_at
               AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at THEN
              RETURN NEW;
            END IF;
            RAISE EXCEPTION 'published questionnaire versions are immutable'
              USING ERRCODE = '23514';
          END IF;

          RETURN NEW;
        END;
        $$
        """,
    )
    op.execute(
        """
        CREATE TRIGGER event_registration_forms_immutable_trigger
        BEFORE UPDATE OR DELETE ON event_registration_forms
        FOR EACH ROW EXECUTE FUNCTION protect_event_registration_form_versions()
        """,
    )
    op.execute(
        """
        CREATE FUNCTION protect_event_registration_form_fields()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        DECLARE
          parent_status text;
        BEGIN
          IF TG_OP = 'DELETE' THEN
            SELECT status INTO parent_status
              FROM event_registration_forms WHERE id = OLD.form_id;
            IF parent_status IS NULL OR pg_trigger_depth() > 1 THEN
              RETURN OLD;
            END IF;
            IF parent_status <> 'draft' THEN
              RAISE EXCEPTION 'published questionnaire fields are immutable'
                USING ERRCODE = '23514';
            END IF;
            RETURN OLD;
          END IF;

          SELECT status INTO parent_status
            FROM event_registration_forms WHERE id = NEW.form_id;
          IF parent_status IS DISTINCT FROM 'draft' THEN
            RAISE EXCEPTION 'questionnaire fields may only change on drafts'
              USING ERRCODE = '23514';
          END IF;
          IF TG_OP = 'UPDATE' AND OLD.form_id IS DISTINCT FROM NEW.form_id THEN
            SELECT status INTO parent_status
              FROM event_registration_forms WHERE id = OLD.form_id;
            IF parent_status IS DISTINCT FROM 'draft' THEN
              RAISE EXCEPTION 'published questionnaire fields are immutable'
                USING ERRCODE = '23514';
            END IF;
          END IF;
          RETURN NEW;
        END;
        $$
        """,
    )
    op.execute(
        """
        CREATE TRIGGER event_registration_form_fields_immutable_trigger
        BEFORE INSERT OR UPDATE OR DELETE ON event_registration_form_fields
        FOR EACH ROW EXECUTE FUNCTION protect_event_registration_form_fields()
        """,
    )


def downgrade() -> None:
    op.execute(
        "DROP TRIGGER event_registration_form_fields_immutable_trigger "
        "ON event_registration_form_fields",
    )
    op.execute(
        "DROP FUNCTION protect_event_registration_form_fields()",
    )
    op.execute(
        "DROP TRIGGER event_registration_forms_immutable_trigger "
        "ON event_registration_forms",
    )
    op.execute(
        "DROP FUNCTION protect_event_registration_form_versions()",
    )
    op.drop_index(
        "event_registration_form_fields_form_sort_idx",
        table_name="event_registration_form_fields",
    )
    op.drop_table("event_registration_form_fields")
    op.drop_index(
        "event_registration_forms_one_published_idx",
        table_name="event_registration_forms",
    )
    op.drop_index(
        "event_registration_forms_one_draft_idx",
        table_name="event_registration_forms",
    )
    op.drop_index(
        "event_registration_forms_event_id_idx",
        table_name="event_registration_forms",
    )
    op.drop_table("event_registration_forms")
