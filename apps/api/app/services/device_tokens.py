from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from uuid import UUID

from fastapi import HTTPException, status as http_status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.core import AppUser, DeviceToken
from app.schemas.device_tokens import DeviceTokenRegisterRequest

EXPO_PUSH_PROVIDER = "expo"


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


def _not_found(message: str = "Device token not found") -> HTTPException:
    return HTTPException(
        status_code=http_status.HTTP_404_NOT_FOUND,
        detail={"code": "not_found", "message": message},
    )


async def register_device_token(
    session: AsyncSession,
    current_user: AppUser,
    payload: DeviceTokenRegisterRequest,
) -> DeviceToken:
    async with _transaction_scope(session):
        token = await session.scalar(
            select(DeviceToken)
            .where(
                DeviceToken.user_id == current_user.id,
                DeviceToken.expo_push_token == payload.expo_push_token,
            )
            .with_for_update(),
        )

        now = _now()
        if token is None:
            token = DeviceToken(
                user_id=current_user.id,
                expo_push_token=payload.expo_push_token,
                platform=payload.platform,
                push_provider=EXPO_PUSH_PROVIDER,
                device_id=payload.device_id,
                app_version=payload.app_version,
                build_version=payload.build_version,
                environment=payload.environment,
                is_active=True,
                last_seen_at=now,
            )
            session.add(token)
        else:
            token.platform = payload.platform
            token.push_provider = EXPO_PUSH_PROVIDER
            token.device_id = payload.device_id
            token.app_version = payload.app_version
            token.build_version = payload.build_version
            token.environment = payload.environment
            token.is_active = True
            token.last_seen_at = now
            token.updated_at = now

        await session.flush()
        await session.refresh(token)
        return token


async def deactivate_device_token(
    session: AsyncSession,
    current_user: AppUser,
    token_id: UUID,
) -> DeviceToken:
    async with _transaction_scope(session):
        token = await session.scalar(
            select(DeviceToken)
            .where(
                DeviceToken.id == token_id,
                DeviceToken.user_id == current_user.id,
            )
            .with_for_update(),
        )
        if token is None:
            raise _not_found()

        token.is_active = False
        token.updated_at = _now()

        await session.flush()
        await session.refresh(token)
        return token
