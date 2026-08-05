from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.hashids import hash_ip_optional
from app.core.rate_limits import AuthEmailRateLimitConfig, InMemoryAuthEmailRateLimiter
from app.db.models.auth import WebRegistrationVerificationCode
from app.db.models.core import (
    AppUser,
    EventRegistration,
    LegalAcceptance,
    LegalDocument,
    Profile,
    WebRegistrationIdentityConflict,
    WebRegistrationIntent,
)
from app.schemas.registrations import RegisterEventRequest
from app.schemas.web_registration import (
    WebLegalAcceptance,
    WebRegistrationConfirmResult,
    WebRegistrationIntentCreated,
    WebRegistrationIntentRequest,
    WebRegistrationIntentStatus,
    WebRegistrationResendResult,
    WebRegistrationResult,
)
from app.services import auth as auth_service
from app.services import events as events_service
from app.services import registrations as registrations_service
from app.services.auth_tokens import hash_token
from app.services.web_registration_email_service import (
    WebRegistrationEmailDeliveryError,
    send_web_registration_result,
    send_web_registration_verification_code,
)

logger = logging.getLogger(__name__)

EMAIL_REQUIRED = "email_verification_required"
CONFIRMED = "confirmed"
FAILED = "failed"
VERIFICATION_CODE_GENERATION_MAX_ATTEMPTS = 10
IDENTITY_UNAVAILABLE_DETAIL = {
    "code": "identity_confirmation_unavailable",
    "message": "Не удалось автоматически подтвердить данные. Используйте восстановление доступа или обратитесь в поддержку.",
}
INVALID_CODE_DETAIL = {
    "code": "invalid_verification_code",
    "message": "Код недействителен или истёк",
}
FLOW_UNAVAILABLE_DETAIL = {
    "code": "registration_intent_not_available",
    "message": "Registration intent is not available",
}
_rate_limiter: InMemoryAuthEmailRateLimiter | None = None


def _now() -> datetime:
    return datetime.now(UTC)


def _error(code: int, error_code: str, message: str) -> HTTPException:
    return HTTPException(status_code=code, detail={"code": error_code, "message": message})


def _identity_unavailable() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=IDENTITY_UNAVAILABLE_DETAIL,
    )


def _invalid_code() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=INVALID_CODE_DETAIL,
    )


def _flow_unavailable() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=FLOW_UNAVAILABLE_DETAIL,
    )


def _email_unavailable() -> HTTPException:
    return _error(
        status.HTTP_503_SERVICE_UNAVAILABLE,
        "email_delivery_unavailable",
        "Email delivery is temporarily unavailable",
    )


def _limiter() -> InMemoryAuthEmailRateLimiter:
    global _rate_limiter
    settings = get_settings()
    if _rate_limiter is None:
        _rate_limiter = InMemoryAuthEmailRateLimiter(
            AuthEmailRateLimitConfig(
                window_seconds=settings.api_web_registration_rate_limit_window_seconds,
                max_attempts=settings.api_web_registration_rate_limit_max_attempts,
            ),
        )
    return _rate_limiter


def _hash_dimension(purpose: str, value: str) -> str:
    return hash_token(f"web-registration:{purpose}:{value}")


def _consume_rate_limit(purpose: str, values: list[tuple[str, str | None]]) -> None:
    for dimension, value in values:
        if not value:
            continue
        decision = _limiter().consume(_hash_dimension(f"{purpose}:{dimension}", value))
        if not decision.allowed:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={"code": "rate_limited", "message": "Too many requests"},
                headers={"Retry-After": str(decision.retry_after_seconds)},
            )


def _ip_signal(ip: str | None) -> str | None:
    return hash_ip_optional(ip)


def _apply_submit_rate_limit(payload: WebRegistrationIntentRequest, ip: str | None) -> None:
    _consume_rate_limit(
        "submit",
        [
            ("email", payload.email),
            ("phone", payload.phone),
            ("ip", _ip_signal(ip)),
        ],
    )


