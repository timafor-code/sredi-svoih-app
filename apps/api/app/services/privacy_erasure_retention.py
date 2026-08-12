from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.db.models.core import (
    EventRegistration,
    EventRegistrationOptionSelection,
    PrivacyRetainedFinancialEvidence,
)

FINALIZED_FINANCIAL_STATES = frozenset({"succeeded", "paid", "refunded"})
NON_RETAINED_PAYMENT_STATES = frozenset(
    {"not_required", "pending", "failed", "cancelled"},
)
RETENTION_BASIS_CODE = "finalized_event_registration_financial"
RETAINED_FINANCIAL_CATEGORY = "financial_evidence"


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
class PrivacyErasureRetentionPlan:
    financial_candidates: tuple[RetainedFinancialCandidate, ...]
    retention_days: int | None

    @property
    def has_retention(self) -> bool:
        return bool(self.financial_candidates)

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

    candidates: list[RetainedFinancialCandidate] = []
    for aggregate in aggregates.values():
        if aggregate.financial_state not in FINALIZED_FINANCIAL_STATES:
            continue
        if aggregate.amount <= 0 or len(aggregate.currencies) != 1:
            raise PrivacyErasureRetentionClassificationError(
                "finalized financial state has inconsistent amount or currency",
            )
        candidates.append(
            RetainedFinancialCandidate(
                source_registration_id=aggregate.source_registration_id,
                source_event_id=aggregate.source_event_id,
                financial_state=aggregate.financial_state,
                amount=aggregate.amount,
                currency=next(iter(aggregate.currencies)),
            ),
        )

    retention_days = settings.api_privacy_erasure_financial_retention_days
    if candidates and retention_days is None:
        raise PrivacyErasureRetentionConfigurationError(
            "financial retention duration is unavailable",
        )
    return PrivacyErasureRetentionPlan(tuple(candidates), retention_days)


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
        ],
    )
    await session.flush()
    return retention_until
