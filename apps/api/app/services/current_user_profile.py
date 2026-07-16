from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.core import AppUser, Profile
from app.schemas.current_user_profile import (
    CurrentUserProfileResponse,
    CurrentUserProfileUpdateRequest,
)

_PROFILE_UPDATE_FIELDS = frozenset(CurrentUserProfileUpdateRequest.model_fields)


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


def _profile_not_found() -> HTTPException:
    return _error(status.HTTP_404_NOT_FOUND, "not_found", "Profile not found")


def _empty_update() -> HTTPException:
    return _error(
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        "validation_error",
        "At least one profile field is required",
    )


def serialize_current_user_profile(profile: Profile) -> CurrentUserProfileResponse:
    return CurrentUserProfileResponse.model_validate(profile)


async def update_current_user_profile(
    session: AsyncSession,
    current_user: AppUser,
    payload: CurrentUserProfileUpdateRequest,
) -> CurrentUserProfileResponse:
    updates = payload.model_dump(exclude_unset=True)
    unsupported_fields = set(updates) - _PROFILE_UPDATE_FIELDS
    if unsupported_fields:
        raise _error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "validation_error",
            "Unsupported profile field",
        )
    if not updates:
        raise _empty_update()

    async with _transaction_scope(session):
        profile = await session.scalar(
            select(Profile)
            .where(Profile.user_id == current_user.id)
            .with_for_update(),
        )
        if profile is None:
            raise _profile_not_found()

        for field_name, value in updates.items():
            setattr(profile, field_name, value)
        profile.updated_at = _now()

        await session.flush()
        await session.refresh(profile)
        return serialize_current_user_profile(profile)
