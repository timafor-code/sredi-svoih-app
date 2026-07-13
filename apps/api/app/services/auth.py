from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
import logging
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.hashids import hash_ip_optional, hash_user_agent_optional
from app.core.passwords import hash_password, verify_password
from app.core.rate_limits import InMemoryAuthEmailRateLimiter
from app.core.tokens import create_access_token, create_refresh_token
from app.db.models.auth import (
    AuthEmailVerificationCode,
    AuthSession,
    AuthSetPasswordCode,
    PasswordResetCode,
)
from app.db.models.core import AppUser, Community, CommunityMembership, Invite, Profile
from app.schemas.auth import (
    AppUserSummary,
    AcceptInviteResponse,
    AuthCodeConfirmResponse,
    AuthCodeRequestResponse,
    AuthTokenResponse,
    CommunitySummary,
    CommunityMembershipSummary,
    LogoutResponse,
    MeResponse,
    ProfileSummary,
    RegisterResponse,
    RegisterWithInviteProfileInput,
    RegisterWithInviteResponse,
    normalize_device_name,
    normalize_email,
)
from app.services import authorization as authorization_service
from app.services.auth_email_service import (
    AuthEmailDeliveryError,
    send_email_verification_email,
    send_password_reset_email,
    send_set_password_email,
)
from app.services.auth_tokens import hash_token, verify_token_hash

logger = logging.getLogger(__name__)

_AUTH_CODE_BYTES = 32
_PASSWORD_RESET_PURPOSE = "password_reset"
_EMAIL_VERIFICATION_PURPOSE = "email_verification"
_SET_PASSWORD_PURPOSE = "set_password"
_INVITE_ACTIVE_STATUS = "active"
_INVITE_USED_STATUS = "used"
_MEMBERSHIP_PENDING_STATUS = "pending"
_MEMBERSHIP_SUSPENDED_STATUS = "suspended"
_MEMBERSHIP_LEFT_STATUS = "left"
_auth_email_rate_limiter = InMemoryAuthEmailRateLimiter()

AuthCodeModel = (
    type[AuthEmailVerificationCode]
    | type[AuthSetPasswordCode]
    | type[PasswordResetCode]
)


class AuthConflictError(HTTPException):
    def __init__(self, detail: str = "Conflict") -> None:
        super().__init__(status_code=status.HTTP_409_CONFLICT, detail=detail)


def _authentication_error(detail: str = "Invalid credentials") -> HTTPException:
    return authorization_service.AuthenticationRequiredError(detail)


def _now() -> datetime:
    return datetime.now(UTC)


@asynccontextmanager
async def _transaction_scope(session: AsyncSession) -> AsyncIterator[None]:
    if session.in_transaction():
        try:
            yield
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        return

    async with session.begin():
        yield


def _access_token_ttl() -> timedelta:
    return timedelta(minutes=get_settings().api_access_token_ttl_minutes)


def _refresh_token_ttl() -> timedelta:
    return timedelta(days=get_settings().api_refresh_token_ttl_days)


def _auth_code_ttl() -> timedelta:
    return timedelta(minutes=get_settings().api_auth_code_ttl_minutes)


def _auth_code_expiration_minutes() -> int:
    return get_settings().api_auth_code_ttl_minutes


def _issue_access_token(user_id: UUID) -> tuple[str, datetime]:
    ttl = _access_token_ttl()
    expires_at = _now() + ttl
    return create_access_token(user_id, expires_delta=ttl), expires_at


def _user_summary(user: AppUser) -> AppUserSummary:
    return AppUserSummary(
        id=user.id,
        email=user.email,
        phone=user.phone,
        status=user.status,
        email_verified_at=user.email_verified_at,
        phone_verified_at=user.phone_verified_at,
        last_login_at=user.last_login_at,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


def _profile_summary(profile: Profile | None) -> ProfileSummary | None:
    if profile is None:
        return None

    return ProfileSummary(
        id=profile.id,
        user_id=profile.user_id,
        community_id=profile.community_id,
        display_name=profile.display_name,
        first_name=profile.first_name,
        last_name=profile.last_name,
        full_name=profile.full_name,
        avatar_url=profile.avatar_url,
        avatar_id=profile.avatar_id,
        city=profile.city,
        onboarding_completed=profile.onboarding_completed,
        created_at=profile.created_at,
        updated_at=profile.updated_at,
    )


def _membership_summary(
    membership: CommunityMembership,
) -> CommunityMembershipSummary:
    return CommunityMembershipSummary(
        id=membership.id,
        community_id=membership.community_id,
        role=membership.role,
        status=membership.status,
        joined_at=membership.joined_at,
        created_at=membership.created_at,
    )


def _community_summary(community: Community) -> CommunitySummary:
    return CommunitySummary(
        id=community.id,
        name=community.name,
        city=community.city,
        slug=community.slug,
    )


def _token_response(user: AppUser, refresh_token: str) -> AuthTokenResponse:
    access_token, expires_at = _issue_access_token(user.id)
    return AuthTokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_at=expires_at,
        user=_user_summary(user),
    )


