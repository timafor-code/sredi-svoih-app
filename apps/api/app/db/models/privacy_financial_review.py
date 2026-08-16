from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, Index, Integer, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models.base import Base


class PrivacyFinancialReviewEvidence(Base):
    """Data-minimal financial evidence retained while the live account is erased."""

    __tablename__ = "privacy_financial_review_evidence"
    __table_args__ = (
        CheckConstraint(
            "btrim(subject_ref_hash) <> ''",
            name="privacy_financial_review_evidence_subject_hash_not_empty",
        ),
        CheckConstraint(
            "financial_state IN ('succeeded', 'paid', 'refunded')",
            name="privacy_financial_review_evidence_state_check",
        ),
        CheckConstraint(
            "observed_amount >= 0",
            name="privacy_financial_review_evidence_amount_nonnegative",
        ),
        CheckConstraint(
            "jsonb_typeof(currency_codes) = 'array'",
            name="privacy_financial_review_evidence_currency_array_check",
        ),
        CheckConstraint(
            "NOT jsonb_path_exists(currency_codes, '$[*] ? (@.type() != \"string\")')",
            name="privacy_financial_review_evidence_currency_strings_check",
        ),
        CheckConstraint(
            "retention_basis_code = 'inconsistent_finalized_event_registration_financial'",
            name="privacy_financial_review_evidence_basis_check",
        ),
        CheckConstraint(
            "retention_until >= created_at",
            name="privacy_financial_review_evidence_retention_after_created",
        ),
        UniqueConstraint(
            "source_registration_id",
            name="privacy_financial_review_evidence_source_registration_key",
        ),
        Index(
            "privacy_financial_review_evidence_subject_ref_hash_idx",
            "subject_ref_hash",
        ),
        Index(
            "privacy_financial_review_evidence_retention_until_idx",
            "retention_until",
        ),
    )

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    subject_ref_hash: Mapped[str] = mapped_column(Text, nullable=False)
    source_registration_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        nullable=False,
    )
    source_event_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        nullable=False,
    )
    financial_state: Mapped[str] = mapped_column(Text, nullable=False)
    observed_amount: Mapped[int] = mapped_column(Integer, nullable=False)
    currency_codes: Mapped[list[Any]] = mapped_column(JSONB, nullable=False)
    retention_basis_code: Mapped[str] = mapped_column(Text, nullable=False)
    retention_until: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
