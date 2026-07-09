from __future__ import annotations

from collections import defaultdict
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from uuid import UUID

from fastapi import HTTPException, status as http_status
from sqlalchemy import Text, and_, case, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.db.models.core import (
    AppUser,
    CommunityMembership,
    Event,
    EventOccurrence,
    EventRegistration,
    EventRegistrationOptionSelection,
    Profile,
)
from app.schemas.admin_members import (
    AdminMemberDetailResponse,
    AdminMemberListItemResponse,
    AdminMemberMembershipResponse,
    AdminMemberMembershipUpdateRequest,
    AdminMemberProfileUpdateRequest,
    AdminMemberProfileUpdateResponse,
    AdminMemberRegistrationResponse,
)
from app.services import authorization as authorization_service
from app.services.admin_registrations import build_selected_option_response
from app.services.authorization import ACTIVE_STATUS

DEFAULT_PAGE_LIMIT = 100
MAX_PAGE_LIMIT = 200

MEMBERSHIP_ROLES = frozenset({"member", "rabbi", "event_manager", "admin"})
MEMBERSHIP_STATUSES = frozenset({"pending", "active", "suspended", "left"})
NO_MEMBERSHIP_FILTER = "no_membership"

# Admin members access is strictly admin-only. event_manager and rabbi must not
# read or manage this surface, so the profile-viewer and event-manager role
# sets are intentionally not used here.
PROFILE_UPDATE_FIELDS = frozenset(
    {
        "full_name",
        "first_name",
        "last_name",
        "display_name",
        "hebrew_name",
        "email",
        "phone",
        "city",
        "birth_date",
        "hebrew_birth_date",
        "birth_time_context",
        "nusach",
        "tribe_status",
        "marital_status",
        "about",
        "onboarding_completed",
    },
)


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


def _now() -> datetime:
    return datetime.now(UTC)


def _error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message},
    )


def _not_found(message: str = "Member not found") -> HTTPException:
    return _error(http_status.HTTP_404_NOT_FOUND, "not_found", message)


def _validation_error(message: str) -> HTTPException:
    return _error(http_status.HTTP_422_UNPROCESSABLE_ENTITY, "validation_error", message)


async def _require_admin_community(
    session: AsyncSession,
    current_user: AppUser,
    community_id: UUID,
) -> CommunityMembership:
    return await authorization_service.require_admin(
        session,
        current_user.id,
        community_id,
    )


def _first_text(*values: object | None) -> str | None:
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return None


def _display_name(profile: Profile) -> str:
    return (
        _first_text(
            profile.display_name,
            profile.full_name,
            " ".join(
                value
                for value in [profile.first_name, profile.last_name]
                if value
            ),
            profile.email,
        )
        or str(profile.user_id)
    )


def _normalize_role_filter(role: str | None) -> str | None:
    normalized = _first_text(role)
    if normalized is None:
        return None

    normalized = normalized.lower()
    if normalized == "all":
        return None
    if normalized not in MEMBERSHIP_ROLES:
        raise _validation_error("Invalid membership role")
    return normalized


def _normalize_membership_status_filter(status: str | None) -> str | None:
    normalized = _first_text(status)
    if normalized is None:
        return None

    normalized = normalized.lower()
    if normalized == "all":
        return None
    if normalized == NO_MEMBERSHIP_FILTER:
        return NO_MEMBERSHIP_FILTER
    if normalized not in MEMBERSHIP_STATUSES:
        raise _validation_error("Invalid membership status")
    return normalized


def _registration_stats_columns():
    scoped_starts_at = func.coalesce(EventOccurrence.starts_at, Event.starts_at)
    not_cancelled = EventRegistration.status != "cancelled"
    return [
        EventRegistration.user_id.label("user_id"),
        func.count().label("registrations_total"),
        func.count()
        .filter(and_(not_cancelled, scoped_starts_at >= func.now()))
        .label("registrations_upcoming"),
        func.count()
        .filter(and_(not_cancelled, scoped_starts_at < func.now()))
        .label("registrations_past"),
        func.count()
        .filter(EventRegistration.status == "cancelled")
        .label("registrations_cancelled"),
        func.max(EventRegistration.registered_at).label("last_registration_at"),
    ]


def _registration_stats_query(community_id: UUID):
    return (
        select(*_registration_stats_columns())
        .select_from(EventRegistration)
        .join(
            Event,
            and_(
                Event.id == EventRegistration.event_id,
                Event.community_id == community_id,
            ),
        )
        .outerjoin(
            EventOccurrence,
            EventOccurrence.id == EventRegistration.occurrence_id,
        )
        .group_by(EventRegistration.user_id)
    )