def _apply_intent_rate_limit(
    purpose: str,
    intent: WebRegistrationIntent,
    ip: str | None,
) -> None:
    _consume_rate_limit(
        purpose,
        [
            ("flow", intent.flow_token_hash),
            ("email", intent.email_normalized),
            ("phone", intent.phone_normalized),
            ("ip", _ip_signal(ip)),
        ],
    )


def _idempotency_hash(key: str) -> str:
    return _hash_dimension("idempotency", key)


def _flow_id(idempotency_hash: str) -> str:
    secret = get_settings().api_token_hash_secret.encode("utf-8")
    digest = hmac.new(
        secret,
        f"web-flow:{idempotency_hash}".encode(),
        hashlib.sha256,
    ).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def _flow_hash(flow_id: str) -> str | None:
    if len(flow_id) < 32 or len(flow_id) > 128:
        return None
    try:
        return hash_token(flow_id)
    except ValueError:
        return None


def _fingerprint(payload: WebRegistrationIntentRequest) -> str:
    value = payload.model_dump(mode="json", exclude={"idempotency_key"})
    canonical = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _new_verification_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def _verification_code_hash(intent_id: UUID, code: str) -> str:
    return hash_token(f"web-registration-code:{intent_id}:{code}")


def _verify_verification_code(
    intent_id: UUID,
    code: str,
    code_hash: str,
) -> bool:
    try:
        submitted_hash = _verification_code_hash(intent_id, code)
    except ValueError:
        return False
    return hmac.compare_digest(submitted_hash, code_hash)


async def _new_unique_verification_code(
    session: AsyncSession,
    intent_id: UUID,
) -> tuple[str, str]:
    for _ in range(VERIFICATION_CODE_GENERATION_MAX_ATTEMPTS):
        code = _new_verification_code()
        code_hash = _verification_code_hash(intent_id, code)
        existing_id = await session.scalar(
            select(WebRegistrationVerificationCode.id)
            .where(
                WebRegistrationVerificationCode.registration_intent_id == intent_id,
                WebRegistrationVerificationCode.code_hash == code_hash,
            )
            .limit(1),
        )
        if existing_id is None:
            return code, code_hash
    raise _error(
        status.HTTP_500_INTERNAL_SERVER_ERROR,
        "verification_code_generation_unavailable",
        "Unable to generate verification code",
    )


def _code_expiry(now: datetime) -> datetime:
    return now + timedelta(
        minutes=get_settings().api_web_registration_code_ttl_minutes,
    )


async def _validate_references(
    session: AsyncSession,
    payload: WebRegistrationIntentRequest,
) -> int:
    if payload.answers:
        raise _error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "validation_error",
            "Questionnaire answers are not available",
        )

    preflight = await registrations_service.preflight_registration(
        session,
        payload.event_id,
        RegisterEventRequest(
            occurrence_id=payload.occurrence_id,
            seats_count=payload.seats_count,
            option_selections=[item.model_dump() for item in payload.option_selections],
        ),
        free_only=True,
    )
    await _validated_legal_documents(
        session,
        [item.model_dump(mode="json") for item in payload.legal_acceptances],
        lock=False,
    )
    return preflight.seats_count


