from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.core import (
    AppUser,
    CommunityMembership,
    Event,
    EventRegistrationForm,
    EventRegistrationFormField,
)
from app.schemas.event_questionnaires import (
    AdminEventQuestionnaireDraftRequest,
    AdminEventQuestionnaireFieldResponse,
    AdminEventQuestionnaireFormResponse,
    AdminEventQuestionnaireResponse,
    QuestionnaireOption,
)
from app.services.authorization import ACTIVE_STATUS

WEB_CHANNEL = "web"
DRAFT_STATUS = "draft"
PUBLISHED_STATUS = "published"
RETIRED_STATUS = "retired"
ADMIN_ROLE = "admin"


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


def _error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message},
    )


def _forbidden() -> HTTPException:
    return _error(
        status.HTTP_403_FORBIDDEN,
        "forbidden",
        "Active community admin permission required",
    )


def _not_found() -> HTTPException:
    return _error(status.HTTP_404_NOT_FOUND, "not_found", "Event not found")


def _conflict(message: str) -> HTTPException:
    return _error(status.HTTP_409_CONFLICT, "conflict", message)


async def _admin_community_ids(
    session: AsyncSession,
    current_user: AppUser,
) -> list[UUID]:
    community_ids = list(
        await session.scalars(
            select(CommunityMembership.community_id)
            .where(
                CommunityMembership.user_id == current_user.id,
                CommunityMembership.status == ACTIVE_STATUS,
                CommunityMembership.role == ADMIN_ROLE,
            )
            .order_by(CommunityMembership.community_id),
        ),
    )
    if not community_ids:
        raise _forbidden()
    return community_ids


async def _require_admin_event(
    session: AsyncSession,
    current_user: AppUser,
    event_id: UUID,
    *,
    for_update: bool = False,
) -> Event:
    community_ids = await _admin_community_ids(session, current_user)
    query = select(Event).where(
        Event.id == event_id,
        Event.community_id.in_(community_ids),
    )
    if for_update:
        query = query.with_for_update()
    event = await session.scalar(query)
    if event is None:
        raise _not_found()
    return event


async def _form_response(
    session: AsyncSession,
    form: EventRegistrationForm,
) -> AdminEventQuestionnaireFormResponse:
    fields = list(
        await session.scalars(
            select(EventRegistrationFormField)
            .where(EventRegistrationFormField.form_id == form.id)
            .order_by(
                EventRegistrationFormField.sort_order,
                EventRegistrationFormField.id,
            ),
        ),
    )
    return AdminEventQuestionnaireFormResponse(
        id=form.id,
        event_id=form.event_id,
        channel=WEB_CHANNEL,
        version=form.version,
        purpose=form.purpose,
        status=form.status,
        published_at=form.published_at,
        created_at=form.created_at,
        updated_at=form.updated_at,
        fields=[
            AdminEventQuestionnaireFieldResponse(
                id=field.id,
                field_key=field.field_key,
                field_type=field.field_type,
                label=field.label,
                required=field.required,
                purpose=field.purpose,
                retention_days=field.retention_days,
                options=[
                    QuestionnaireOption.model_validate(option)
                    for option in field.options_payload
                ],
                validation=field.validation_payload,
                data_category=field.data_category,
                sort_order=field.sort_order,
            )
            for field in fields
        ],
    )


async def _questionnaire_response(
    session: AsyncSession,
    event_id: UUID,
) -> AdminEventQuestionnaireResponse:
    forms = list(
        await session.scalars(
            select(EventRegistrationForm)
            .where(
                EventRegistrationForm.event_id == event_id,
                EventRegistrationForm.channel == WEB_CHANNEL,
                EventRegistrationForm.status.in_((DRAFT_STATUS, PUBLISHED_STATUS)),
            )
            .order_by(EventRegistrationForm.version.desc()),
        ),
    )
    draft = next((form for form in forms if form.status == DRAFT_STATUS), None)
    published = next(
        (form for form in forms if form.status == PUBLISHED_STATUS),
        None,
    )
    return AdminEventQuestionnaireResponse(
        event_id=event_id,
        draft=await _form_response(session, draft) if draft is not None else None,
        published=(
            await _form_response(session, published)
            if published is not None
            else None
        ),
    )


