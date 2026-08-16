from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.db.models.core import (
    EventRegistration,
    EventRegistrationOptionSelection,
    PrivacyRequest,
    PrivacyRetainedFinancialEvidence,
)
from app.db.models.privacy_financial_review import PrivacyFinancialReviewEvidence

FINALIZED_FINANCIAL_STATES = frozenset({"succeeded", "paid", "refunded"})
NON_RETAINED_PAYMENT_STATES = frozenset(
    {"not_required", "pending", "failed", "cancelled"},
)
RETENTION_BASIS_CODE = "finalized_event_registration_financial"
REVIEW_RETENTION_BASIS_CODE = (
    "inconsistent_finalized_event_registration_financial"
)
RETAINED_FINANCIAL_CATEGORY = "financial_evidence"
_MANUAL_REVIEW_FAILURE_CODE = "privacy_erasure_manual_review_required"
_RETENTION_CONFIGURATION_FAILURE_CODE = (
    "privacy_erasure_retention_configuration_unavailable"
)
_REVIEW_RECOVERY_FAILURE_CODES = frozenset(
    {
        _MANUAL_REVIEW_FAILURE_CODE,
        _RETENTION_CONFIGURATION_FAILURE_CODE,
    },
)


class PrivacyErasureRetentionConfigurationError(RuntimeError):
    pass


class PrivacyErasureRetentionClassificationError(RuntimeError):
    pass


@dataclass(frozen=True)
class RetainedFinancialCandidate:
    source_registration_id: UUID
    source_event_id: UUID
    financial_state: str
    amount: int
    currency: str


@dataclass(frozen=True)
class FinancialReviewCandidate:
    source_registration_id: UUID
    source_event_id: UUID
    financial_state: str
    observed_amount: int
    currency_codes: tuple[str, ...]


@dataclass(frozen=True)
class PrivacyErasureRetentionPlan:
    financial_candidates: tuple[RetainedFinancialCandidate, ...]
    review_candidates: tuple[FinancialReviewCandidate, ...]
    retention_days: int | None

    @property
    def has_retention(self) -> bool:
        return bool(self.financial_candidates or self.review_candidates)

    def retention_until(self, completed_at: datetime) -> datetime | None:
        if not self.has_retention:
            return None
        if self.retention_days is None:
            raise PrivacyErasureRetentionConfigurationError(
                "financial retention duration is unavailable",
            )
        return completed_at + timedelta(days=self.retention_days)


@dataclass
class _RegistrationAggregate:
    source_registration_id: UUID
    source_event_id: UUID
    financial_state: str
    amount: int = 0
    currencies: set[str] = field(default_factory=set)


async def _review_evidence_recovery_allowed(
    session: AsyncSession,
    user_id: UUID,
) -> bool:
    request_id = await session.scalar(
        select(PrivacyRequest.id)
        .where(
            PrivacyRequest.user_id == user_id,
            PrivacyRequest.request_type == "deletion",
            PrivacyRequest.processing_stopped_at.is_not(None),
            PrivacyRequest.cancelled_at.is_(None),
            PrivacyRequest.completed_at.is_(None),
            PrivacyRequest.destruction_evidence_id.is_(None),
            or_(
                PrivacyRequest.failure_code.in_(_REVIEW_RECOVERY_FAILURE_CODES),
                PrivacyRequest.execution_started_at.is_not(None),
            ),
        )
        .order_by(PrivacyRequest.created_at, PrivacyRequest.id)
        .limit(1),
    )
    return request_id is not None