async def _validated_legal_documents(
    session: AsyncSession,
    acceptance_payload: list[dict],
    *,
    lock: bool,
) -> list[LegalDocument]:
    acceptances = [WebLegalAcceptance.model_validate(item) for item in acceptance_payload]
    document_ids = [item.document_id for item in acceptances]
    if len(document_ids) != len(set(document_ids)):
        raise _error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "validation_error",
            "Duplicate legal acceptance",
        )
    query = select(LegalDocument).where(LegalDocument.id.in_(document_ids))
    if lock:
        query = query.with_for_update()
    documents = list(await session.scalars(query))
    by_id = {item.id: item for item in documents}
    now = _now()
    document_types: list[str] = []
    ordered: list[LegalDocument] = []
    for acceptance in acceptances:
        document = by_id.get(acceptance.document_id)
        if document is None or document.content_hash != acceptance.content_hash:
            raise _error(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "validation_error",
                "Legal document is not available",
            )
        if document.effective_at > now or (
            document.retired_at is not None and document.retired_at <= now
        ):
            raise _error(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "validation_error",
                "Legal document is not available",
            )
        if document.document_type not in (
            "event_registration_consent",
            "privacy_policy",
        ):
            raise _error(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "validation_error",
                "Legal document is not available",
            )
        document_types.append(document.document_type)
        ordered.append(document)
    if len(document_types) != len(set(document_types)):
        raise _error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "validation_error",
            "Duplicate legal document type",
        )
    if document_types.count("event_registration_consent") != 1:
        raise _error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "validation_error",
            "Event registration consent is required",
        )
    return ordered


async def _identity_state(
    session: AsyncSession,
    payload: WebRegistrationIntentRequest,
):
    email_user = await session.scalar(
        select(AppUser).where(func.lower(AppUser.email) == payload.email),
    )
    phone_user = await session.scalar(select(AppUser).where(AppUser.phone == payload.phone))
    deletion = any(
        user
        and (
            user.deletion_requested_at is not None
            or user.erased_at is not None
            or user.status == "deletion_pending"
        )
        for user in (email_user, phone_user)
    )
    if deletion:
        return "deletion_pending", None, None
    if email_user and phone_user and email_user.id != phone_user.id:
        return FAILED, None, (email_user.id, phone_user.id)
    if phone_user and not email_user:
        return FAILED, None, None
    matched = (
        email_user
        if email_user and (phone_user is None or phone_user.id == email_user.id)
        else None
    )
    return EMAIL_REQUIRED, matched.id if matched else None, None


async def _active_code(
    session: AsyncSession,
    intent_id: UUID,
    *,
    now: datetime,
    lock: bool,
) -> WebRegistrationVerificationCode | None:
    query = (
        select(WebRegistrationVerificationCode)
        .where(
            WebRegistrationVerificationCode.registration_intent_id == intent_id,
            WebRegistrationVerificationCode.consumed_at.is_(None),
            WebRegistrationVerificationCode.expires_at > now,
        )
        .order_by(
            WebRegistrationVerificationCode.created_at.desc(),
            WebRegistrationVerificationCode.id.desc(),
        )
        .limit(1)
    )
    if lock:
        query = query.with_for_update()
    return await session.scalar(query)


async def _issue_initial_code(
    session: AsyncSession,
    intent_id: UUID,
    ip: str | None,
) -> None:
    now = _now()
    intent = await session.scalar(
        select(WebRegistrationIntent)
        .where(WebRegistrationIntent.id == intent_id)
        .with_for_update(),
    )
    if (
        intent is None
        or intent.status != EMAIL_REQUIRED
        or intent.expires_at <= now
    ):
        await session.rollback()
        raise _flow_unavailable()
    if await _active_code(session, intent.id, now=now, lock=True) is not None:
        await session.commit()
        return

    _apply_intent_rate_limit("issue", intent, ip)
    code, code_hash = await _new_unique_verification_code(session, intent.id)
    code_row = WebRegistrationVerificationCode(
        registration_intent_id=intent.id,
        code_hash=code_hash,
        expires_at=_code_expiry(now),
        attempt_count=0,
        created_at=now,
    )
    session.add(code_row)
    await session.flush()
    try:
        send_web_registration_verification_code(
            to_address=intent.email_normalized,
            code=code,
            expiration_minutes=get_settings().api_web_registration_code_ttl_minutes,
        )
    except WebRegistrationEmailDeliveryError:
        await session.rollback()
        raise _email_unavailable() from None
    await session.commit()