def _refresh_token_hash_or_auth_error(refresh_token: str) -> str:
    try:
        return hash_token(refresh_token)
    except ValueError as exc:
        raise _authentication_error("Invalid refresh token") from exc


def _new_auth_code() -> str:
    return secrets.token_urlsafe(_AUTH_CODE_BYTES)


def _auth_email_rate_limit_key(purpose: str, normalized_email: str) -> str:
    return hash_token(f"auth-email:{purpose}:{normalized_email}")


def _consume_auth_email_rate_limit(purpose: str, normalized_email: str) -> None:
    decision = _auth_email_rate_limiter.consume(
        _auth_email_rate_limit_key(purpose, normalized_email),
    )
    if not decision.allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many auth email requests",
            headers={"Retry-After": str(decision.retry_after_seconds)},
        )


def _invalid_or_expired_code_error(purpose_label: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"Invalid or expired {purpose_label} code",
    )


def _email_request_response() -> AuthCodeRequestResponse:
    return AuthCodeRequestResponse()


def _confirm_response() -> AuthCodeConfirmResponse:
    return AuthCodeConfirmResponse()


async def _find_user_by_normalized_email(
    session: AsyncSession,
    email: str,
) -> AppUser | None:
    return await session.scalar(
        select(AppUser).where(
            AppUser.email.is_not(None),
            func.lower(AppUser.email) == email,
        ),
    )


async def _invalidate_user_auth_codes(
    session: AsyncSession,
    model: AuthCodeModel,
    *,
    user_id: UUID,
    now: datetime,
) -> None:
    await session.execute(
        update(model)
        .where(
            model.user_id == user_id,
            model.consumed_at.is_(None),
        )
        .values(
            consumed_at=now,
            updated_at=now,
        )
        .execution_options(synchronize_session=False),
    )


async def _create_auth_code_for_user(
    session: AsyncSession,
    model: AuthCodeModel,
    *,
    user: AppUser,
) -> str:
    now = _now()
    code = _new_auth_code()
    await _invalidate_user_auth_codes(session, model, user_id=user.id, now=now)
    session.add(
        model(
            user_id=user.id,
            code_hash=hash_token(code),
            expires_at=now + _auth_code_ttl(),
        ),
    )
    await session.commit()
    return code


async def _usable_auth_code(
    session: AsyncSession,
    model: AuthCodeModel,
    *,
    code: str,
) -> AuthEmailVerificationCode | AuthSetPasswordCode | PasswordResetCode:
    now = _now()
    purpose_label = _purpose_label_for_model(model)
    try:
        code_hash = hash_token(code)
    except ValueError as exc:
        raise _invalid_or_expired_code_error(purpose_label) from exc

    code_row = await session.scalar(
        select(model)
        .where(
            model.code_hash == code_hash,
            model.consumed_at.is_(None),
            model.expires_at > now,
        )
        .with_for_update(),
    )
    if code_row is None or not verify_token_hash(code, code_row.code_hash):
        raise _invalid_or_expired_code_error(purpose_label)

    return code_row


def _purpose_label_for_model(model: AuthCodeModel) -> str:
    if model is PasswordResetCode:
        return "password reset"
    if model is AuthEmailVerificationCode:
        return "email verification"
    return "set-password"


def _log_auth_email_delivery_failure(purpose: str) -> None:
    logger.warning("Auth email delivery failed for %s flow", purpose)


