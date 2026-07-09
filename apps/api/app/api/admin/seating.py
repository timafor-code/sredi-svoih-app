from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization import require_auth
from app.db.models.core import AppUser
from app.db.session import get_db_session
from app.schemas.admin_seating import (
    AdminSeatingAssignmentsPatchRequest,
    AdminSeatingAssignmentsSaveResponse,
    AdminSeatingLayoutEnvelopeResponse,
    AdminSeatingLayoutFromTemplateRequest,
    AdminSeatingLayoutPatchRequest,
    AdminSeatingLayoutRowResponse,
    AdminSeatingTemplateFromLayoutRequest,
    AdminSeatingTemplateResponse,
)
from app.schemas.events import ApiResponse
from app.services import admin_seating as admin_seating_service

router = APIRouter(prefix="/admin/seating", tags=["admin-seating"])

CurrentUser = Annotated[AppUser, Depends(require_auth)]
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


def _validation_error(message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={"code": "validation_error", "message": message},
    )


def _choose_required_uuid(
    snake_value: UUID | None,
    camel_value: UUID | None,
    *,
    field_name: str,
) -> UUID:
    if snake_value is not None and camel_value is not None and snake_value != camel_value:
        raise _validation_error(f"{field_name} was provided with conflicting values")

    value = snake_value if snake_value is not None else camel_value
    if value is None:
        raise _validation_error(f"{field_name} is required")
    return value


def _choose_optional_uuid(
    snake_value: UUID | None,
    camel_value: UUID | None,
    *,
    field_name: str,
) -> UUID | None:
    if snake_value is not None and camel_value is not None and snake_value != camel_value:
        raise _validation_error(f"{field_name} was provided with conflicting values")
    return snake_value if snake_value is not None else camel_value


@router.get(
    "/templates",
    response_model=ApiResponse[list[AdminSeatingTemplateResponse]],
)
async def list_admin_seating_templates(
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[list[AdminSeatingTemplateResponse]]:
    templates = await admin_seating_service.list_admin_seating_templates(
        session,
        current_user,
    )
    return ApiResponse[list[AdminSeatingTemplateResponse]](data=templates)


@router.get(
    "/templates/{template_id}",
    response_model=ApiResponse[AdminSeatingTemplateResponse],
)
async def get_admin_seating_template(
    template_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminSeatingTemplateResponse]:
    template = await admin_seating_service.get_admin_seating_template(
        session,
        current_user,
        template_id,
    )
    return ApiResponse[AdminSeatingTemplateResponse](data=template)


@router.post(
    "/templates/from-layout",
    response_model=ApiResponse[AdminSeatingTemplateResponse],
    status_code=status.HTTP_201_CREATED,
)
async def create_admin_seating_template_from_layout(
    payload: AdminSeatingTemplateFromLayoutRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminSeatingTemplateResponse]:
    template = await admin_seating_service.create_admin_seating_template_from_layout(
        session,
        current_user,
        payload,
    )
    return ApiResponse[AdminSeatingTemplateResponse](data=template)


@router.delete(
    "/templates/{template_id}",
    response_model=ApiResponse[AdminSeatingTemplateResponse],
)
async def delete_admin_seating_template(
    template_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminSeatingTemplateResponse]:
    template = await admin_seating_service.delete_admin_seating_template(
        session,
        current_user,
        template_id,
    )
    return ApiResponse[AdminSeatingTemplateResponse](data=template)


@router.get(
    "/layout",
    response_model=ApiResponse[AdminSeatingLayoutEnvelopeResponse],
)
async def get_admin_seating_layout(
    session: DbSession,
    current_user: CurrentUser,
    event_id: Annotated[UUID | None, Query()] = None,
    event_id_camel: Annotated[UUID | None, Query(alias="eventId")] = None,
    occurrence_id: Annotated[UUID | None, Query()] = None,
    occurrence_id_camel: Annotated[UUID | None, Query(alias="occurrenceId")] = None,
    capacity_unit_id: Annotated[UUID | None, Query()] = None,
    capacity_unit_id_camel: Annotated[
        UUID | None,
        Query(alias="capacityUnitId"),
    ] = None,
) -> ApiResponse[AdminSeatingLayoutEnvelopeResponse]:
    layout = await admin_seating_service.get_admin_seating_layout(
        session,
        current_user,
        event_id=_choose_required_uuid(
            event_id,
            event_id_camel,
            field_name="event_id",
        ),
        occurrence_id=_choose_optional_uuid(
            occurrence_id,
            occurrence_id_camel,
            field_name="occurrence_id",
        ),
        capacity_unit_id=_choose_required_uuid(
            capacity_unit_id,
            capacity_unit_id_camel,
            field_name="capacity_unit_id",
        ),
    )
    return ApiResponse[AdminSeatingLayoutEnvelopeResponse](data=layout)


@router.post(
    "/layout/from-template",
    response_model=ApiResponse[AdminSeatingLayoutRowResponse],
    status_code=status.HTTP_201_CREATED,
)
async def create_admin_seating_layout_from_template(
    payload: AdminSeatingLayoutFromTemplateRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminSeatingLayoutRowResponse]:
    layout = await admin_seating_service.create_admin_seating_layout_from_template(
        session,
        current_user,
        payload,
    )
    return ApiResponse[AdminSeatingLayoutRowResponse](data=layout)


@router.patch(
    "/layout",
    response_model=ApiResponse[AdminSeatingLayoutRowResponse],
)
async def save_admin_seating_layout(
    payload: AdminSeatingLayoutPatchRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminSeatingLayoutRowResponse]:
    layout = await admin_seating_service.save_admin_seating_layout(
        session,
        current_user,
        payload,
    )
    return ApiResponse[AdminSeatingLayoutRowResponse](data=layout)


@router.patch(
    "/assignments",
    response_model=ApiResponse[AdminSeatingAssignmentsSaveResponse],
)
async def save_admin_seating_assignments(
    payload: AdminSeatingAssignmentsPatchRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminSeatingAssignmentsSaveResponse]:
    result = await admin_seating_service.save_admin_seating_assignments(
        session,
        current_user,
        payload,
    )
    return ApiResponse[AdminSeatingAssignmentsSaveResponse](data=result)