async def create_intent(
    session: AsyncSession,
    payload: WebRegistrationIntentRequest,
    ip: str | None,
) -> WebRegistrationIntentCreated:
    key_hash = _idempotency_hash(payload.idempotency_key)
    fingerprint = _fingerprint(payload)
    flow_id = _flow_id(key_hash)
    existing = await session.scalar(
        select(WebRegistrationIntent).where(
            WebRegistrationIntent.idempotency_key_hash == key_hash,
        ),
    )
    if existing is not None:
        if existing.request_fingerprint_hash != fingerprint:
            raise _error(
                status.HTTP_409_CONFLICT,
                "idempotency_conflict",
                "Idempotency key cannot be reused",
            )
        if existing.status == CONFIRMED:
            response = WebRegistrationIntentCreated(
                flow_id=flow_id,
                next_step="completed",
                expires_at=existing.expires_at,
            )
            await session.rollback()
            return response
        await events_service.require_web_registration_event(
            session,
            payload.event_id,
            for_update=True,
        )
        if existing.expires_at <= _now():
            raise _flow_unavailable()
        if existing.status == FAILED:
            raise _identity_unavailable()
        if existing.status != EMAIL_REQUIRED:
            raise _flow_unavailable()
        intent_id = existing.id
        intent_expires_at = existing.expires_at
        await session.rollback()
    else:
        await events_service.require_web_registration_event(
            session,
            payload.event_id,
            for_update=True,
        )
        _apply_submit_rate_limit(payload, ip)
        seats_count = await _validate_references(session, payload)
        intent_status, matched_user_id, conflict_users = await _identity_state(
            session,
            payload,
        )
        if intent_status == "deletion_pending":
            await session.rollback()
            raise _identity_unavailable()
        now = _now()
        intent = WebRegistrationIntent(
            flow_token_hash=hash_token(flow_id),
            event_id=payload.event_id,
            occurrence_id=payload.occurrence_id,
            matched_user_id=matched_user_id,
            first_name=payload.first_name,
            last_name=payload.last_name,
            email_normalized=payload.email,
            phone_normalized=payload.phone,
            seats_count=seats_count,
            option_payload=[
                item.model_dump(mode="json") for item in payload.option_selections
            ],
            answer_payload=None,
            legal_acceptance_payload=[
                item.model_dump(mode="json") for item in payload.legal_acceptances
            ],
            account_choice=payload.account_choice,
            status=intent_status,
            idempotency_key_hash=key_hash,
            request_fingerprint_hash=fingerprint,
            created_at=now,
            expires_at=now
            + timedelta(hours=get_settings().api_web_registration_intent_ttl_hours),
        )
        session.add(intent)
        try:
            await session.flush()
            if conflict_users:
                session.add(
                    WebRegistrationIdentityConflict(
                        registration_intent_id=intent.id,
                        category="email_phone_different_users",
                        email_user_id=conflict_users[0],
                        phone_user_id=conflict_users[1],
                        status="open",
                    ),
                )
            await session.commit()
        except IntegrityError:
            await session.rollback()
            existing = await session.scalar(
                select(WebRegistrationIntent).where(
                    WebRegistrationIntent.idempotency_key_hash == key_hash,
                ),
            )
            if existing is None:
                raise
            if existing.request_fingerprint_hash != fingerprint:
                raise _error(
                    status.HTTP_409_CONFLICT,
                    "idempotency_conflict",
                    "Idempotency key cannot be reused",
                )
            if existing.expires_at <= _now():
                raise _flow_unavailable()
            resolved_status = existing.status
            intent_id = existing.id
            intent_expires_at = existing.expires_at
            await session.rollback()
        else:
            resolved_status = intent.status
            intent_id = intent.id
            intent_expires_at = intent.expires_at
        if resolved_status == FAILED:
            raise _identity_unavailable()
        if resolved_status == CONFIRMED:
            return WebRegistrationIntentCreated(
                flow_id=flow_id,
                next_step="completed",
                expires_at=intent_expires_at,
            )

    await _issue_initial_code(session, intent_id, ip)
    return WebRegistrationIntentCreated(
        flow_id=flow_id,
        expires_at=intent_expires_at,
    )


