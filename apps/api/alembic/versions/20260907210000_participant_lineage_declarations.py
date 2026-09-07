"""Add participant lineage declarations with a dedicated special-category consent.

Revision ID: 20260907210000
Revises: 20260907200000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260907210000"
down_revision: str | Sequence[str] | None = "20260907200000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_OLD_DOCUMENT_TYPES = (
    "privacy_policy",
    "event_registration_consent",
    "marketing_consent",
)
_NEW_DOCUMENT_TYPES = _OLD_DOCUMENT_TYPES + ("special_category_consent",)

_OLD_DELETED_CATEGORIES = (
    "account",
    "profile",
    "contact",
    "membership",
    "registration",
    "credential",
    "session",
    "device",
    "synced_contact",
    "avatar",
    "privacy_request_content",
    "prayer_activity",
    "legal_acceptance",
    "feedback",
    "web_registration_intent",
    "questionnaire_answer",
)
_NEW_DELETED_CATEGORIES = _OLD_DELETED_CATEGORIES + ("lineage_declaration",)


def _replace_document_type_constraint(document_types: tuple[str, ...]) -> None:
    values = ", ".join(f"'{item}'" for item in document_types)
    op.drop_constraint(
        "legal_documents_document_type_check",
        "legal_documents",
        type_="check",
    )
    op.create_check_constraint(
        "legal_documents_document_type_check",
        "legal_documents",
        f"document_type IN ({values})",
    )


def _replace_deleted_categories_constraint(categories: tuple[str, ...]) -> None:
    values = ", ".join(f'"{item}"' for item in categories)
    op.drop_constraint(
        "privacy_destruction_evidence_categories_deleted_check",
        "privacy_destruction_evidence",
        type_="check",
    )
    op.create_check_constraint(
        "privacy_destruction_evidence_categories_deleted_check",
        "privacy_destruction_evidence",
        "jsonb_typeof(categories_deleted) = 'array' "
        f"AND categories_deleted <@ '[{values}]'::jsonb",
    )


def upgrade() -> None:
    op.create_table(
        "participant_lineage_declarations",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("community_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("values", postgresql.JSONB(), nullable=False),
        sa.Column("consent_acceptance_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_channel", sa.Text(), nullable=False),
        sa.Column("declared_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "source_channel IN ('mobile', 'public_web', 'admin')",
            name="participant_lineage_declarations_source_channel_check",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(\"values\") = 'array' "
            "AND jsonb_array_length(\"values\") > 0 "
            "AND \"values\" <@ '[\"maternal_grandmother\", \"maternal_grandfather\", "
            "\"paternal_grandmother\", \"paternal_grandfather\", \"father\", \"mother\", "
            "\"giyur\", \"unknown\"]'::jsonb",
            name="participant_lineage_declarations_values_allowlist_check",
        ),
        sa.CheckConstraint(
            "NOT (\"values\" @> '[\"unknown\"]'::jsonb AND jsonb_array_length(\"values\") > 1)",
            name="participant_lineage_declarations_unknown_exclusive_check",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["app_users.id"],
            name="participant_lineage_declarations_user_id_fkey",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["community_id"],
            ["communities.id"],
            name="participant_lineage_declarations_community_id_fkey",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["consent_acceptance_id"],
            ["legal_acceptances.id"],
            name="participant_lineage_declarations_consent_acceptance_id_fkey",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="participant_lineage_declarations_pkey"),
        sa.UniqueConstraint(
            "user_id",
            name="participant_lineage_declarations_user_id_key",
        ),
    )
    op.create_index(
        "participant_lineage_declarations_community_id_idx",
        "participant_lineage_declarations",
        ["community_id"],
    )
    _replace_document_type_constraint(_NEW_DOCUMENT_TYPES)
    _replace_deleted_categories_constraint(_NEW_DELETED_CATEGORIES)


def downgrade() -> None:
    remaining = op.get_bind().scalar(
        sa.text(
            "SELECT count(*) FROM legal_documents "
            "WHERE document_type = 'special_category_consent'",
        ),
    )
    if remaining:
        raise RuntimeError(
            "participant lineage downgrade blocked; "
            f"special_category_consent legal_documents rows: {remaining}",
        )
    _replace_deleted_categories_constraint(_OLD_DELETED_CATEGORIES)
    _replace_document_type_constraint(_OLD_DOCUMENT_TYPES)
    op.drop_index(
        "participant_lineage_declarations_community_id_idx",
        table_name="participant_lineage_declarations",
    )
    op.drop_table("participant_lineage_declarations")
