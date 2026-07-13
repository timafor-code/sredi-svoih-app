from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from uuid import UUID

from fastapi import HTTPException, status as http_status
from sqlalchemy import case, func, literal, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.core import (
    AppUser,
    CommunityMembership,
    Profile,
    ProfileContactVisibility,
    SyncedContact,
)
from app.schemas.community_contacts import (
    CommunityContactResponse,
    ProfileContactVisibilityUpdateRequest,
    SyncedContactCreateRequest,
)
from app.services.authorization import ACTIVE_STATUS

_MEMBER_VISIBLE_VALUES = ("members", "public")
_RABBI_ONLY_VIEWER_ROLES = frozenset({"admin", "rabbi"})


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


def _membership_required() -> HTTPException:
    return _error(
        http_status.HTTP_403_FORBIDDEN,
        "membership_required",
        "Active community membership required",
    )


def _not_found() -> HTTPException:
    return _error(
        http_status.HTTP_404_NOT_FOUND,
        "not_found",
        "Synced contact not found",
    )


async def _resolve_viewer_membership(
    session: AsyncSession,
    current_user: AppUser,
    community_id: UUID | None,
) -> CommunityMembership:
    query = select(CommunityMembership).where(
        CommunityMembership.user_id == current_user.id,
        CommunityMembership.status == ACTIVE_STATUS,
    )

    if community_id is not None:
        membership = await session.scalar(
            query.where(CommunityMembership.community_id == community_id),
        )
    else:
        membership = await session.scalar(
            query.order_by(
                CommunityMembership.joined_at.asc().nulls_last(),
                CommunityMembership.created_at.asc(),
                CommunityMembership.id.asc(),
            ).limit(1),
        )

    if membership is None:
        raise _membership_required()
    return membership


async def list_community_contacts(
    session: AsyncSession,
    current_user: AppUser,
    community_id: UUID | None,
) -> list[CommunityContactResponse]:
    viewer_membership = await _resolve_viewer_membership(
        session,
        current_user,
        community_id,
    )
    can_view_rabbi_only = viewer_membership.role in _RABBI_ONLY_VIEWER_ROLES

    profile_visibility = func.coalesce(Profile.profile_visibility, literal("members"))
    phone_visibility = func.coalesce(Profile.phone_visibility, literal("rabbi_only"))
    birthday_visibility = func.coalesce(Profile.birthday_visibility, literal("members"))

    profile_visible = (
        literal(True)
        if can_view_rabbi_only
        else profile_visibility.in_(_MEMBER_VISIBLE_VALUES)
    )
    phone_visible = (
        literal(True)
        if can_view_rabbi_only
        else phone_visibility.in_(_MEMBER_VISIBLE_VALUES)
    )
    birthday_visible = (
        literal(True)
        if can_view_rabbi_only
        else birthday_visibility.in_(_MEMBER_VISIBLE_VALUES)
    )
    display_name = func.coalesce(
        func.nullif(Profile.display_name, ""),
        func.nullif(Profile.full_name, ""),
        func.nullif(
            func.concat_ws(
                " ",
                func.nullif(Profile.first_name, ""),
                func.nullif(Profile.last_name, ""),
            ),
            "",
        ),
        literal("Community member"),
    )
    role_sort_order = case(
        (CommunityMembership.role == "admin", 0),
        (CommunityMembership.role == "event_manager", 1),
        else_=2,
    )

    query = (
        select(
            CommunityMembership.id.label("id"),
            CommunityMembership.user_id.label("user_id"),
            CommunityMembership.community_id.label("community_id"),
            display_name.label("display_name"),
            Profile.first_name.label("first_name"),
            Profile.last_name.label("last_name"),
            Profile.avatar_url.label("avatar_url"),
            Profile.avatar_id.label("avatar_id"),
            case((phone_visible, Profile.phone), else_=None).label("phone"),
            literal(None).label("email"),
            Profile.city.label("city"),
            Profile.hebrew_name.label("hebrew_name"),
            case((birthday_visible, Profile.birth_date), else_=None).label("birth_date"),
            case(
                (birthday_visible, Profile.hebrew_birth_date),
                else_=None,
            ).label("hebrew_birth_date"),
            CommunityMembership.role.label("role"),
            CommunityMembership.status.label("membership_status"),
            CommunityMembership.joined_at.label("joined_at"),
            profile_visible.label("show_in_community_directory"),
            phone_visible.label("share_phone"),
            literal(False).label("share_email"),
            birthday_visible.label("share_birth_date"),
            birthday_visible.label("share_hebrew_birth_date"),
            profile_visible.label("share_city"),
            profile_visible.label("share_hebrew_name"),
        )
        .join(Profile, Profile.user_id == CommunityMembership.user_id)
        .where(
            CommunityMembership.community_id == viewer_membership.community_id,
            CommunityMembership.status == ACTIVE_STATUS,
            profile_visible,
        )
        .order_by(
            role_sort_order,
            func.lower(display_name),
            CommunityMembership.joined_at.asc().nulls_last(),
            CommunityMembership.created_at.asc(),
            CommunityMembership.id.asc(),
        )
    )
    rows = (await session.execute(query)).mappings().all()
    return [CommunityContactResponse.model_validate(row) for row in rows]