async def resend_code(
    session: AsyncSession,
    flow_id: str,
    ip: str | None,
) -> WebRegistrationResendResult:
    token_hash = _flow_hash(flow_id)
    if token_hash is None:
        raise _flow_unavailable()
    now = _now()
    intent = await session.scalar(
        select(WebRegistrationIntent)
        .where(WebRegistrationIntent.flow_token_hash == token_hash)
        .with_for_update(),
    )
    if (
        intent is None
        or intent.status != EMAIL_REQUIRED
        or intent.expires_at <= now
    ):
        await session.rollback()
        raise _flow_unavailable()

    _apply_intent_rate_limit("resend", intent, ip)
    latest = await session.scalar(
        select(WebRegistrationVerificationCode)
        .where(WebRegistrationVerificationCode.registration_intent_id == intent.id)
        .order_by(
            WebRegistrationVerificationCode.created_at.desc(),
            WebRegistrationVerificationCode.id.desc(),
        )
        .limit(1)
        .with_for_update(),
    )
    cooldown = get_settings().api_web_registration_resend_cooldown_seconds
    if latest is not None:
        retry_after = int((latest.created_at + timedelta(seconds=cooldown) - now).total_seconds())
        if retry_after > 0:
            await session.rollback()
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={"code": "resend_cooldown", "message": "Try again later"},
                headers={"Retry-After": str(retry_after)},
            )

    code, code_hash = await _new_unique_verification_code(session, intent.id)
    code_row = WebRegistrationVerificationCode(
        registration_intent_id=intent.id,
        code_hash=code_hash,
        expires_at=_code_expiry(now),
        attempt_count=0,
        created_at=now,
    )
    session.add(code_row)
    await session.flush()
    try:
        send_web_registration_verification_code(
            to_address=intent.email_normalized,
            code=code,
            expiration_minutes=get_settings().api_web_registration_code_ttl_minutes,
        )
    except WebRegistrationEmailDeliveryError:
        await session.rollback()
        raise _email_unavailable() from None

    await session.execute(
        update(WebRegistrationVerificationCode)
        .where(
            WebRegistrationVerificationCode.registration_intent_id == intent.id,
            WebRegistrationVerificationCode.id != code_row.id,
            WebRegistrationVerificationCode.consumed_at.is_(None),
        )
        .values(consumed_at=now)
        .execution_options(synchronize_session=False),
    )
    await session.commit()
    return WebRegistrationResendResult(expires_at=code_row.expires_at)


async def _record_invalid_attempt(
    session: AsyncSession,
    intent_id: UUID,
    now: datetime,
) -> None:
    code_row = await _active_code(session, intent_id, now=now, lock=True)
    if code_row is not None:
        code_row.attempt_count += 1
        if code_row.attempt_count >= get_settings().api_web_registration_code_max_attempts:
            code_row.consumed_at = now
    await session.commit()


def _is_deletion_blocked(user: AppUser | None) -> bool:
    return bool(
        user
        and (
            user.deletion_requested_at is not None
            or user.erased_at is not None
            or user.status == "deletion_pending"
        )
    )