async def get_admin_event_questionnaire(
    session: AsyncSession,
    current_user: AppUser,
    event_id: UUID,
) -> AdminEventQuestionnaireResponse:
    await _require_admin_event(session, current_user, event_id)
    return await _questionnaire_response(session, event_id)


async def put_admin_event_questionnaire_draft(
    session: AsyncSession,
    current_user: AppUser,
    event_id: UUID,
    payload: AdminEventQuestionnaireDraftRequest,
) -> AdminEventQuestionnaireResponse:
    async with _transaction_scope(session):
        event = await _require_admin_event(
            session,
            current_user,
            event_id,
            for_update=True,
        )
        draft = await session.scalar(
            select(EventRegistrationForm)
            .where(
                EventRegistrationForm.event_id == event.id,
                EventRegistrationForm.channel == WEB_CHANNEL,
                EventRegistrationForm.status == DRAFT_STATUS,
            )
            .with_for_update(),
        )
        now = datetime.now(UTC)
        if draft is None:
            latest_version = await session.scalar(
                select(func.max(EventRegistrationForm.version)).where(
                    EventRegistrationForm.event_id == event.id,
                    EventRegistrationForm.channel == WEB_CHANNEL,
                ),
            )
            draft = EventRegistrationForm(
                event_id=event.id,
                channel=WEB_CHANNEL,
                version=int(latest_version or 0) + 1,
                purpose=payload.purpose,
                status=DRAFT_STATUS,
                created_by=current_user.id,
                updated_by=current_user.id,
                updated_at=now,
            )
            session.add(draft)
            await session.flush()
        else:
            draft.purpose = payload.purpose
            draft.updated_by = current_user.id
            draft.updated_at = now
            await session.execute(
                delete(EventRegistrationFormField).where(
                    EventRegistrationFormField.form_id == draft.id,
                ),
            )

        for field_payload in payload.fields:
            session.add(
                EventRegistrationFormField(
                    form_id=draft.id,
                    field_key=field_payload.field_key,
                    field_type=field_payload.field_type,
                    label=field_payload.label,
                    required=field_payload.required,
                    purpose=field_payload.purpose,
                    retention_days=field_payload.retention_days,
                    options_payload=[
                        option.model_dump(mode="json")
                        for option in field_payload.options
                    ],
                    validation_payload=dict(field_payload.validation),
                    data_category=field_payload.data_category,
                    sort_order=field_payload.sort_order,
                    updated_at=now,
                ),
            )
        await session.flush()

    return await _questionnaire_response(session, event_id)

async def publish_admin_event_questionnaire(
    session: AsyncSession,
    current_user: AppUser,
    event_id: UUID,
) -> AdminEventQuestionnaireResponse:
    async with _transaction_scope(session):
        event = await _require_admin_event(
            session,
            current_user,
            event_id,
            for_update=True,
        )
        draft = await session.scalar(
            select(EventRegistrationForm)
            .where(
                EventRegistrationForm.event_id == event.id,
                EventRegistrationForm.channel == WEB_CHANNEL,
                EventRegistrationForm.status == DRAFT_STATUS,
            )
            .with_for_update(),
        )
        if draft is None:
            raise _conflict("A valid questionnaire draft is required")
        field_count = await session.scalar(
            select(func.count())
            .select_from(EventRegistrationFormField)
            .where(EventRegistrationFormField.form_id == draft.id),
        )
        if not field_count:
            raise _conflict("A valid questionnaire draft is required")

        published = await session.scalar(
            select(EventRegistrationForm)
            .where(
                EventRegistrationForm.event_id == event.id,
                EventRegistrationForm.channel == WEB_CHANNEL,
                EventRegistrationForm.status == PUBLISHED_STATUS,
            )
            .with_for_update(),
        )
        now = datetime.now(UTC)
        if published is not None:
            published.status = RETIRED_STATUS
            published.updated_by = current_user.id
            published.updated_at = now
            await session.flush()

        draft.status = PUBLISHED_STATUS
        draft.published_at = now
        draft.updated_by = current_user.id
        draft.updated_at = now
        await session.flush()

    return await _questionnaire_response(session, event_id)