async def get_current_user_contact_visibility(
    session: AsyncSession,
    current_user: AppUser,
) -> ProfileContactVisibility:
    async with _transaction_scope(session):
        await session.execute(
            insert(ProfileContactVisibility)
            .values(user_id=current_user.id)
            .on_conflict_do_nothing(index_elements=[ProfileContactVisibility.user_id]),
        )
        visibility = await session.scalar(
            select(ProfileContactVisibility)
            .where(ProfileContactVisibility.user_id == current_user.id)
            .with_for_update(),
        )
        if visibility is None:
            raise RuntimeError("Contact visibility default did not return a row")
        return visibility


async def upsert_current_user_contact_visibility(
    session: AsyncSession,
    current_user: AppUser,
    payload: ProfileContactVisibilityUpdateRequest,
) -> ProfileContactVisibility:
    values = {"user_id": current_user.id, **payload.model_dump()}
    statement = insert(ProfileContactVisibility).values(**values)
    updates = {
        field_name: getattr(statement.excluded, field_name)
        for field_name in ProfileContactVisibilityUpdateRequest.model_fields
    }
    updates["updated_at"] = _now()

    async with _transaction_scope(session):
        await session.execute(
            statement.on_conflict_do_update(
                index_elements=[ProfileContactVisibility.user_id],
                set_=updates,
            ),
        )
        visibility = await session.scalar(
            select(ProfileContactVisibility)
            .where(ProfileContactVisibility.user_id == current_user.id)
            .execution_options(populate_existing=True),
        )
        if visibility is None:
            raise RuntimeError("Contact visibility upsert did not return a row")
        return visibility


async def create_current_user_synced_contact(
    session: AsyncSession,
    current_user: AppUser,
    payload: SyncedContactCreateRequest,
) -> SyncedContact:
    # The payload is PII. This service deliberately does not log it or infer
    # deduplication semantics that the current schema does not guarantee.
    async with _transaction_scope(session):
        synced_contact = SyncedContact(
            user_id=current_user.id,
            name=payload.name,
            phone_hash=payload.phone_hash,
            email_hash=payload.email_hash,
            birthday=payload.birthday,
            consented_at=payload.consented_at,
        )
        session.add(synced_contact)
        await session.flush()
        await session.refresh(synced_contact)
        return synced_contact


async def delete_current_user_synced_contact(
    session: AsyncSession,
    current_user: AppUser,
    contact_id: UUID,
) -> UUID:
    async with _transaction_scope(session):
        synced_contact = await session.scalar(
            select(SyncedContact)
            .where(
                SyncedContact.id == contact_id,
                SyncedContact.user_id == current_user.id,
            )
            .with_for_update(),
        )
        if synced_contact is None:
            raise _not_found()

        await session.delete(synced_contact)
        await session.flush()
        return contact_id