async def _resolve_identity(
    session: AsyncSession,
    intent: WebRegistrationIntent,
    now: datetime,
) -> tuple[AppUser | None, tuple[AppUser, AppUser] | None, bool]:
    email_user = await session.scalar(
        select(AppUser)
        .where(func.lower(AppUser.email) == intent.email_normalized)
        .with_for_update(),
    )
    phone_user = await session.scalar(
        select(AppUser)
        .where(AppUser.phone == intent.phone_normalized)
        .with_for_update(),
    )
    if _is_deletion_blocked(email_user) or _is_deletion_blocked(phone_user):
        return None, None, True
    if any(user and user.status != "active" for user in (email_user, phone_user)):
        return None, None, False
    if email_user and phone_user and email_user.id != phone_user.id:
        return None, (email_user, phone_user), False
    if phone_user and email_user is None:
        return None, None, False

    if email_user is None:
        user = AppUser(
            email=intent.email_normalized,
            phone=intent.phone_normalized,
            password_hash=None,
            account_origin="web_guest",
            claim_state="unclaimed",
            claimed_at=None,
            status="active",
            email_verified_at=now,
            phone_verified_at=None,
        )
        session.add(user)
        await session.flush()
        session.add(_minimal_profile(user.id, intent))
        return user, None, False

    user = email_user
    if user.email_verified_at is None:
        user.email_verified_at = now
    user.updated_at = now
    if user.claim_state == "unclaimed" and phone_user is None:
        user.phone = intent.phone_normalized

    profile = await session.scalar(
        select(Profile).where(Profile.user_id == user.id).with_for_update(),
    )
    if profile is None:
        session.add(_minimal_profile(user.id, intent))
    elif user.claim_state == "unclaimed":
        _update_unclaimed_profile(profile, intent, now)
    return user, None, False


def _minimal_profile(
    user_id: UUID,
    intent: WebRegistrationIntent,
) -> Profile:
    full_name = f"{intent.first_name} {intent.last_name}"
    return Profile(
        user_id=user_id,
        first_name=intent.first_name,
        last_name=intent.last_name,
        full_name=full_name,
        display_name=full_name,
        email=intent.email_normalized,
        phone=intent.phone_normalized,
    )


def _update_unclaimed_profile(
    profile: Profile,
    intent: WebRegistrationIntent,
    now: datetime,
) -> None:
    full_name = f"{intent.first_name} {intent.last_name}"
    profile.first_name = intent.first_name
    profile.last_name = intent.last_name
    profile.full_name = full_name
    profile.display_name = full_name
    profile.email = intent.email_normalized
    profile.phone = intent.phone_normalized
    profile.updated_at = now


async def _mark_identity_failure(
    session: AsyncSession,
    intent: WebRegistrationIntent,
    conflict_users: tuple[AppUser, AppUser] | None,
    now: datetime,
) -> None:
    intent.status = FAILED
    if conflict_users is not None:
        existing = await session.scalar(
            select(WebRegistrationIdentityConflict).where(
                WebRegistrationIdentityConflict.registration_intent_id == intent.id,
            ),
        )
        if existing is None:
            session.add(
                WebRegistrationIdentityConflict(
                    registration_intent_id=intent.id,
                    category="email_phone_different_users",
                    email_user_id=conflict_users[0].id,
                    phone_user_id=conflict_users[1].id,
                    status="open",
                ),
            )
    await session.execute(
        update(WebRegistrationVerificationCode)
        .where(
            WebRegistrationVerificationCode.registration_intent_id == intent.id,
            WebRegistrationVerificationCode.consumed_at.is_(None),
        )
        .values(consumed_at=now)
        .execution_options(synchronize_session=False),
    )
    await session.commit()


async def _create_legal_acceptances(
    session: AsyncSession,
    *,
    intent: WebRegistrationIntent,
    user: AppUser,
    registration: EventRegistration,
    now: datetime,
) -> None:
    documents = await _validated_legal_documents(
        session,
        intent.legal_acceptance_payload,
        lock=True,
    )
    document_ids = [document.id for document in documents]
    existing_ids = set(
        await session.scalars(
            select(LegalAcceptance.legal_document_id).where(
                LegalAcceptance.registration_id == registration.id,
                LegalAcceptance.legal_document_id.in_(document_ids),
            ),
        ),
    )
    for document in documents:
        if document.id in existing_ids:
            continue
        session.add(
            LegalAcceptance(
                user_id=user.id,
                registration_id=registration.id,
                legal_document_id=document.id,
                accepted_at=now,
                acceptance_method="checkbox_plus_email_verification",
                source_channel="public_web",
                evidence_version="web-registration-email-code-v1",
            ),
        )


