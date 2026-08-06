from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization import require_auth
from app.db.models.core import AppUser
from app.db.session import get_db_session
from app.schemas.events import ApiResponse
from app.schemas.web_registration_operations import (
    AdminWebRegistrationConflictResponse,
    AdminWebRegistrationConflictUpdateRequest,
    AdminWebRegistrationOperationsSummaryResponse,
    IdentityConflictStatus,
)
from app.services import admin_web_registration_operations as operations_service
from app.services.admin_web_registration_operations import (
    DEFAULT_PAGE_LIMIT,
    MAX_PAGE_LIMIT,
)

router = APIRouter(prefix="/admin/web-registration", tags=["admin-web-registration"])

CurrentUser = Annotated[AppUser, Depends(require_auth)]
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


@router.get(
    "/operations-summary",
    response_model=ApiResponse[AdminWebRegistrationOperationsSummaryResponse],
)
async def get_admin_web_registration_operations_summary(
    session: DbSession,
    current_user: CurrentUser,
    community_id: Annotated[UUID | None, Query()] = None,
) -> ApiResponse[AdminWebRegistrationOperationsSummaryResponse]:
    summary = await operations_service.get_operations_summary(
        session,
        current_user,
        community_id=community_id,
    )
    return ApiResponse[AdminWebRegistrationOperationsSummaryResponse](data=summary)


@router.get(
    "/conflicts",
    response_model=ApiResponse[list[AdminWebRegistrationConflictResponse]],
)
async def list_admin_web_registration_conflicts(
    session: DbSession,
    current_user: CurrentUser,
    status: Annotated[IdentityConflictStatus | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_LIMIT)] = DEFAULT_PAGE_LIMIT,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ApiResponse[list[AdminWebRegistrationConflictResponse]]:
    conflicts = await operations_service.list_identity_conflicts(
        session,
        current_user,
        status=status,
        limit=limit,
        offset=offset,
    )
    return ApiResponse[list[AdminWebRegistrationConflictResponse]](data=conflicts)


@router.patch(
    "/conflicts/{conflict_id}",
    response_model=ApiResponse[AdminWebRegistrationConflictResponse],
)
async def update_admin_web_registration_conflict(
    conflict_id: UUID,
    payload: AdminWebRegistrationConflictUpdateRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminWebRegistrationConflictResponse]:
    conflict = await operations_service.update_identity_conflict(
        session,
        current_user,
        conflict_id,
        payload,
    )
    return ApiResponse[AdminWebRegistrationConflictResponse](data=conflict)
