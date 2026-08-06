from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
import logging
import secrets
from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import func, select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization import get_current_user
from app.core.config import get_settings
from app.core.rate_limits import AuthEmailRateLimitConfig, InMemoryAuthEmailRateLimiter
from app.db.models.auth import PrivacyAccessCode, PrivacyAccessSession
from app.db.models.avatar import ProfileAvatar
from app.db.models.core import (
    AppUser,
    Community,
    CommunityMembership,
    DeviceToken,
    Event,
    EventOccurrence,
    EventRegistration,
    EventRegistrationOptionSelection,
    LegalAcceptance,
    LegalDocument,
    PrivacyRequest,
    Profile,
    SyncedContact,
)
from app.db.session import get_db_session
from app.schemas.privacy import (
    PrivacyAccessAcceptedResponse,
    PrivacyCategorySummary,
    PrivacyDataExportResponse,
    PrivacyDataSummaryResponse,
    PrivacyExcludedCategory,
    PrivacySessionResponse,
)
from app.services.auth_tokens import hash_token, verify_token_hash
from app.services.privacy_email_service import (
    PrivacyEmailDeliveryError,
    send_privacy_access_code,
)

logger = logging.getLogger(__name__)

PRIVACY_SESSION_SCOPE = "privacy_self_service"
PRIVACY_EXPORT_VERSION = "privacy-self-service-v1"
_SESSION_TOKEN_BYTES = 32
_CODE_GENERATION_ATTEMPTS = 20
_bearer_scheme = HTTPBearer(auto_error=False)
_privacy_email_rate_limiter: InMemoryAuthEmailRateLimiter | None = None


@dataclass(frozen=True)
class PrivacySessionPrincipal:
    user_id: UUID


@dataclass(frozen=True)
class PrivacyRequestActor:
    user: AppUser
    via_privacy_session: bool


class _PrivacyDeliveryNotCompleted(RuntimeError):
    pass


def _now() -> datetime:
    return datetime.now(UTC)


def _error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message},
    )


def _invalid_code_error() -> HTTPException:
    return _error(
        status.HTTP_400_BAD_REQUEST,
        "invalid_or_expired_privacy_code",
        "Invalid or expired privacy access code",
    )


def _privacy_session_error(code: str, message: str) -> HTTPException:
    return _error(status.HTTP_401_UNAUTHORIZED, code, message)


def _privacy_rate_limiter() -> InMemoryAuthEmailRateLimiter:
    global _privacy_email_rate_limiter
    if _privacy_email_rate_limiter is None:
        settings = get_settings()
        _privacy_email_rate_limiter = InMemoryAuthEmailRateLimiter(
            AuthEmailRateLimitConfig(
                window_seconds=settings.api_privacy_email_rate_limit_window_seconds,
                max_attempts=settings.api_privacy_email_rate_limit_max_attempts,
            ),
        )
    return _privacy_email_rate_limiter


def _privacy_email_rate_limit_key(normalized_email: str) -> str:
    return hash_token(f"privacy-email-rate-limit:{normalized_email}")


def _privacy_code_hash(user_id: UUID, code: str) -> str:
    return hash_token(f"privacy-access-code:{user_id}:{code}")


def _verify_privacy_code(
    user_id: UUID,
    code: str,
    code_hash: str | None,
) -> bool:
    return verify_token_hash(f"privacy-access-code:{user_id}:{code}", code_hash)


def _privacy_session_hash(token: str) -> str:
    return hash_token(f"privacy-session:{token}")


async def _find_user_by_email(
    session: AsyncSession,
    normalized_email: str,
) -> AppUser | None:
    return await session.scalar(
        select(AppUser)
        .where(
            AppUser.email.is_not(None),
            func.lower(AppUser.email) == normalized_email,
        )
        .with_for_update(),
    )


async def _new_unique_code(
    session: AsyncSession,
    user_id: UUID,
) -> tuple[str, str]:
    for _ in range(_CODE_GENERATION_ATTEMPTS):
        code = f"{secrets.randbelow(1_000_000):06d}"
        code_hash = _privacy_code_hash(user_id, code)
        exists = await session.scalar(
            select(PrivacyAccessCode.id).where(
                PrivacyAccessCode.code_hash == code_hash,
            ),
        )
        if exists is None:
            return code, code_hash
    raise RuntimeError("Unable to generate privacy access credential")