def _registration_payload(intent: WebRegistrationIntent) -> RegisterEventRequest:
    return RegisterEventRequest(
        occurrence_id=intent.occurrence_id,
        seats_count=intent.seats_count,
        option_selections=intent.option_payload,
    )


def _registration_result(registration: EventRegistration) -> WebRegistrationResult:
    return WebRegistrationResult.model_validate(registration)


def _replay_account_next_step(intent: WebRegistrationIntent, user: AppUser) -> str:
    if user.password_hash is not None:
        return "sign_in"
    if intent.account_choice == "without_password":
        return "none"
    return "request_set_password"


async def _find_final_registration(
    session: AsyncSession,
    intent: WebRegistrationIntent,
    user_id: UUID,
) -> EventRegistration | None:
    occurrence_condition = (
        EventRegistration.occurrence_id.is_(None)
        if intent.occurrence_id is None
        else EventRegistration.occurrence_id == intent.occurrence_id
    )
    return await session.scalar(
        select(EventRegistration)
        .where(
            EventRegistration.event_id == intent.event_id,
            EventRegistration.user_id == user_id,
            occurrence_condition,
            EventRegistration.status.in_(
                registrations_service.DUPLICATE_BLOCKING_REGISTRATION_STATUSES,
            ),
        )
        .order_by(
            EventRegistration.registered_at.desc(),
            EventRegistration.id.desc(),
        )
        .limit(1),
    )


async def _confirmed_replay(
    session: AsyncSession,
    intent: WebRegistrationIntent,
) -> WebRegistrationConfirmResult:
    if intent.matched_user_id is None:
        await session.rollback()
        raise _flow_unavailable()
    user = await session.get(AppUser, intent.matched_user_id)
    registration = await _find_final_registration(session, intent, intent.matched_user_id)
    if user is None or registration is None:
        await session.rollback()
        raise _flow_unavailable()
    result = WebRegistrationConfirmResult(
        registration=_registration_result(registration),
        account_next_step=_replay_account_next_step(intent, user),
    )
    await session.rollback()
    return result


