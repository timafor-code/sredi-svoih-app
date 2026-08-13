from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from starlette.datastructures import FormData, UploadFile
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.formparsers import MultiPartException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization import require_auth
from app.db.models.core import AppUser
from app.db.session import get_db_session
from app.schemas.admin_events import (
    AdminEventCapacityUnitResponse,
    AdminEventCapacityUnitsReplaceRequest,
    AdminEventCategoryCreateRequest,
    AdminEventCategoryResponse,
    AdminEventCategoryUpdateRequest,
    AdminEventCreateRequest,
    AdminEventOccurrenceResponse,
    AdminEventOccurrencesReplaceRequest,
    AdminEventParticipationOptionResponse,
    AdminEventParticipationOptionsReplaceRequest,
    AdminEventPublicSlugCheckRequest,
    AdminEventPublicSlugCheckResponse,
    AdminEventResponse,
    AdminEventUpdateRequest,
    AdminEventWebRegistrationResponse,
    AdminEventWebRegistrationUpdateRequest,
)
from app.schemas.events import (
    ApiResponse,
    ListResponseMeta,
    PaginatedApiResponse,
    PaginationMeta,
)
from app.services import admin_events as admin_events_service
from app.services import admin_event_images as admin_event_images_service
from app.services.admin_events import DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT

router = APIRouter(prefix="/admin", tags=["admin-events"])

CurrentUser = Annotated[AppUser, Depends(require_auth)]
DbSession = Annotated[AsyncSession, Depends(get_db_session)]

_EVENT_IMAGE_MULTIPART_ENVELOPE_BYTES = 64 * 1024


def _invalid_event_image_request() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={
            "code": "invalid_event_image",
            "message": "Exactly one uploaded file part named 'file' is required",
        },
    )


def _invalid_event_image_removal_request() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={
            "code": "invalid_event_image",
            "message": "Event image removal does not accept a request body",
        },
    )


def _event_image_request_too_large() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
        detail={
            "code": "event_image_too_large",
            "message": "Event image exceeds allowed limits",
        },
    )


async def _read_bounded_event_image_request(request: Request) -> bytes:
    request_limit = (
        admin_event_images_service.MAX_EVENT_IMAGE_SOURCE_BYTES
        + _EVENT_IMAGE_MULTIPART_ENVELOPE_BYTES
    )
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > request_limit:
            raise _event_image_request_too_large()
        body.extend(chunk)
    return bytes(body)


async def _parse_event_image_form(request: Request) -> tuple[FormData, UploadFile]:
    body = await _read_bounded_event_image_request(request)
    body_sent = False

    async def receive() -> dict[str, object]:
        nonlocal body_sent
        if body_sent:
            return {"type": "http.request", "body": b"", "more_body": False}
        body_sent = True
        return {"type": "http.request", "body": body, "more_body": False}

    bounded_request = Request(request.scope, receive=receive)
    try:
        form = await bounded_request.form(max_files=2, max_fields=1)
    except (MultiPartException, StarletteHTTPException, ValueError) as exc:
        raise _invalid_event_image_request() from exc

    parts = form.multi_items()
    if (
        len(parts) != 1
        or parts[0][0] != "file"
        or not isinstance(parts[0][1], UploadFile)
    ):
        await form.close()
        raise _invalid_event_image_request()
    return form, parts[0][1]


@router.get("/events", response_model=PaginatedApiResponse[AdminEventResponse])
async def list_admin_events(
    session: DbSession,
    current_user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_LIMIT)] = DEFAULT_PAGE_LIMIT,
    cursor: Annotated[str | None, Query(max_length=512)] = None,
) -> PaginatedApiResponse[AdminEventResponse]:
    events, next_cursor, has_more = await admin_events_service.list_admin_events(
        session,
        current_user,
        limit=limit,
        cursor=cursor,
    )
    return PaginatedApiResponse[AdminEventResponse](
        data=[AdminEventResponse.model_validate(event) for event in events],
        meta=ListResponseMeta(
            pagination=PaginationMeta(
                limit=limit,
                next_cursor=next_cursor,
                has_more=has_more,
            ),
        ),
    )


