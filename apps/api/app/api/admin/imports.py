from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization import require_auth
from app.db.models.core import AppUser
from app.db.session import get_db_session
from app.schemas.admin_import import (
    AdminImportIgnoreRequest,
    AdminImportItemPublishRequest,
    AdminImportItemResponse,
    AdminImportPublishResponse,
    AdminImportRunCreateRequest,
    AdminImportRunResponse,
)
from app.schemas.events import ApiResponse
from app.services import admin_import as admin_import_service
from app.services.admin_import import DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT

router = APIRouter(prefix="/admin", tags=["admin-import"])

CurrentUser = Annotated[AppUser, Depends(require_auth)]
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


@router.post(
    "/import-runs",
    response_model=ApiResponse[AdminImportRunResponse],
    status_code=status.HTTP_201_CREATED,
)
async def create_admin_import_run(
    payload: AdminImportRunCreateRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminImportRunResponse]:
    run = await admin_import_service.create_admin_import_run(
        session,
        current_user,
        payload,
    )
    return ApiResponse[AdminImportRunResponse](data=run)


@router.get(
    "/import-runs",
    response_model=ApiResponse[list[AdminImportRunResponse]],
)
async def list_admin_import_runs(
    session: DbSession,
    current_user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_LIMIT)] = DEFAULT_PAGE_LIMIT,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ApiResponse[list[AdminImportRunResponse]]:
    runs = await admin_import_service.list_admin_import_runs(
        session,
        current_user,
        limit=limit,
        offset=offset,
    )
    return ApiResponse[list[AdminImportRunResponse]](data=runs)


@router.get(
    "/import-items",
    response_model=ApiResponse[list[AdminImportItemResponse]],
)
async def list_admin_import_items(
    session: DbSession,
    current_user: CurrentUser,
    status: Annotated[str | None, Query(max_length=32)] = None,
    source_id: Annotated[UUID | None, Query()] = None,
    run_id: Annotated[UUID | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_LIMIT)] = DEFAULT_PAGE_LIMIT,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ApiResponse[list[AdminImportItemResponse]]:
    items = await admin_import_service.list_admin_import_items(
        session,
        current_user,
        status=status,
        source_id=source_id,
        run_id=run_id,
        limit=limit,
        offset=offset,
    )
    return ApiResponse[list[AdminImportItemResponse]](data=items)


@router.get(
    "/import-items/{item_id}",
    response_model=ApiResponse[AdminImportItemResponse],
)
async def get_admin_import_item(
    item_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminImportItemResponse]:
    item = await admin_import_service.get_admin_import_item(
        session,
        current_user,
        item_id,
    )
    return ApiResponse[AdminImportItemResponse](data=item)


@router.post(
    "/import-items/{item_id}/ignore",
    response_model=ApiResponse[AdminImportItemResponse],
)
async def ignore_admin_import_item(
    item_id: UUID,
    payload: AdminImportIgnoreRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminImportItemResponse]:
    item = await admin_import_service.ignore_admin_import_item(
        session,
        current_user,
        item_id,
        payload,
    )
    return ApiResponse[AdminImportItemResponse](data=item)


@router.post(
    "/import-items/{item_id}/publish",
    response_model=ApiResponse[AdminImportPublishResponse],
)
async def publish_admin_import_item(
    item_id: UUID,
    payload: AdminImportItemPublishRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminImportPublishResponse]:
    result = await admin_import_service.publish_admin_import_item(
        session,
        current_user,
        item_id,
        payload,
    )
    return ApiResponse[AdminImportPublishResponse](data=result)