async def _confirm_once(
    session: AsyncSession,
    flow_id: str,
    code: str,
    ip: str | None,
) -> tuple[WebRegistrationConfirmResult, str | None, str | None]:
    token_hash = _flow_hash(flow_id)
    if token_hash is None:
        raise _invalid_code()
    now = _now()
    intent = await session.scalar(
        select(WebRegistrationIntent)
        .where(WebRegistrationIntent.flow_token_hash == token_hash)
        .with_for_update(),
    )
    if intent is None:
        await session.rollback()
        raise _invalid_code()
    if intent.status == CONFIRMED:
        return await _confirmed_replay(session, intent), None, None
    if intent.status != EMAIL_REQUIRED or intent.expires_at <= now:
        await session.rollback()
        raise _invalid_code()

    try:
        await events_service.require_web_registration_event(
            session,
            intent.event_id,
            for_update=True,
        )
    except events_service.WebRegistrationUnavailableError:
        await session.rollback()
        raise

    _apply_intent_rate_limit("confirm", intent, ip)
    submitted_hash = _verification_code_hash(intent.id, code)
    code_row = await session.scalar(
        select(WebRegistrationVerificationCode)
        .where(
            WebRegistrationVerificationCode.registration_intent_id == intent.id,
            WebRegistrationVerificationCode.code_hash == submitted_hash,
        )
        .with_for_update(),
    )
    if (
        code_row is None
        or code_row.consumed_at is not None
        or code_row.expires_at <= now
        or not _verify_verification_code(intent.id, code, code_row.code_hash)
    ):
        await _record_invalid_attempt(session, intent.id, now)
        raise _invalid_code()

    user, conflict_users, deletion_blocked = await _resolve_identity(
        session,
        intent,
        now,
    )
    if deletion_blocked:
        await session.delete(intent)
        await session.commit()
        raise _identity_unavailable()
    if user is None:
        await _mark_identity_failure(session, intent, conflict_users, now)
        raise _identity_unavailable()

    registration = await registrations_service.register_user_for_event(
        session,
        user=user,
        event_id=intent.event_id,
        payload=_registration_payload(intent),
        source_channel="public_web",
        member_community_ids=(),
    )
    await _create_legal_acceptances(
        session,
        intent=intent,
        user=user,
        registration=registration,
        now=now,
    )

    set_password_code: str | None = None
    set_password_expires_at: datetime | None = None
    if user.password_hash is not None:
        account_next_step = "sign_in"
    elif intent.account_choice == "without_password":
        account_next_step = "none"
    else:
        account_next_step = "set_password"
        set_password_code, set_password_expires_at = (
            await auth_service.issue_set_password_handoff(session, user=user)
        )

    intent.status = CONFIRMED
    intent.confirmed_at = now
    intent.matched_user_id = user.id
    await session.execute(
        update(WebRegistrationVerificationCode)
        .where(
            WebRegistrationVerificationCode.registration_intent_id == intent.id,
            WebRegistrationVerificationCode.consumed_at.is_(None),
        )
        .values(consumed_at=now)
        .execution_options(synchronize_session=False),
    )
    await session.flush()
    result = WebRegistrationConfirmResult(
        registration=_registration_result(registration),
        account_next_step=account_next_step,
        set_password_code=set_password_code,
        set_password_expires_at=set_password_expires_at,
    )
    recipient = (
        intent.email_normalized
        if registration.status in {"confirmed", "pending"}
        else None
    )
    registration_status = registration.status if recipient is not None else None
    await session.commit()
    return result, recipient, registration_status


async def confirm_email(
    session: AsyncSession,
    flow_id: str,
    code: str,
    ip: str | None,
) -> WebRegistrationConfirmResult:
    for attempt in range(2):
        try:
            result, recipient, registration_status = await _confirm_once(
                session,
                flow_id,
                code,
                ip,
            )
            break
        except IntegrityError:
            await session.rollback()
            if attempt == 1:
                raise
    else:  # pragma: no cover - the loop always returns or raises.
        raise RuntimeError("unreachable confirmation state")

    if recipient is not None and registration_status is not None:
        try:
            send_web_registration_result(
                to_address=recipient,
                registration_status=registration_status,
            )
        except WebRegistrationEmailDeliveryError:
            logger.warning("Web registration result email delivery failed")
    return result


async def get_intent_status(
    session: AsyncSession,
    flow_id: str,
) -> WebRegistrationIntentStatus:
    token_hash = _flow_hash(flow_id)
    if token_hash is None:
        return WebRegistrationIntentStatus(state="not_available")
    intent = await session.scalar(
        select(WebRegistrationIntent).where(
            WebRegistrationIntent.flow_token_hash == token_hash,
        ),
    )
    if intent is None or intent.expires_at <= _now():
        return WebRegistrationIntentStatus(state="not_available")
    if intent.status == EMAIL_REQUIRED:
        return WebRegistrationIntentStatus(
            state=EMAIL_REQUIRED,
            expires_at=intent.expires_at,
        )
    if intent.status != CONFIRMED or intent.matched_user_id is None:
        return WebRegistrationIntentStatus(state="not_available")

    user = await session.get(AppUser, intent.matched_user_id)
    registration = await _find_final_registration(
        session,
        intent,
        intent.matched_user_id,
    )
    if user is None or registration is None:
        return WebRegistrationIntentStatus(state="not_available")
    return WebRegistrationIntentStatus(
        state=CONFIRMED,
        registration=_registration_result(registration),
        account_next_step=_replay_account_next_step(intent, user),
    )