async def plan_privacy_erasure_retention(
    session: AsyncSession,
    user_id: UUID,
    *,
    settings: Settings,
) -> PrivacyErasureRetentionPlan:
    rows = (
        await session.execute(
            select(
                EventRegistration.id,
                EventRegistration.event_id,
                EventRegistration.payment_status,
                EventRegistrationOptionSelection.total_amount,
                EventRegistrationOptionSelection.currency,
            )
            .outerjoin(
                EventRegistrationOptionSelection,
                EventRegistrationOptionSelection.registration_id
                == EventRegistration.id,
            )
            .where(EventRegistration.user_id == user_id)
            .order_by(EventRegistration.id),
        )
    ).all()

    aggregates: dict[UUID, _RegistrationAggregate] = {}
    supported_states = FINALIZED_FINANCIAL_STATES | NON_RETAINED_PAYMENT_STATES
    for row in rows:
        registration_id = row.id
        aggregate = aggregates.setdefault(
            registration_id,
            _RegistrationAggregate(
                source_registration_id=registration_id,
                source_event_id=row.event_id,
                financial_state=row.payment_status,
            ),
        )
        if aggregate.financial_state not in supported_states:
            raise PrivacyErasureRetentionClassificationError(
                "unsupported payment state requires manual review",
            )
        if row.total_amount is not None:
            aggregate.amount += row.total_amount
        if row.currency is not None and row.currency.strip():
            aggregate.currencies.add(row.currency.strip().upper())

    allow_review_evidence = await _review_evidence_recovery_allowed(
        session,
        user_id,
    )
    candidates: list[RetainedFinancialCandidate] = []
    review_candidates: list[FinancialReviewCandidate] = []
    for aggregate in aggregates.values():
        if aggregate.financial_state not in FINALIZED_FINANCIAL_STATES:
            continue
        if aggregate.amount > 0 and len(aggregate.currencies) == 1:
            candidates.append(
                RetainedFinancialCandidate(
                    source_registration_id=aggregate.source_registration_id,
                    source_event_id=aggregate.source_event_id,
                    financial_state=aggregate.financial_state,
                    amount=aggregate.amount,
                    currency=next(iter(aggregate.currencies)),
                ),
            )
            continue
        if not allow_review_evidence:
            raise PrivacyErasureRetentionClassificationError(
                "finalized financial state has inconsistent amount or currency",
            )
        review_candidates.append(
            FinancialReviewCandidate(
                source_registration_id=aggregate.source_registration_id,
                source_event_id=aggregate.source_event_id,
                financial_state=aggregate.financial_state,
                observed_amount=max(aggregate.amount, 0),
                currency_codes=tuple(sorted(aggregate.currencies)),
            ),
        )

    retention_days = settings.api_privacy_erasure_financial_retention_days
    if (candidates or review_candidates) and retention_days is None:
        raise PrivacyErasureRetentionConfigurationError(
            "financial retention duration is unavailable",
        )
    return PrivacyErasureRetentionPlan(
        tuple(candidates),
        tuple(review_candidates),
        retention_days,
    )


async def create_retained_financial_evidence(
    session: AsyncSession,
    *,
    plan: PrivacyErasureRetentionPlan,
    subject_ref_hash: str,
    completed_at: datetime,
) -> datetime | None:
    retention_until = plan.retention_until(completed_at)
    if retention_until is None:
        return None
    session.add_all(
        [
            PrivacyRetainedFinancialEvidence(
                subject_ref_hash=subject_ref_hash,
                source_registration_id=candidate.source_registration_id,
                source_event_id=candidate.source_event_id,
                financial_state=candidate.financial_state,
                amount=candidate.amount,
                currency=candidate.currency,
                retention_basis_code=RETENTION_BASIS_CODE,
                retention_until=retention_until,
                created_at=completed_at,
            )
            for candidate in plan.financial_candidates
        ]
        + [
            PrivacyFinancialReviewEvidence(
                subject_ref_hash=subject_ref_hash,
                source_registration_id=candidate.source_registration_id,
                source_event_id=candidate.source_event_id,
                financial_state=candidate.financial_state,
                observed_amount=candidate.observed_amount,
                currency_codes=list(candidate.currency_codes),
                retention_basis_code=REVIEW_RETENTION_BASIS_CODE,
                retention_until=retention_until,
                created_at=completed_at,
            )
            for candidate in plan.review_candidates
        ],
    )
    await session.flush()
    return retention_until