def _send_password_reset_code(to_address: str, code: str) -> None:
    try:
        send_password_reset_email(
            to_address=to_address,
            code=code,
            expiration_minutes=_auth_code_expiration_minutes(),
        )
    except AuthEmailDeliveryError:
        _log_auth_email_delivery_failure(_PASSWORD_RESET_PURPOSE)


def _send_email_verification_code(to_address: str, code: str) -> None:
    try:
        send_email_verification_email(
            to_address=to_address,
            code=code,
            expiration_minutes=_auth_code_expiration_minutes(),
        )
    except AuthEmailDeliveryError:
        _log_auth_email_delivery_failure(_EMAIL_VERIFICATION_PURPOSE)


def _send_set_password_code(to_address: str, code: str) -> None:
    try:
        send_set_password_email(
            to_address=to_address,
            code=code,
            expiration_minutes=_auth_code_expiration_minutes(),
        )
    except AuthEmailDeliveryError:
        _log_auth_email_delivery_failure(_SET_PASSWORD_PURPOSE)


def _new_refresh_session(
    user_id: UUID,
    refresh_token: str,
    *,
    now: datetime,
    device_name: str | None,
    ip_address: str | None,
    user_agent: str | None,
) -> AuthSession:
    return AuthSession(
        user_id=user_id,
        refresh_token_hash=hash_token(refresh_token),
        device_name=normalize_device_name(device_name),
        ip_hash=hash_ip_optional(ip_address),
        user_agent_hash=hash_user_agent_optional(user_agent),
        expires_at=now + _refresh_token_ttl(),
    )


def _invalid_invite_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Invalid or expired invite code",
    )


def _profile_from_invite_registration_input(
    *,
    user_id: UUID,
    community_id: UUID,
    profile_input: RegisterWithInviteProfileInput | None,
) -> Profile:
    profile = Profile(user_id=user_id, community_id=community_id)
    if profile_input is None:
        return profile

    full_name = profile_input.full_name
    if full_name is None:
        name_parts = [
            part
            for part in (profile_input.first_name, profile_input.last_name)
            if part is not None
        ]
        full_name = " ".join(name_parts) or None

    profile.display_name = profile_input.display_name or full_name
    profile.first_name = profile_input.first_name
    profile.last_name = profile_input.last_name
    profile.full_name = full_name
    profile.city = profile_input.city
    return profile


async def _find_invite_for_update_by_hash(
    session: AsyncSession,
    *,
    invite_code_hash: str,
) -> Invite | None:
    return await session.scalar(
        select(Invite)
        .where(Invite.code_hash == invite_code_hash)
        .with_for_update(),
    )


async def _find_membership_for_update(
    session: AsyncSession,
    *,
    user_id: UUID,
    community_id: UUID,
) -> CommunityMembership | None:
    return await session.scalar(
        select(CommunityMembership)
        .where(
            CommunityMembership.user_id == user_id,
            CommunityMembership.community_id == community_id,
        )
        .with_for_update(),
    )


def _validate_invite_for_use(
    *,
    invite: Invite,
    community: Community | None,
    now: datetime,
) -> None:
    if invite.status != _INVITE_ACTIVE_STATUS:
        raise _invalid_invite_error()
    if invite.expires_at is not None and invite.expires_at <= now:
        raise _invalid_invite_error()
    if invite.max_uses <= 0 or invite.used_count >= invite.max_uses:
        raise _invalid_invite_error()
    if invite.role not in authorization_service.SUPPORTED_ROLES:
        raise _invalid_invite_error()
    if community is None or not community.is_active:
        raise _invalid_invite_error()


async def _usable_invite_context_for_update(
    session: AsyncSession,
    *,
    invite_code_hash: str,
    now: datetime,
) -> tuple[Invite, Community]:
    invite = await _find_invite_for_update_by_hash(
        session,
        invite_code_hash=invite_code_hash,
    )
    if invite is None:
        raise _invalid_invite_error()

    community = await session.get(Community, invite.community_id)
    _validate_invite_for_use(invite=invite, community=community, now=now)
    if community is None:
        raise _invalid_invite_error()

    return invite, community


def _consume_invite(invite: Invite, *, user_id: UUID, now: datetime) -> None:
    invite.used_count += 1
    if invite.accepted_by is None:
        invite.accepted_by = user_id
    if invite.accepted_at is None:
        invite.accepted_at = now
    if invite.used_count >= invite.max_uses:
        invite.status = _INVITE_USED_STATUS