def _member_scope_condition():
    other_membership = aliased(CommunityMembership)
    active_membership_anywhere = (
        select(other_membership.id)
        .where(
            other_membership.user_id == Profile.user_id,
            other_membership.status == ACTIVE_STATUS,
        )
        .exists()
    )
    return or_(CommunityMembership.id.is_not(None), ~active_membership_anywhere)


def _list_item_kwargs(
    profile: Profile,
    membership: CommunityMembership | None,
    stats: dict[str, object],
) -> dict[str, object]:
    return {
        "user_id": profile.user_id,
        "display_name": _display_name(profile),
        "first_name": profile.first_name,
        "last_name": profile.last_name,
        "email": profile.email,
        "phone": profile.phone,
        "avatar_url": profile.avatar_url,
        "city": profile.city,
        "birth_date": profile.birth_date,
        "hebrew_birth_date": profile.hebrew_birth_date,
        "nusach": profile.nusach,
        "onboarding_completed": profile.onboarding_completed,
        "profile_created_at": profile.created_at,
        "profile_updated_at": profile.updated_at,
        "membership_id": membership.id if membership is not None else None,
        "community_id": membership.community_id if membership is not None else None,
        "membership_role": membership.role if membership is not None else None,
        "membership_status": membership.status if membership is not None else None,
        "joined_at": membership.joined_at if membership is not None else None,
        "invited_by": membership.invited_by if membership is not None else None,
        "registrations_total": int(stats.get("registrations_total") or 0),
        "registrations_upcoming": int(stats.get("registrations_upcoming") or 0),
        "registrations_past": int(stats.get("registrations_past") or 0),
        "registrations_cancelled": int(stats.get("registrations_cancelled") or 0),
        "last_registration_at": stats.get("last_registration_at"),
    }


async def list_admin_members(
    session: AsyncSession,
    current_user: AppUser,
    *,
    community_id: UUID,
    search: str | None,
    role: str | None,
    membership_status: str | None,
    limit: int,
    offset: int,
) -> list[AdminMemberListItemResponse]:
    await _require_admin_community(session, current_user, community_id)

    role_filter = _normalize_role_filter(role)
    status_filter = _normalize_membership_status_filter(membership_status)

    stats = _registration_stats_query(community_id).subquery()

    query = (
        select(
            Profile,
            CommunityMembership,
            stats.c.registrations_total,
            stats.c.registrations_upcoming,
            stats.c.registrations_past,
            stats.c.registrations_cancelled,
            stats.c.last_registration_at,
        )
        .outerjoin(
            CommunityMembership,
            and_(
                CommunityMembership.user_id == Profile.user_id,
                CommunityMembership.community_id == community_id,
            ),
        )
        .outerjoin(stats, stats.c.user_id == Profile.user_id)
        .where(_member_scope_condition())
    )

    if status_filter == NO_MEMBERSHIP_FILTER:
        query = query.where(CommunityMembership.id.is_(None))
    elif status_filter is not None:
        query = query.where(CommunityMembership.status == status_filter)

    if role_filter is not None:
        query = query.where(CommunityMembership.role == role_filter)

    normalized_search = _first_text(search)
    if normalized_search is not None:
        pattern = f"%{normalized_search}%"
        query = query.where(
            or_(
                func.coalesce(Profile.display_name, "").ilike(pattern),
                func.coalesce(Profile.full_name, "").ilike(pattern),
                func.concat_ws(" ", Profile.first_name, Profile.last_name).ilike(pattern),
                func.coalesce(Profile.email, "").ilike(pattern),
                func.coalesce(Profile.phone, "").ilike(pattern),
                func.coalesce(Profile.city, "").ilike(pattern),
                cast(Profile.user_id, Text).ilike(pattern),
            ),
        )

    membership_rank = case(
        (CommunityMembership.status == ACTIVE_STATUS, 0),
        (CommunityMembership.id.is_not(None), 1),
        else_=2,
    )
    name_sort = func.lower(
        func.coalesce(
            func.nullif(Profile.display_name, ""),
            func.nullif(func.concat_ws(" ", Profile.first_name, Profile.last_name), ""),
            func.nullif(Profile.email, ""),
            cast(Profile.user_id, Text),
        ),
    )

    rows = (
        (
            await session.execute(
                query.order_by(
                    membership_rank,
                    name_sort.asc(),
                    Profile.created_at.desc(),
                    Profile.user_id,
                )
                .limit(limit)
                .offset(offset),
            )
        )
        .tuples()
        .all()
    )

    return [
        AdminMemberListItemResponse(
            **_list_item_kwargs(
                profile,
                membership,
                {
                    "registrations_total": total,
                    "registrations_upcoming": upcoming,
                    "registrations_past": past,
                    "registrations_cancelled": cancelled,
                    "last_registration_at": last_registration_at,
                },
            ),
        )
        for profile, membership, total, upcoming, past, cancelled, last_registration_at in rows
    ]


