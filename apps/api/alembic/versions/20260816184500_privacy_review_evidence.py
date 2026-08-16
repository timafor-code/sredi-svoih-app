"""Add data-minimal evidence for inconsistent finalized financial state.

Revision ID: 20260816184500
Revises: 20260813210000
Create Date: 2026-08-16 18:45:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260816184500"
down_revision: str | Sequence[str] | None = "20260813210000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "privacy_financial_review_evidence",
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
        sa.Column("observed_amount", sa.Integer(), nullable=False),
        sa.Column("currency_codes", postgresql.JSONB(), nullable=False),
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
            name="privacy_financial_review_evidence_subject_hash_not_empty",
        ),
        sa.CheckConstraint(
            "financial_state IN ('succeeded', 'paid', 'refunded')",
            name="privacy_financial_review_evidence_state_check",
        ),
        sa.CheckConstraint(
            "observed_amount >= 0",
            name="privacy_financial_review_evidence_amount_nonnegative",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(currency_codes) = 'array'",
            name="privacy_financial_review_evidence_currency_array_check",
        ),
        sa.CheckConstraint(
            "retention_basis_code = 'inconsistent_finalized_event_registration_financial'",
            name="privacy_financial_review_evidence_basis_check",
        ),
        sa.CheckConstraint(
            "retention_until >= created_at",
            name="privacy_financial_review_evidence_retention_after_created",
        ),
        sa.PrimaryKeyConstraint(
            "id",
            name="privacy_financial_review_evidence_pkey",
        ),
        sa.UniqueConstraint(
            "source_registration_id",
            name="privacy_financial_review_evidence_source_registration_key",
        ),
    )
    op.create_index(
        "privacy_financial_review_evidence_subject_ref_hash_idx",
        "privacy_financial_review_evidence",
        ["subject_ref_hash"],
    )
    op.create_index(
        "privacy_financial_review_evidence_retention_until_idx",
        "privacy_financial_review_evidence",
        ["retention_until"],
    )


def downgrade() -> None:
    retained_count = int(
        op.get_bind().scalar(
            sa.text("SELECT count(*) FROM privacy_financial_review_evidence"),
        )
        or 0,
    )
    if retained_count:
        raise RuntimeError(
            "privacy financial review evidence downgrade blocked; "
            f"aggregate row count: {retained_count}",
        )
    op.drop_index(
        "privacy_financial_review_evidence_retention_until_idx",
        table_name="privacy_financial_review_evidence",
    )
    op.drop_index(
        "privacy_financial_review_evidence_subject_ref_hash_idx",
        table_name="privacy_financial_review_evidence",
    )
    op.drop_table("privacy_financial_review_evidence")