async def _accept_invite_membership_for_user(
    session: AsyncSession,
    *,
    invite: Invite,
    user_id: UUID,
    now: datetime,
) -> tuple[CommunityMembership, bool, bool]:
    membership = await _find_membership_for_update(
        session,
        user_id=user_id,
        community_id=invite.community_id,
    )
    if membership is not None:
        if membership.status == authorization_service.ACTIVE_STATUS:
            return membership, True, False
        if membership.status == _MEMBERSHIP_PENDING_STATUS:
            membership.role = invite.role
            membership.status = authorization_service.ACTIVE_STATUS
            membership.invited_by = invite.created_by
            membership.joined_at = membership.joined_at or now
            return membership, False, True
        if membership.status in {
            _MEMBERSHIP_SUSPENDED_STATUS,
            _MEMBERSHIP_LEFT_STATUS,
        }:
            raise AuthConflictError("Membership cannot be accepted in its current state")

        raise AuthConflictError("Membership cannot be accepted in its current state")

    membership = CommunityMembership(
        community_id=invite.community_id,
        user_id=user_id,
        role=invite.role,
        status=authorization_service.ACTIVE_STATUS,
        invited_by=invite.created_by,
        joined_at=now,
    )
    session.add(membership)
    return membership, False, True


async def create_password_reset_code(
    session: AsyncSession,
    *,
    email: str,
) -> AuthCodeRequestResponse:
    normalized_email = normalize_email(email)
    _consume_auth_email_rate_limit(_PASSWORD_RESET_PURPOSE, normalized_email)

    user = await _find_user_by_normalized_email(session, normalized_email)
    if (
        user is None
        or user.status != authorization_service.ACTIVE_STATUS
        or user.email is None
        or user.password_hash is None
    ):
        return _email_request_response()

    code = await _create_auth_code_for_user(session, PasswordResetCode, user=user)
    _send_password_reset_code(user.email, code)
    return _email_request_response()


async def confirm_password_reset(
    session: AsyncSession,
    *,
    code: str,
    new_password: str,
) -> AuthCodeConfirmResponse:
    code_row = await _usable_auth_code(session, PasswordResetCode, code=code)
    user = await session.get(AppUser, code_row.user_id, with_for_update=True)
    if (
        user is None
        or user.status != authorization_service.ACTIVE_STATUS
        or user.password_hash is None
    ):
        raise _invalid_or_expired_code_error("password reset")

    now = _now()
    user.password_hash = hash_password(new_password)
    user.updated_at = now
    await _invalidate_user_auth_codes(
        session,
        PasswordResetCode,
        user_id=user.id,
        now=now,
    )
    await session.commit()
    return _confirm_response()


async def create_email_verification_code(
    session: AsyncSession,
    *,
    email: str,
) -> AuthCodeRequestResponse:
    normalized_email = normalize_email(email)
    _consume_auth_email_rate_limit(_EMAIL_VERIFICATION_PURPOSE, normalized_email)

    user = await _find_user_by_normalized_email(session, normalized_email)
    if (
        user is None
        or user.status != authorization_service.ACTIVE_STATUS
        or user.email is None
        or user.email_verified_at is not None
    ):
        return _email_request_response()

    code = await _create_auth_code_for_user(
        session,
        AuthEmailVerificationCode,
        user=user,
    )
    _send_email_verification_code(user.email, code)
    return _email_request_response()


async def confirm_email_verification(
    session: AsyncSession,
    *,
    code: str,
) -> AuthCodeConfirmResponse:
    code_row = await _usable_auth_code(session, AuthEmailVerificationCode, code=code)
    user = await session.get(AppUser, code_row.user_id, with_for_update=True)
    if user is None or user.status != authorization_service.ACTIVE_STATUS:
        raise _invalid_or_expired_code_error("email verification")

    now = _now()
    if user.email_verified_at is None:
        user.email_verified_at = now
    user.updated_at = now
    await _invalidate_user_auth_codes(
        session,
        AuthEmailVerificationCode,
        user_id=user.id,
        now=now,
    )
    await session.commit()
    return _confirm_response()