async def _resolve_scoped_member(
    session: AsyncSession,
    *,
    target_user_id: UUID,
    community_id: UUID,
    lock_profile: bool = False,
    lock_membership: bool = False,
) -> tuple[Profile, CommunityMembership | None]:
    profile_query = select(Profile).where(Profile.user_id == target_user_id)
    if lock_profile:
        profile_query = profile_query.with_for_update()
    profile = await session.scalar(profile_query)

    membership_query = select(CommunityMembership).where(
        CommunityMembership.user_id == target_user_id,
        CommunityMembership.community_id == community_id,
    )
    if lock_membership:
        membership_query = membership_query.with_for_update()
    membership = await session.scalar(membership_query)

    if profile is None:
        raise _not_found()

    if membership is None:
        active_elsewhere = await session.scalar(
            select(CommunityMembership.id)
            .where(
                CommunityMembership.user_id == target_user_id,
                CommunityMembership.status == ACTIVE_STATUS,
            )
            .limit(1),
        )
        if active_elsewhere is not None:
            raise _not_found()

    return profile, membership


async def _member_registration_stats(
    session: AsyncSession,
    *,
    community_id: UUID,
    target_user_id: UUID,
) -> dict[str, object]:
    row = (
        await session.execute(
            _registration_stats_query(community_id).where(
                EventRegistration.user_id == target_user_id,
            ),
        )
    ).one_or_none()
    if row is None:
        return {}

    return {
        "registrations_total": row.registrations_total,
        "registrations_upcoming": row.registrations_upcoming,
        "registrations_past": row.registrations_past,
        "registrations_cancelled": row.registrations_cancelled,
        "last_registration_at": row.last_registration_at,
    }


async def get_admin_member(
    session: AsyncSession,
    current_user: AppUser,
    target_user_id: UUID,
    *,
    community_id: UUID,
) -> AdminMemberDetailResponse:
    await _require_admin_community(session, current_user, community_id)

    profile, membership = await _resolve_scoped_member(
        session,
        target_user_id=target_user_id,
        community_id=community_id,
    )
    stats = await _member_registration_stats(
        session,
        community_id=community_id,
        target_user_id=target_user_id,
    )

    return AdminMemberDetailResponse(
        **_list_item_kwargs(profile, membership, stats),
        profile_community_id=profile.community_id,
        full_name=profile.full_name,
        hebrew_name=profile.hebrew_name,
        birth_time_context=profile.birth_time_context,
        tribe_status=profile.tribe_status,
        marital_status=profile.marital_status,
        about=profile.about,
        profile_visibility=profile.profile_visibility,
        birthday_visibility=profile.birthday_visibility,
        phone_visibility=profile.phone_visibility,
        notification_preferences=profile.notification_preferences,
        membership_community_id=(
            membership.community_id if membership is not None else None
        ),
        membership_created_at=(
            membership.created_at if membership is not None else None
        ),
    )


async def list_admin_member_registrations(
    session: AsyncSession,
    current_user: AppUser,
    target_user_id: UUID,
    *,
    community_id: UUID,
) -> list[AdminMemberRegistrationResponse]:
    await _require_admin_community(session, current_user, community_id)
    await _resolve_scoped_member(
        session,
        target_user_id=target_user_id,
        community_id=community_id,
    )

    scoped_starts_at = func.coalesce(EventOccurrence.starts_at, Event.starts_at)
    rows = (
        (
            await session.execute(
                select(EventRegistration, Event, EventOccurrence)
                .join(
                    Event,
                    and_(
                        Event.id == EventRegistration.event_id,
                        Event.community_id == community_id,
                    ),
                )
                .outerjoin(
                    EventOccurrence,
                    EventOccurrence.id == EventRegistration.occurrence_id,
                )
                .where(EventRegistration.user_id == target_user_id)
                .order_by(
                    scoped_starts_at.desc().nulls_last(),
                    EventRegistration.registered_at.desc(),
                    EventRegistration.id.desc(),
                ),
            )
        )
        .tuples()
        .all()
    )

    selections_by_registration = await _load_selected_options(
        session,
        [registration.id for registration, _, _ in rows],
    )

    return [
        AdminMemberRegistrationResponse(
            registration_id=registration.id,
            event_id=event.id,
            event_title=event.title,
            occurrence_id=registration.occurrence_id,
            occurrence_title=occurrence.title if occurrence is not None else None,
            occurrence_starts_at=(
                occurrence.starts_at if occurrence is not None else event.starts_at
            ),
            occurrence_ends_at=(
                occurrence.ends_at if occurrence is not None else event.ends_at
            ),
            registration_status=registration.status,
            seats_count=registration.seats_count,
            payment_status=registration.payment_status,
            registered_at=registration.registered_at,
            confirmed_at=registration.confirmed_at,
            cancelled_at=registration.cancelled_at,
            selected_options=[
                build_selected_option_response(selection)
                for selection in selections_by_registration[registration.id]
            ],
        )
        for registration, event, occurrence in rows
    ]