async def request_privacy_access(
    session: AsyncSession,
    *,
    normalized_email: str,
) -> PrivacyAccessAcceptedResponse:
    decision = _privacy_rate_limiter().consume(
        _privacy_email_rate_limit_key(normalized_email),
    )
    if not decision.allowed:
        return PrivacyAccessAcceptedResponse()

    user = await _find_user_by_email(session, normalized_email)
    if user is None or user.email is None or user.erased_at is not None:
        await session.rollback()
        return PrivacyAccessAcceptedResponse()

    settings = get_settings()
    try:
        now = _now()
        code, code_hash = await _new_unique_code(session, user.id)
        await session.execute(
            update(PrivacyAccessCode)
            .where(
                PrivacyAccessCode.user_id == user.id,
                PrivacyAccessCode.consumed_at.is_(None),
            )
            .values(consumed_at=now, updated_at=now)
            .execution_options(synchronize_session=False),
        )
        session.add(
            PrivacyAccessCode(
                user_id=user.id,
                code_hash=code_hash,
                expires_at=now
                + timedelta(minutes=settings.api_privacy_access_code_ttl_minutes),
                created_at=now,
                updated_at=now,
            ),
        )
        await session.flush()
        delivery = send_privacy_access_code(
            to_address=user.email,
            code=code,
            expiration_minutes=settings.api_privacy_access_code_ttl_minutes,
            settings=settings,
        )
        if not delivery.sent:
            raise _PrivacyDeliveryNotCompleted()
        await session.commit()
    except (PrivacyEmailDeliveryError, _PrivacyDeliveryNotCompleted, SQLAlchemyError):
        await session.rollback()
        logger.warning("Privacy access email delivery was not completed")
    except Exception:
        await session.rollback()
        logger.warning("Privacy access request could not be completed")

    return PrivacyAccessAcceptedResponse()


async def confirm_privacy_access(
    session: AsyncSession,
    *,
    normalized_email: str,
    code: str,
) -> PrivacySessionResponse:
    user = await _find_user_by_email(session, normalized_email)
    if user is None or user.erased_at is not None:
        await session.rollback()
        raise _invalid_code_error()

    now = _now()
    settings = get_settings()
    code_row = await session.scalar(
        select(PrivacyAccessCode)
        .where(PrivacyAccessCode.user_id == user.id)
        .order_by(PrivacyAccessCode.created_at.desc(), PrivacyAccessCode.id.desc())
        .limit(1)
        .with_for_update(),
    )
    if code_row is None:
        await session.rollback()
        raise _invalid_code_error()

    code_matches = _verify_privacy_code(user.id, code, code_row.code_hash)
    usable = (
        code_row.consumed_at is None
        and code_row.expires_at > now
        and code_row.attempt_count < settings.api_privacy_access_code_max_attempts
    )
    if not usable or not code_matches:
        if usable and not code_matches:
            code_row.attempt_count += 1
            code_row.updated_at = now
            await session.flush()
            await session.commit()
        else:
            await session.rollback()
        raise _invalid_code_error()

    token = secrets.token_urlsafe(_SESSION_TOKEN_BYTES)
    expires_at = now + timedelta(minutes=settings.api_privacy_session_ttl_minutes)
    code_row.consumed_at = now
    code_row.updated_at = now
    await session.execute(
        update(PrivacyAccessSession)
        .where(
            PrivacyAccessSession.user_id == user.id,
            PrivacyAccessSession.revoked_at.is_(None),
        )
        .values(revoked_at=now)
        .execution_options(synchronize_session=False),
    )
    session.add(
        PrivacyAccessSession(
            user_id=user.id,
            token_hash=_privacy_session_hash(token),
            scope=PRIVACY_SESSION_SCOPE,
            expires_at=expires_at,
            created_at=now,
        ),
    )
    try:
        await session.commit()
    except SQLAlchemyError:
        await session.rollback()
        raise _invalid_code_error() from None

    return PrivacySessionResponse(
        privacy_session_token=token,
        expires_at=expires_at,
    )


