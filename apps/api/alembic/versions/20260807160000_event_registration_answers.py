"""Add final event questionnaire answers and intent form binding.

Revision ID: 20260807160000
Revises: 20260807120000
Create Date: 2026-08-07 16:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260807160000"
down_revision: str | Sequence[str] | None = "20260807120000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for constraint_name, column_name in (
        ("privacy_destruction_evidence_categories_deleted_check", "categories_deleted"),
        ("privacy_destruction_evidence_categories_retained_check", "categories_retained"),
    ):
        op.drop_constraint(
            constraint_name,
            "privacy_destruction_evidence",
            type_="check",
        )
        op.create_check_constraint(
            constraint_name,
            "privacy_destruction_evidence",
            f"jsonb_typeof({column_name}) = 'array' AND {column_name} <@ "
            "'[\"account\", \"profile\", \"contact\", \"membership\", "
            "\"registration\", \"credential\", \"session\", \"device\", "
            "\"synced_contact\", \"avatar\", \"privacy_request_content\", "
            "\"prayer_activity\", \"legal_acceptance\", \"feedback\", "
            "\"web_registration_intent\", \"questionnaire_answer\"]'::jsonb",
        )

    op.add_column(
        "web_registration_intents",
        sa.Column(
            "questionnaire_form_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.create_foreign_key(
        "web_registration_intents_questionnaire_form_id_fkey",
        "web_registration_intents",
        "event_registration_forms",
        ["questionnaire_form_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.create_table(
        "event_registration_answers",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("registration_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("field_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "value_payload",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("purge_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "jsonb_typeof(value_payload) IN ('string', 'boolean') OR "
            "(jsonb_typeof(value_payload) = 'array' AND "
            "NOT jsonb_path_exists(value_payload, "
            "'$[*] ? (@.type() != \"string\")'))",
            name="event_registration_answers_value_shape_check",
        ),
        sa.ForeignKeyConstraint(
            ["registration_id"],
            ["event_registrations.id"],
            name="event_registration_answers_registration_id_fkey",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["field_id"],
            ["event_registration_form_fields.id"],
            name="event_registration_answers_field_id_fkey",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="event_registration_answers_pkey"),
        sa.UniqueConstraint(
            "registration_id",
            "field_id",
            name="event_registration_answers_registration_field_key",
        ),
    )
    op.create_index(
        "event_registration_answers_registration_id_idx",
        "event_registration_answers",
        ["registration_id"],
        unique=False,
    )
    op.create_index(
        "event_registration_answers_purge_at_idx",
        "event_registration_answers",
        ["purge_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "event_registration_answers_purge_at_idx",
        table_name="event_registration_answers",
    )
    op.drop_index(
        "event_registration_answers_registration_id_idx",
        table_name="event_registration_answers",
    )
    op.drop_table("event_registration_answers")
    op.drop_constraint(
        "web_registration_intents_questionnaire_form_id_fkey",
        "web_registration_intents",
        type_="foreignkey",
    )
    op.drop_column("web_registration_intents", "questionnaire_form_id")
    for constraint_name, column_name in (
        ("privacy_destruction_evidence_categories_deleted_check", "categories_deleted"),
        ("privacy_destruction_evidence_categories_retained_check", "categories_retained"),
    ):
        op.drop_constraint(
            constraint_name,
            "privacy_destruction_evidence",
            type_="check",
        )
        op.create_check_constraint(
            constraint_name,
            "privacy_destruction_evidence",
            f"jsonb_typeof({column_name}) = 'array' AND {column_name} <@ "
            "'[\"account\", \"profile\", \"contact\", \"membership\", "
            "\"registration\", \"credential\", \"session\", \"device\", "
            "\"synced_contact\", \"avatar\", \"privacy_request_content\", "
            "\"prayer_activity\", \"legal_acceptance\", \"feedback\", "
            "\"web_registration_intent\"]'::jsonb",
        )