async def _load_selected_options(
    session: AsyncSession,
    registration_ids: Sequence[UUID],
) -> dict[UUID, list[EventRegistrationOptionSelection]]:
    selections_by_registration: dict[
        UUID,
        list[EventRegistrationOptionSelection],
    ] = defaultdict(list)
    if not registration_ids:
        return selections_by_registration

    selections = await session.scalars(
        select(EventRegistrationOptionSelection)
        .where(EventRegistrationOptionSelection.registration_id.in_(registration_ids))
        .order_by(
            EventRegistrationOptionSelection.created_at,
            EventRegistrationOptionSelection.id,
        ),
    )
    for selection in selections:
        selections_by_registration[selection.registration_id].append(selection)
    return selections_by_registration


async def update_admin_member_profile(
    session: AsyncSession,
    current_user: AppUser,
    target_user_id: UUID,
    payload: AdminMemberProfileUpdateRequest,
) -> AdminMemberProfileUpdateResponse:
    await _require_admin_community(session, current_user, payload.community_id)

    updates = payload.model_dump(exclude_unset=True)
    updates.pop("community_id", None)
    unsupported_fields = set(updates) - PROFILE_UPDATE_FIELDS
    if unsupported_fields:
        raise _validation_error("Unsupported profile field")
    if not updates:
        raise _validation_error("At least one profile field is required")

    async with _transaction_scope(session):
        profile, _ = await _resolve_scoped_member(
            session,
            target_user_id=target_user_id,
            community_id=payload.community_id,
            lock_profile=True,
        )

        for field_name, value in updates.items():
            setattr(profile, field_name, value)
        profile.updated_at = _now()

        await session.flush()
        await session.refresh(profile)

        return AdminMemberProfileUpdateResponse(
            user_id=profile.user_id,
            profile_community_id=profile.community_id,
            full_name=profile.full_name,
            first_name=profile.first_name,
            last_name=profile.last_name,
            display_name=profile.display_name,
            hebrew_name=profile.hebrew_name,
            email=profile.email,
            phone=profile.phone,
            city=profile.city,
            birth_date=profile.birth_date,
            hebrew_birth_date=profile.hebrew_birth_date,
            birth_time_context=profile.birth_time_context,
            nusach=profile.nusach,
            tribe_status=profile.tribe_status,
            marital_status=profile.marital_status,
            about=profile.about,
            onboarding_completed=profile.onboarding_completed,
            profile_updated_at=profile.updated_at,
        )


async def update_admin_member_membership(
    session: AsyncSession,
    current_user: AppUser,
    target_user_id: UUID,
    payload: AdminMemberMembershipUpdateRequest,
) -> AdminMemberMembershipResponse:
    await _require_admin_community(session, current_user, payload.community_id)

    async with _transaction_scope(session):
        _, membership = await _resolve_scoped_member(
            session,
            target_user_id=target_user_id,
            community_id=payload.community_id,
            lock_membership=True,
        )

        now = _now()
        if membership is None:
            membership = CommunityMembership(
                community_id=payload.community_id,
                user_id=target_user_id,
                role=payload.role,
                status=payload.status,
                invited_by=current_user.id,
                joined_at=now if payload.status == ACTIVE_STATUS else None,
            )
            session.add(membership)
        else:
            membership.role = payload.role
            membership.status = payload.status
            if payload.status == ACTIVE_STATUS and membership.joined_at is None:
                membership.joined_at = now

        await session.flush()
        await session.refresh(membership)

        return AdminMemberMembershipResponse(
            membership_id=membership.id,
            community_id=membership.community_id,
            user_id=membership.user_id,
            membership_role=membership.role,
            membership_status=membership.status,
            joined_at=membership.joined_at,
            invited_by=membership.invited_by,
            created_at=membership.created_at,
        )