async def create_set_password_code(
    session: AsyncSession,
    *,
    email: str,
) -> AuthCodeRequestResponse:
    normalized_email = normalize_email(email)
    _consume_auth_email_rate_limit(_SET_PASSWORD_PURPOSE, normalized_email)

    user = await _find_user_by_normalized_email(session, normalized_email)
    if (
        user is None
        or user.status != authorization_service.ACTIVE_STATUS
        or user.email is None
        or user.password_hash is not None
    ):
        return _email_request_response()

    code = await _create_auth_code_for_user(session, AuthSetPasswordCode, user=user)
    _send_set_password_code(user.email, code)
    return _email_request_response()


async def confirm_set_password(
    session: AsyncSession,
    *,
    code: str,
    new_password: str,
) -> AuthCodeConfirmResponse:
    code_row = await _usable_auth_code(session, AuthSetPasswordCode, code=code)
    user = await session.get(AppUser, code_row.user_id, with_for_update=True)
    if user is None or user.status != authorization_service.ACTIVE_STATUS:
        raise _invalid_or_expired_code_error("set-password")
    if user.password_hash is not None:
        raise AuthConflictError("Password is already set")

    now = _now()
    user.password_hash = hash_password(new_password)
    user.updated_at = now
    await _invalidate_user_auth_codes(
        session,
        AuthSetPasswordCode,
        user_id=user.id,
        now=now,
    )
    await session.commit()
    return _confirm_response()


async def register_password_user_with_invite(
    session: AsyncSession,
    *,
    invite_code_hash: str,
    email: str,
    password: str,
    profile: RegisterWithInviteProfileInput | None,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> RegisterWithInviteResponse:
    normalized_email = normalize_email(email)
    refresh_token = create_refresh_token()

    try:
        async with _transaction_scope(session):
            now = _now()
            invite, community = await _usable_invite_context_for_update(
                session,
                invite_code_hash=invite_code_hash,
                now=now,
            )
            existing_user = await _find_user_by_normalized_email(
                session,
                normalized_email,
            )
            if existing_user is not None:
                raise AuthConflictError("Email is already registered")

            user = AppUser(
                email=normalized_email,
                password_hash=hash_password(password),
                status=authorization_service.ACTIVE_STATUS,
                last_login_at=now,
                updated_at=now,
            )
            session.add(user)
            await session.flush()

            user_profile = _profile_from_invite_registration_input(
                user_id=user.id,
                community_id=invite.community_id,
                profile_input=profile,
            )
            membership, _, should_consume_invite = (
                await _accept_invite_membership_for_user(
                    session,
                    invite=invite,
                    user_id=user.id,
                    now=now,
                )
            )
            session.add(user_profile)
            session.add(
                _new_refresh_session(
                    user.id,
                    refresh_token,
                    now=now,
                    device_name=None,
                    ip_address=ip_address,
                    user_agent=user_agent,
                ),
            )
            if should_consume_invite:
                _consume_invite(invite, user_id=user.id, now=now)

            await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        raise AuthConflictError("Email is already registered") from exc

    await session.refresh(user)
    await session.refresh(user_profile)
    await session.refresh(membership)

    access_token, expires_at = _issue_access_token(user.id)
    profile_summary = _profile_summary(user_profile)
    if profile_summary is None:
        raise RuntimeError("invite registration profile was not created")

    return RegisterWithInviteResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_at=expires_at,
        user=_user_summary(user),
        profile=profile_summary,
        membership=_membership_summary(membership),
        community=_community_summary(community),
    )


async def accept_invite_for_current_user(
    session: AsyncSession,
    *,
    invite_code_hash: str,
    current_user: AppUser,
) -> AcceptInviteResponse:
    try:
        async with _transaction_scope(session):
            now = _now()
            invite, community = await _usable_invite_context_for_update(
                session,
                invite_code_hash=invite_code_hash,
                now=now,
            )
            membership, already_member, should_consume_invite = (
                await _accept_invite_membership_for_user(
                    session,
                    invite=invite,
                    user_id=current_user.id,
                    now=now,
                )
            )
            if should_consume_invite:
                _consume_invite(invite, user_id=current_user.id, now=now)

            await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        raise AuthConflictError("Membership already exists") from exc

    await session.refresh(membership)

    return AcceptInviteResponse(
        membership=_membership_summary(membership),
        community=_community_summary(community),
        already_member=already_member,
    )


