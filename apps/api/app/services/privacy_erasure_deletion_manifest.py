from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import column, delete, func, or_, select, table, update
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.auth import (
    AuthEmailVerificationCode,
    AuthSession,
    AuthSetPasswordCode,
    PasswordResetCode,
    PrivacyAccessCode,
    PrivacyAccessSession,
)
from app.db.models.avatar import ProfileAvatar
from app.db.models.core import (
    AdminFeedback,
    AppUser,
    CommunityMembership,
    DeviceToken,
    EventRegistration,
    EventRegistrationAnswer,
    Invite,
    LegalAcceptance,
    PrivacyRequest,
    Profile,
    ProfileContactVisibility,
    PushNotificationDelivery,
    PushNotificationJob,
    SyncedContact,
    WebRegistrationIntent,
)
from app.db.models.seating import EventSeatingAssignment

_PRAYER_ACTIVITY_LOGS = table(
    "prayer_activity_logs",
    column("user_id", PG_UUID(as_uuid=True)),
)


@dataclass(frozen=True)
class PrivacyErasureDeletionManifestResult:
    categories_deleted: list[str]


async def collect_private_avatar_keys(
    session: AsyncSession,
    user_id: UUID,
) -> list[str]:
    return list(
        (
            await session.scalars(
                select(ProfileAvatar.object_key).where(
                    ProfileAvatar.user_id == user_id,
                ),
            )
        ).all(),
    )


async def _delete_rows(
    session: AsyncSession,
    model: Any,
    criterion: Any,
) -> bool:
    result = await session.execute(
        delete(model)
        .where(criterion)
        .execution_options(synchronize_session=False),
    )
    return bool(result.rowcount and result.rowcount > 0)


async def _delete_credentials_and_sessions(
    session: AsyncSession,
    user_id: UUID,
    categories: set[str],
) -> None:
    for model in (
        AuthEmailVerificationCode,
        PasswordResetCode,
        AuthSetPasswordCode,
        PrivacyAccessCode,
    ):
        if await _delete_rows(session, model, model.user_id == user_id):
            categories.add("credential")
    for model in (AuthSession, PrivacyAccessSession):
        if await _delete_rows(session, model, model.user_id == user_id):
            categories.add("session")


async def _delete_personal_surfaces(
    session: AsyncSession,
    user: AppUser,
    categories: set[str],
) -> None:
    if await _delete_rows(session, Profile, Profile.user_id == user.id):
        categories.update(("profile", "contact"))
    if await _delete_rows(
        session,
        ProfileContactVisibility,
        ProfileContactVisibility.user_id == user.id,
    ):
        categories.add("contact")
    if await _delete_rows(session, DeviceToken, DeviceToken.user_id == user.id):
        categories.add("device")
    if await _delete_rows(
        session,
        PushNotificationDelivery,
        PushNotificationDelivery.user_id == user.id,
    ):
        categories.add("device")
    if await _delete_rows(
        session,
        PushNotificationJob,
        PushNotificationJob.target_user_id == user.id,
    ):
        categories.add("device")
    if await _delete_rows(session, SyncedContact, SyncedContact.user_id == user.id):
        categories.add("synced_contact")

    if user.email is not None:
        result = await session.execute(
            update(Invite)
            .where(
                Invite.email.is_not(None),
                func.lower(Invite.email) == user.email.lower(),
            )
            .values(email=None)
            .execution_options(synchronize_session=False),
        )
        if result.rowcount and result.rowcount > 0:
            categories.add("contact")
    if user.phone is not None:
        result = await session.execute(
            update(Invite)
            .where(Invite.phone == user.phone)
            .values(phone=None)
            .execution_options(synchronize_session=False),
        )
        if result.rowcount and result.rowcount > 0:
            categories.add("contact")


async def _delete_registrations_and_memberships(
    session: AsyncSession,
    user_id: UUID,
    categories: set[str],
) -> None:
    if await _delete_rows(
        session,
        EventRegistrationAnswer,
        EventRegistrationAnswer.registration_id.in_(
            select(EventRegistration.id).where(EventRegistration.user_id == user_id),
        ),
    ):
        categories.add("questionnaire_answer")
    if await _delete_rows(
        session,
        EventSeatingAssignment,
        EventSeatingAssignment.user_id == user_id,
    ):
        categories.add("registration")
    if await _delete_rows(
        session,
        LegalAcceptance,
        LegalAcceptance.user_id == user_id,
    ):
        categories.add("legal_acceptance")
    if await _delete_rows(
        session,
        EventRegistration,
        EventRegistration.user_id == user_id,
    ):
        categories.add("registration")
    if await _delete_rows(
        session,
        CommunityMembership,
        CommunityMembership.user_id == user_id,
    ):
        categories.add("membership")


async def _delete_web_registration_intents(
    session: AsyncSession,
    user: AppUser,
) -> bool:
    criteria = [WebRegistrationIntent.matched_user_id == user.id]
    if user.email is not None:
        criteria.append(
            func.lower(WebRegistrationIntent.email_normalized)
            == user.email.lower(),
        )
    if user.phone is not None:
        criteria.append(WebRegistrationIntent.phone_normalized == user.phone)
    return await _delete_rows(session, WebRegistrationIntent, or_(*criteria))


async def apply_privacy_erasure_deletion_manifest(
    session: AsyncSession,
    *,
    user: AppUser,
    avatar_keys: list[str],
) -> PrivacyErasureDeletionManifestResult:
    """Delete the canonical user-owned graph, except the identity row itself.

    Private avatar objects must already have been deleted. Prayer activity is
    handled only by the direct scoped DELETE below; it is never selected or
    returned.
    """
    categories = {"account"}
    if user.email is not None or user.phone is not None:
        categories.add("contact")
    if user.password_hash is not None:
        categories.add("credential")

    await _delete_credentials_and_sessions(session, user.id, categories)
    await _delete_personal_surfaces(session, user, categories)
    await _delete_registrations_and_memberships(session, user.id, categories)

    prayer_result = await session.execute(
        delete(_PRAYER_ACTIVITY_LOGS).where(
            _PRAYER_ACTIVITY_LOGS.c.user_id == user.id,
        ),
    )
    if prayer_result.rowcount and prayer_result.rowcount > 0:
        categories.add("prayer_activity")

    if await _delete_rows(session, AdminFeedback, AdminFeedback.user_id == user.id):
        categories.add("feedback")
    if await _delete_web_registration_intents(session, user):
        categories.add("web_registration_intent")

    content_exists = await session.scalar(
        select(PrivacyRequest.id)
        .where(
            PrivacyRequest.user_id == user.id,
            or_(
                PrivacyRequest.message.is_not(None),
                PrivacyRequest.resolution_note.is_not(None),
            ),
        )
        .limit(1),
    )
    await session.execute(
        update(PrivacyRequest)
        .where(PrivacyRequest.user_id == user.id)
        .values(message=None, resolution_note=None)
        .execution_options(synchronize_session=False),
    )
    if content_exists is not None:
        categories.add("privacy_request_content")

    if await _delete_rows(session, ProfileAvatar, ProfileAvatar.user_id == user.id):
        categories.add("avatar")
    elif avatar_keys:
        categories.add("avatar")

    return PrivacyErasureDeletionManifestResult(sorted(categories))


async def delete_app_user_last(session: AsyncSession, user_id: UUID) -> None:
    deleted = await session.execute(
        delete(AppUser)
        .where(AppUser.id == user_id)
        .execution_options(synchronize_session=False),
    )
    if deleted.rowcount != 1:
        raise SQLAlchemyError("privacy erasure subject delete did not affect one row")