async def _resolve_privacy_session_token(
    session: AsyncSession,
    token: str,
    *,
    allow_missing: bool,
) -> tuple[PrivacySessionPrincipal, AppUser] | None:
    try:
        token_hash = _privacy_session_hash(token)
    except ValueError:
        if allow_missing:
            return None
        raise _privacy_session_error(
            "privacy_session_required",
            "Privacy session required",
        ) from None

    privacy_session = await session.scalar(
        select(PrivacyAccessSession)
        .where(PrivacyAccessSession.token_hash == token_hash)
        .with_for_update(),
    )
    if privacy_session is None:
        await session.rollback()
        if allow_missing:
            return None
        raise _privacy_session_error(
            "privacy_session_required",
            "Privacy session required",
        )

    now = _now()
    if privacy_session.scope != PRIVACY_SESSION_SCOPE:
        await session.rollback()
        raise _privacy_session_error(
            "privacy_session_required",
            "Privacy session required",
        )
    if privacy_session.revoked_at is not None:
        await session.rollback()
        raise _privacy_session_error(
            "privacy_session_revoked",
            "Privacy session revoked",
        )
    if privacy_session.expires_at <= now:
        await session.rollback()
        raise _privacy_session_error(
            "privacy_session_expired",
            "Privacy session expired",
        )

    user = await session.get(AppUser, privacy_session.user_id)
    if user is None or user.erased_at is not None:
        privacy_session.revoked_at = now
        await session.commit()
        raise _privacy_session_error(
            "privacy_session_revoked",
            "Privacy session revoked",
        )

    privacy_session.last_used_at = now
    await session.commit()
    return PrivacySessionPrincipal(user_id=user.id), user


async def require_privacy_session(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Security(_bearer_scheme),
    ],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> PrivacySessionPrincipal:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _privacy_session_error(
            "privacy_session_required",
            "Privacy session required",
        )
    resolved = await _resolve_privacy_session_token(
        session,
        credentials.credentials,
        allow_missing=False,
    )
    assert resolved is not None
    return resolved[0]


async def require_auth_or_privacy_session(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Security(_bearer_scheme),
    ],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> PrivacyRequestActor:
    if credentials is not None and credentials.scheme.lower() == "bearer":
        resolved = await _resolve_privacy_session_token(
            session,
            credentials.credentials,
            allow_missing=True,
        )
        if resolved is not None:
            return PrivacyRequestActor(user=resolved[1], via_privacy_session=True)

    user = await get_current_user(credentials, session)
    return PrivacyRequestActor(user=user, via_privacy_session=False)


def _excluded_categories() -> list[PrivacyExcludedCategory]:
    return [
        PrivacyExcludedCategory(
            code="prayer_activity",
            reason="not_available_in_this_export_version",
        ),
        PrivacyExcludedCategory(
            code="feedback_content",
            reason="safe_own_only_export_not_implemented",
        ),
        PrivacyExcludedCategory(
            code="avatar_binary",
            reason="binary_content_not_included",
        ),
        PrivacyExcludedCategory(
            code="synced_contact_hashes",
            reason="third_party_contact_data_not_included",
        ),
    ]


async def build_data_summary(
    session: AsyncSession,
    user_id: UUID,
) -> PrivacyDataSummaryResponse:
    counts = (
        await session.execute(
            select(
                select(func.count(Profile.id))
                .where(Profile.user_id == user_id)
                .scalar_subquery()
                .label("profile"),
                select(func.count(CommunityMembership.id))
                .where(CommunityMembership.user_id == user_id)
                .scalar_subquery()
                .label("memberships"),
                select(func.count(EventRegistration.id))
                .where(EventRegistration.user_id == user_id)
                .scalar_subquery()
                .label("event_registrations"),
                select(func.count(EventRegistrationOptionSelection.id))
                .join(
                    EventRegistration,
                    EventRegistration.id
                    == EventRegistrationOptionSelection.registration_id,
                )
                .where(EventRegistration.user_id == user_id)
                .scalar_subquery()
                .label("registration_options"),
                select(func.count(LegalAcceptance.id))
                .where(LegalAcceptance.user_id == user_id)
                .scalar_subquery()
                .label("legal_acceptances"),
                select(func.count(PrivacyRequest.id))
                .where(PrivacyRequest.user_id == user_id)
                .scalar_subquery()
                .label("privacy_requests"),
                select(func.count(DeviceToken.id))
                .where(DeviceToken.user_id == user_id)
                .scalar_subquery()
                .label("device_metadata"),
                select(func.count(SyncedContact.id))
                .where(SyncedContact.user_id == user_id)
                .scalar_subquery()
                .label("synced_contacts_summary"),
                select(func.count(ProfileAvatar.id))
                .where(
                    ProfileAvatar.user_id == user_id,
                    ProfileAvatar.status == "active",
                    ProfileAvatar.deleted_at.is_(None),
                )
                .scalar_subquery()
                .label("avatar_metadata"),
            ),
        )
    ).one()
    values = {
        "account": 1,
        "profile": counts.profile,
        "memberships": counts.memberships,
        "event_registrations": counts.event_registrations,
        "registration_options": counts.registration_options,
        "legal_acceptances": counts.legal_acceptances,
        "privacy_requests": counts.privacy_requests,
        "device_metadata": counts.device_metadata,
        "synced_contacts_summary": counts.synced_contacts_summary,
        "avatar_metadata": counts.avatar_metadata,
    }
    return PrivacyDataSummaryResponse(
        generated_at=_now(),
        categories=[
            PrivacyCategorySummary(
                code=code,
                record_count=record_count,
                available_for_export=True,
            )
            for code, record_count in values.items()
        ],
        excluded_categories=_excluded_categories(),
    )