async def register_password_user(
    session: AsyncSession,
    *,
    email: str,
    password: str,
) -> RegisterResponse:
    normalized_email = normalize_email(email)
    existing_user = await _find_user_by_normalized_email(session, normalized_email)
    if existing_user is not None:
        raise AuthConflictError("Email is already registered")

    user = AppUser(
        email=normalized_email,
        password_hash=hash_password(password),
        status=authorization_service.ACTIVE_STATUS,
    )
    session.add(user)

    try:
        await session.flush()
        profile = Profile(user_id=user.id)
        session.add(profile)
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise AuthConflictError("Email is already registered") from exc

    await session.refresh(user)
    await session.refresh(profile)

    return RegisterResponse(
        user=_user_summary(user),
        profile=_profile_summary(profile),
    )


async def login_password_user(
    session: AsyncSession,
    *,
    email: str,
    password: str,
    device_name: str | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> AuthTokenResponse:
    normalized_email = normalize_email(email)
    user = await _find_user_by_normalized_email(session, normalized_email)
    if (
        user is None
        or user.status != authorization_service.ACTIVE_STATUS
        or not verify_password(password, user.password_hash)
    ):
        raise _authentication_error("Invalid email or password")

    now = _now()
    refresh_token = create_refresh_token()
    session.add(
        _new_refresh_session(
            user.id,
            refresh_token,
            now=now,
            device_name=device_name,
            ip_address=ip_address,
            user_agent=user_agent,
        ),
    )
    user.last_login_at = now
    user.updated_at = now

    await session.commit()
    await session.refresh(user)

    return _token_response(user, refresh_token)


async def refresh_session(
    session: AsyncSession,
    *,
    refresh_token: str,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> AuthTokenResponse:
    refresh_token_hash = _refresh_token_hash_or_auth_error(refresh_token)
    now = _now()
    auth_session = await session.scalar(
        select(AuthSession)
        .where(
            AuthSession.refresh_token_hash == refresh_token_hash,
            AuthSession.revoked_at.is_(None),
            AuthSession.expires_at > now,
        )
        .with_for_update(),
    )
    if auth_session is None or not verify_token_hash(
        refresh_token,
        auth_session.refresh_token_hash,
    ):
        raise _authentication_error("Invalid refresh token")

    user = await session.get(AppUser, auth_session.user_id)
    if user is None or user.status != authorization_service.ACTIVE_STATUS:
        raise _authentication_error("Invalid refresh token")

    new_refresh_token = create_refresh_token()
    auth_session.revoked_at = now
    auth_session.updated_at = now
    session.add(
        _new_refresh_session(
            user.id,
            new_refresh_token,
            now=now,
            device_name=auth_session.device_name,
            ip_address=ip_address,
            user_agent=user_agent,
        ),
    )

    await session.commit()
    await session.refresh(user)

    return _token_response(user, new_refresh_token)


async def logout_session(
    session: AsyncSession,
    *,
    refresh_token: str,
) -> LogoutResponse:
    try:
        refresh_token_hash = hash_token(refresh_token)
    except ValueError:
        return LogoutResponse()

    auth_session = await session.scalar(
        select(AuthSession)
        .where(
            AuthSession.refresh_token_hash == refresh_token_hash,
            AuthSession.revoked_at.is_(None),
        )
        .with_for_update(),
    )
    if auth_session is not None and verify_token_hash(
        refresh_token,
        auth_session.refresh_token_hash,
    ):
        now = _now()
        auth_session.revoked_at = now
        auth_session.updated_at = now
        await session.commit()

    return LogoutResponse()


async def get_me_summary(
    session: AsyncSession,
    *,
    current_user: AppUser,
) -> MeResponse:
    profile = await session.scalar(
        select(Profile).where(Profile.user_id == current_user.id),
    )
    memberships = list(
        await session.scalars(
            select(CommunityMembership)
            .where(
                CommunityMembership.user_id == current_user.id,
                CommunityMembership.status == authorization_service.ACTIVE_STATUS,
            )
            .order_by(CommunityMembership.created_at),
        ),
    )

    return MeResponse(
        user=_user_summary(current_user),
        profile=_profile_summary(profile),
        memberships=[_membership_summary(membership) for membership in memberships],
    )
