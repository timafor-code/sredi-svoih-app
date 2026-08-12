"""Add minimal financial evidence for selective privacy erasure retention.

Revision ID: 20260812120000
Revises: 20260810120000
Create Date: 2026-08-12 12:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260812120000"
down_revision: str | Sequence[str] | None = "20260810120000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CATEGORY_VALUES = (
    '["account", "profile", "contact", "membership", "registration", '
    '"credential", "session", "device", "synced_contact", "avatar", '
    '"privacy_request_content", "prayer_activity", "legal_acceptance", '
    '"feedback", "web_registration_intent", "questionnaire_answer"'
)


def _replace_retained_categories_constraint(*, include_financial: bool) -> None:
    op.drop_constraint(
        "privacy_destruction_evidence_categories_retained_check",
        "privacy_destruction_evidence",
        type_="check",
    )
    values = _CATEGORY_VALUES
    if include_financial:
        values += ', "financial_evidence"'
    values += "]"
    op.create_check_constraint(
        "privacy_destruction_evidence_categories_retained_check",
        "privacy_destruction_evidence",
        f"jsonb_typeof(categories_retained) = 'array' AND "
        f"categories_retained <@ '{values}'::jsonb",
    )


def upgrade() -> None:
    op.create_table(
        "privacy_retained_financial_evidence",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("subject_ref_hash", sa.Text(), nullable=False),
        sa.Column(
            "source_registration_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "source_event_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column("financial_state", sa.Text(), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("currency", sa.Text(), nullable=False),
        sa.Column("retention_basis_code", sa.Text(), nullable=False),
        sa.Column("retention_until", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "btrim(subject_ref_hash) <> ''",
            name="privacy_retained_financial_evidence_subject_hash_not_empty",
        ),
        sa.CheckConstraint(
            "financial_state IN ('succeeded', 'paid', 'refunded')",
            name="privacy_retained_financial_evidence_state_check",
        ),
        sa.CheckConstraint(
            "amount > 0",
            name="privacy_retained_financial_evidence_amount_positive",
        ),
        sa.CheckConstraint(
            "btrim(currency) <> ''",
            name="privacy_retained_financial_evidence_currency_not_empty",
        ),
        sa.CheckConstraint(
            "retention_basis_code = 'finalized_event_registration_financial'",
            name="privacy_retained_financial_evidence_basis_check",
        ),
        sa.CheckConstraint(
            "retention_until >= created_at",
            name="privacy_retained_financial_evidence_retention_after_created",
        ),
        sa.PrimaryKeyConstraint(
            "id",
            name="privacy_retained_financial_evidence_pkey",
        ),
        sa.UniqueConstraint(
            "source_registration_id",
            name="privacy_retained_financial_evidence_source_registration_key",
        ),
    )
    op.create_index(
        "privacy_retained_financial_evidence_subject_ref_hash_idx",
        "privacy_retained_financial_evidence",
        ["subject_ref_hash"],
    )
    op.create_index(
        "privacy_retained_financial_evidence_retention_until_idx",
        "privacy_retained_financial_evidence",
        ["retention_until"],
    )
    _replace_retained_categories_constraint(include_financial=True)


def downgrade() -> None:
    retained_count = int(
        op.get_bind().scalar(
            sa.text(
                "SELECT "
                "(SELECT count(*) FROM privacy_retained_financial_evidence) + "
                "(SELECT count(*) FROM privacy_destruction_evidence "
                "WHERE categories_retained @> '[\"financial_evidence\"]'::jsonb)",
            ),
        )
        or 0,
    )
    if retained_count:
        raise RuntimeError(
            "privacy financial retention downgrade blocked; "
            f"aggregate row count: {retained_count}",
        )
    _replace_retained_categories_constraint(include_financial=False)
    op.drop_index(
        "privacy_retained_financial_evidence_retention_until_idx",
        table_name="privacy_retained_financial_evidence",
    )
    op.drop_index(
        "privacy_retained_financial_evidence_subject_ref_hash_idx",
        table_name="privacy_retained_financial_evidence",
    )
    op.drop_table("privacy_retained_financial_evidence")