async def build_data_export(
    session: AsyncSession,
    user_id: UUID,
) -> PrivacyDataExportResponse:
    try:
        user = await session.get(AppUser, user_id)
        if user is None or user.erased_at is not None:
            raise _error(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "privacy_export_unavailable",
                "Privacy export unavailable",
            )

        profile = await session.scalar(
            select(Profile).where(Profile.user_id == user_id),
        )
        membership_rows = (
            await session.execute(
                select(CommunityMembership, Community)
                .join(Community, Community.id == CommunityMembership.community_id)
                .where(CommunityMembership.user_id == user_id)
                .order_by(CommunityMembership.created_at, CommunityMembership.id),
            )
        ).all()
        registration_rows = (
            await session.execute(
                select(EventRegistration, Event, EventOccurrence)
                .join(Event, Event.id == EventRegistration.event_id)
                .outerjoin(
                    EventOccurrence,
                    EventOccurrence.id == EventRegistration.occurrence_id,
                )
                .where(EventRegistration.user_id == user_id)
                .order_by(EventRegistration.created_at, EventRegistration.id),
            )
        ).all()
        option_rows = list(
            await session.scalars(
                select(EventRegistrationOptionSelection)
                .join(
                    EventRegistration,
                    EventRegistration.id
                    == EventRegistrationOptionSelection.registration_id,
                )
                .where(EventRegistration.user_id == user_id)
                .order_by(
                    EventRegistrationOptionSelection.created_at,
                    EventRegistrationOptionSelection.id,
                ),
            ),
        )
        acceptance_rows = (
            await session.execute(
                select(LegalAcceptance, LegalDocument)
                .join(
                    LegalDocument,
                    LegalDocument.id == LegalAcceptance.legal_document_id,
                )
                .where(LegalAcceptance.user_id == user_id)
                .order_by(LegalAcceptance.accepted_at, LegalAcceptance.id),
            )
        ).all()
        privacy_requests = list(
            await session.scalars(
                select(PrivacyRequest)
                .where(PrivacyRequest.user_id == user_id)
                .order_by(PrivacyRequest.created_at, PrivacyRequest.id),
            ),
        )
        device_tokens = list(
            await session.scalars(
                select(DeviceToken)
                .where(DeviceToken.user_id == user_id)
                .order_by(DeviceToken.created_at, DeviceToken.id),
            ),
        )
        synced_contact_count = await session.scalar(
            select(func.count(SyncedContact.id)).where(
                SyncedContact.user_id == user_id,
            ),
        )
        avatars = list(
            await session.scalars(
                select(ProfileAvatar)
                .where(
                    ProfileAvatar.user_id == user_id,
                    ProfileAvatar.status == "active",
                    ProfileAvatar.deleted_at.is_(None),
                )
                .order_by(ProfileAvatar.created_at, ProfileAvatar.id),
            ),
        )
    except HTTPException:
        raise
    except SQLAlchemyError:
        raise _error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "privacy_export_unavailable",
            "Privacy export unavailable",
        ) from None

    included_categories = [
        "account",
        "profile",
        "memberships",
        "event_registrations",
        "registration_options",
        "legal_acceptances",
        "privacy_requests",
        "device_metadata",
        "synced_contacts_summary",
        "avatar_metadata",
    ]
    return PrivacyDataExportResponse(
        export_version=PRIVACY_EXPORT_VERSION,
        generated_at=_now(),
        included_categories=included_categories,
        excluded_categories=_excluded_categories(),
        account={
            "id": user.id,
            "email": user.email,
            "phone": user.phone,
            "account_origin": user.account_origin,
            "claim_state": user.claim_state,
            "claimed_at": user.claimed_at,
            "deletion_requested_at": user.deletion_requested_at,
            "erased_at": user.erased_at,
            "status": user.status,
            "email_verified_at": user.email_verified_at,
            "phone_verified_at": user.phone_verified_at,
            "created_at": user.created_at,
            "updated_at": user.updated_at,
        },
        profile=(
            {
                "id": profile.id,
                "user_id": profile.user_id,
                "community_id": profile.community_id,
                "full_name": profile.full_name,
                "hebrew_name": profile.hebrew_name,
                "display_name": profile.display_name,
                "first_name": profile.first_name,
                "last_name": profile.last_name,
                "phone": profile.phone,
                "email": profile.email,
                "birth_date": profile.birth_date,
                "hebrew_birth_date": profile.hebrew_birth_date,
                "birth_time_context": profile.birth_time_context,
                "nusach": profile.nusach,
                "city": profile.city,
                "tribe_status": profile.tribe_status,
                "marital_status": profile.marital_status,
                "about": profile.about,
                "profile_visibility": profile.profile_visibility,
                "birthday_visibility": profile.birthday_visibility,
                "phone_visibility": profile.phone_visibility,
                "notification_preferences": profile.notification_preferences,
                "onboarding_completed": profile.onboarding_completed,
                "created_at": profile.created_at,
                "updated_at": profile.updated_at,
            }
            if profile is not None
            else None
        ),
        memberships=[
            {
                "id": membership.id,
                "community_id": community.id,
                "community_name": community.name,
                "community_city": community.city,
                "community_slug": community.slug,
                "role": membership.role,
                "status": membership.status,
                "joined_at": membership.joined_at,
                "created_at": membership.created_at,
            }
            for membership, community in membership_rows
        ],
        event_registrations=[
            {
                "registration_id": registration.id,
                "event_id": event.id,
                "event_title": event.title,
                "occurrence_id": registration.occurrence_id,
                "occurrence_start": occurrence.starts_at if occurrence else None,
                "status": registration.status,
                "seats_count": registration.seats_count,
                "source_channel": registration.source_channel,
                "created_at": registration.created_at,
                "updated_at": registration.updated_at,
            }
            for registration, event, occurrence in registration_rows
        ],
        registration_options=[
            {
                "id": option.id,
                "registration_id": option.registration_id,
                "option_id": option.option_id,
                "title_snapshot": option.title_snapshot,
                "description_snapshot": option.description_snapshot,
                "option_type_snapshot": option.option_type_snapshot,
                "quantity": option.quantity,
                "unit_price_amount": option.unit_price_amount,
                "total_amount": option.total_amount,
                "currency": option.currency,
                "counts_toward_capacity": option.counts_toward_capacity,
                "seats_count": option.seats_count,
                "is_donation": option.is_donation,
                "created_at": option.created_at,
            }
            for option in option_rows
        ],
        legal_acceptances=[
            {
                "acceptance_id": acceptance.id,
                "registration_id": acceptance.registration_id,
                "accepted_at": acceptance.accepted_at,
                "acceptance_method": acceptance.acceptance_method,
                "source_channel": acceptance.source_channel,
                "evidence_version": acceptance.evidence_version,
                "retention_until": acceptance.retention_until,
                "legal_document": {
                    "document_type": document.document_type,
                    "version": document.version,
                    "title": document.title,
                    "content_hash": document.content_hash,
                    "published_url": document.published_url,
                    "effective_at": document.effective_at,
                    "retired_at": document.retired_at,
                },
            }
            for acceptance, document in acceptance_rows
        ],
        privacy_requests=[
            {
                "id": item.id,
                "community_id": item.community_id,
                "request_type": item.request_type,
                "message": item.message,
                "status": item.status,
                "resolution_note": item.resolution_note,
                "resolved_at": item.resolved_at,
                "identity_verified_at": item.identity_verified_at,
                "processing_stopped_at": item.processing_stopped_at,
                "execution_started_at": item.execution_started_at,
                "completed_at": item.completed_at,
                "due_at": item.due_at,
                "failure_code": item.failure_code,
                "created_at": item.created_at,
                "updated_at": item.updated_at,
            }
            for item in privacy_requests
        ],
        device_metadata=[
            {
                "id": item.id,
                "platform": item.platform,
                "device_id": item.device_id,
                "app_version": item.app_version,
                "build_version": item.build_version,
                "environment": item.environment,
                "is_active": item.is_active,
                "created_at": item.created_at,
                "updated_at": item.updated_at,
                "last_seen_at": item.last_seen_at,
            }
            for item in device_tokens
        ],
        synced_contacts_summary={"record_count": synced_contact_count or 0},
        avatar_metadata=[
            {
                "id": avatar.id,
                "content_type": avatar.content_type,
                "size_bytes": avatar.size_bytes,
                "status": avatar.status,
                "created_at": avatar.created_at,
                "updated_at": avatar.updated_at,
                "confirmed_at": avatar.confirmed_at,
                "deleted_at": avatar.deleted_at,
            }
            for avatar in avatars
        ],
    )