@router.get(
    "/event-categories",
    response_model=ApiResponse[list[AdminEventCategoryResponse]],
)
async def list_admin_event_categories(
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[list[AdminEventCategoryResponse]]:
    categories = await admin_events_service.list_admin_event_categories(
        session,
        current_user,
    )
    return ApiResponse[list[AdminEventCategoryResponse]](
        data=[
            AdminEventCategoryResponse.model_validate(category)
            for category in categories
        ],
    )


@router.post(
    "/event-categories",
    response_model=ApiResponse[AdminEventCategoryResponse],
    status_code=status.HTTP_201_CREATED,
)
async def create_admin_event_category(
    payload: AdminEventCategoryCreateRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminEventCategoryResponse]:
    category = await admin_events_service.create_admin_event_category(
        session,
        current_user,
        payload,
    )
    return ApiResponse[AdminEventCategoryResponse](
        data=AdminEventCategoryResponse.model_validate(category),
    )


@router.patch(
    "/event-categories/{category_id}",
    response_model=ApiResponse[AdminEventCategoryResponse],
)
async def update_admin_event_category(
    category_id: UUID,
    payload: AdminEventCategoryUpdateRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminEventCategoryResponse]:
    category = await admin_events_service.update_admin_event_category(
        session,
        current_user,
        category_id,
        payload,
    )
    return ApiResponse[AdminEventCategoryResponse](
        data=AdminEventCategoryResponse.model_validate(category),
    )


@router.post(
    "/events",
    response_model=ApiResponse[AdminEventResponse],
    status_code=status.HTTP_201_CREATED,
)
async def create_admin_event(
    payload: AdminEventCreateRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminEventResponse]:
    event = await admin_events_service.create_admin_event(
        session,
        current_user,
        payload,
    )
    return ApiResponse[AdminEventResponse](data=AdminEventResponse.model_validate(event))


@router.get("/events/{event_id}", response_model=ApiResponse[AdminEventResponse])
async def get_admin_event(
    event_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminEventResponse]:
    event = await admin_events_service.get_admin_event(
        session,
        current_user,
        event_id,
    )
    return ApiResponse[AdminEventResponse](data=AdminEventResponse.model_validate(event))


@router.patch("/events/{event_id}", response_model=ApiResponse[AdminEventResponse])
async def update_admin_event(
    event_id: UUID,
    payload: AdminEventUpdateRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminEventResponse]:
    event = await admin_events_service.update_admin_event(
        session,
        current_user,
        event_id,
        payload,
    )
    return ApiResponse[AdminEventResponse](data=AdminEventResponse.model_validate(event))


@router.put(
    "/events/{event_id}/image",
    response_model=ApiResponse[AdminEventResponse],
)
async def upload_admin_event_image(
    event_id: UUID,
    request: Request,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminEventResponse]:
    actor_user_id = current_user.id
    community_id = (
        await admin_event_images_service.authorize_admin_event_image_mutation(
            session,
            current_user,
            event_id,
        )
    )
    form, uploaded_file = await _parse_event_image_form(request)
    try:
        event = await admin_event_images_service.upload_admin_event_image(
            session,
            actor_user_id,
            event_id,
            community_id=community_id,
            source=uploaded_file.file,
            declared_content_type=uploaded_file.content_type,
        )
    finally:
        await form.close()
    return ApiResponse[AdminEventResponse](data=AdminEventResponse.model_validate(event))


@router.delete(
    "/events/{event_id}/image",
    response_model=ApiResponse[AdminEventResponse],
)
async def remove_admin_event_image(
    event_id: UUID,
    request: Request,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminEventResponse]:
    actor_user_id = current_user.id
    community_id = (
        await admin_event_images_service.authorize_admin_event_image_mutation(
            session,
            current_user,
            event_id,
        )
    )
    if await request.body():
        raise _invalid_event_image_removal_request()
    event = await admin_event_images_service.remove_admin_event_image(
        session,
        actor_user_id,
        event_id,
        community_id=community_id,
    )
    return ApiResponse[AdminEventResponse](data=AdminEventResponse.model_validate(event))


@router.get(
    "/events/{event_id}/web-registration",
    response_model=ApiResponse[AdminEventWebRegistrationResponse],
)
async def get_admin_event_web_registration(
    event_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminEventWebRegistrationResponse]:
    result = await admin_events_service.get_admin_event_web_registration(
        session,
        current_user,
        event_id,
    )
    return ApiResponse[AdminEventWebRegistrationResponse](data=result)


@router.post(
    "/events/{event_id}/web-registration/check-slug",
    response_model=ApiResponse[AdminEventPublicSlugCheckResponse],
)
async def check_admin_event_public_slug(
    event_id: UUID,
    payload: AdminEventPublicSlugCheckRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminEventPublicSlugCheckResponse]:
    result = await admin_events_service.check_admin_event_public_slug(
        session,
        current_user,
        event_id,
        payload.public_slug,
    )
    return ApiResponse[AdminEventPublicSlugCheckResponse](data=result)


@router.patch(
    "/events/{event_id}/web-registration",
    response_model=ApiResponse[AdminEventWebRegistrationResponse],
)
async def update_admin_event_web_registration(
    event_id: UUID,
    payload: AdminEventWebRegistrationUpdateRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminEventWebRegistrationResponse]:
    result = await admin_events_service.update_admin_event_web_registration(
        session,
        current_user,
        event_id,
        payload,
    )
    return ApiResponse[AdminEventWebRegistrationResponse](data=result)


@router.post(
    "/events/{event_id}/publish",
    response_model=ApiResponse[AdminEventResponse],
)
async def publish_admin_event(
    event_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminEventResponse]:
    event = await admin_events_service.transition_admin_event_status(
        session,
        current_user,
        event_id,
        "published",
    )
    return ApiResponse[AdminEventResponse](data=AdminEventResponse.model_validate(event))


@router.post(
    "/events/{event_id}/archive",
    response_model=ApiResponse[AdminEventResponse],
)
async def archive_admin_event(
    event_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminEventResponse]:
    event = await admin_events_service.transition_admin_event_status(
        session,
        current_user,
        event_id,
        "archived",
    )
    return ApiResponse[AdminEventResponse](data=AdminEventResponse.model_validate(event))


@router.post(
    "/events/{event_id}/cancel",
    response_model=ApiResponse[AdminEventResponse],
)
async def cancel_admin_event(
    event_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminEventResponse]:
    event = await admin_events_service.transition_admin_event_status(
        session,
        current_user,
        event_id,
        "cancelled",
    )
    return ApiResponse[AdminEventResponse](data=AdminEventResponse.model_validate(event))


@router.get(
    "/events/{event_id}/occurrences",
    response_model=ApiResponse[list[AdminEventOccurrenceResponse]],
)
async def list_admin_event_occurrences(
    event_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[list[AdminEventOccurrenceResponse]]:
    occurrences = await admin_events_service.list_admin_event_occurrences(
        session,
        current_user,
        event_id,
    )
    return ApiResponse[list[AdminEventOccurrenceResponse]](data=occurrences)


@router.put(
    "/events/{event_id}/occurrences",
    response_model=ApiResponse[list[AdminEventOccurrenceResponse]],
)
async def replace_admin_event_occurrences(
    event_id: UUID,
    payload: AdminEventOccurrencesReplaceRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[list[AdminEventOccurrenceResponse]]:
    occurrences = await admin_events_service.replace_admin_event_occurrences(
        session,
        current_user,
        event_id,
        payload,
    )
    return ApiResponse[list[AdminEventOccurrenceResponse]](data=occurrences)


@router.get(
    "/events/{event_id}/participation-options",
    response_model=ApiResponse[list[AdminEventParticipationOptionResponse]],
)
async def list_admin_event_participation_options(
    event_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[list[AdminEventParticipationOptionResponse]]:
    options = await admin_events_service.list_admin_event_participation_options(
        session,
        current_user,
        event_id,
    )
    return ApiResponse[list[AdminEventParticipationOptionResponse]](data=options)


@router.put(
    "/events/{event_id}/participation-options",
    response_model=ApiResponse[list[AdminEventParticipationOptionResponse]],
)
async def replace_admin_event_participation_options(
    event_id: UUID,
    payload: AdminEventParticipationOptionsReplaceRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[list[AdminEventParticipationOptionResponse]]:
    options = await admin_events_service.replace_admin_event_participation_options(
        session,
        current_user,
        event_id,
        payload,
    )
    return ApiResponse[list[AdminEventParticipationOptionResponse]](data=options)


@router.get(
    "/events/{event_id}/capacity-units",
    response_model=ApiResponse[list[AdminEventCapacityUnitResponse]],
)
async def list_admin_event_capacity_units(
    event_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[list[AdminEventCapacityUnitResponse]]:
    units = await admin_events_service.list_admin_event_capacity_units(
        session,
        current_user,
        event_id,
    )
    return ApiResponse[list[AdminEventCapacityUnitResponse]](
        data=[AdminEventCapacityUnitResponse.model_validate(unit) for unit in units],
    )


@router.put(
    "/events/{event_id}/capacity-units",
    response_model=ApiResponse[list[AdminEventCapacityUnitResponse]],
)
async def replace_admin_event_capacity_units(
    event_id: UUID,
    payload: AdminEventCapacityUnitsReplaceRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[list[AdminEventCapacityUnitResponse]]:
    units = await admin_events_service.replace_admin_event_capacity_units(
        session,
        current_user,
        event_id,
        payload,
    )
    return ApiResponse[list[AdminEventCapacityUnitResponse]](
        data=[AdminEventCapacityUnitResponse.model_validate(unit) for unit in units],
    )
