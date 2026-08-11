from __future__ import annotations

import base64
import binascii
from datetime import UTC, datetime
from typing import Literal, Sequence
from urllib.parse import urlencode, urlsplit, urlunsplit
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, func, or_, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from app.db.models.core import (
    AppUser,
    CommunityMembership,
    Event,
    EventCapacityUnit,
    EventCategory,
    EventOccurrence,
    EventParticipationOption,
    EventPublicSlug,
    EventRegistration,
    EventRegistrationForm,
    EventRegistrationFormField,
    LegalDocument,
)
from app.schemas.event_questionnaires import (
    QuestionnaireOption,
    WebEventQuestionnaireFieldResponse,
)
from app.schemas.events import (
    WebEventRegistrationFormResponse,
    WebRegistrationEventResponse,
    WebRegistrationLegalDocumentResponse,
    WebRegistrationOccurrenceResponse,
    WebRegistrationParticipationOptionResponse,
)
from app.services.authorization import ACTIVE_STATUS
from app.services.event_public_slugs import (
    InvalidPublicSlugError,
    get_canonical_public_slug,
    validate_public_path_slug,
)

PUBLISHED_STATUS = "published"
PUBLIC_VISIBILITY = "public"
MEMBERS_ONLY_VISIBILITY = "members_only"
OCCURRENCE_VISIBLE_STATUS = "active"
WEB_REGISTRATION_VISIBILITIES = ("unlisted", "listed")
WEB_REGISTRATION_MODE = "internal_free"
CAPACITY_REGISTRATION_STATUSES = ("confirmed", "pending", "waitlisted")

DEFAULT_PAGE_LIMIT = 50
MAX_PAGE_LIMIT = 100


class EventNotFoundError(HTTPException):
    def __init__(self, detail: str = "Event not found") -> None:
        super().__init__(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


class InvalidCursorError(HTTPException):
    def __init__(self, detail: str = "Invalid pagination cursor") -> None:
        super().__init__(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail,
        )


class WebRegistrationUnavailableError(HTTPException):
    def __init__(self) -> None:
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "registration_unavailable",
                "message": "Registration is not available",
            },
        )


def build_public_event_url(
    base_url: str,
    public_slug: str,
    occurrence_id: UUID | None = None,
) -> str:
    parsed = urlsplit(base_url)
    path = f"{parsed.path.rstrip('/')}/events/{public_slug}"
    query = urlencode({"occurrence": str(occurrence_id)}) if occurrence_id else ""
    return urlunsplit((parsed.scheme, parsed.netloc, path, query, ""))


def is_web_registration_available(event: Event) -> bool:
    return (
        event.status == PUBLISHED_STATUS
        and event.visibility == PUBLIC_VISIBILITY
        and event.registration_mode == WEB_REGISTRATION_MODE
        and event.web_visibility in WEB_REGISTRATION_VISIBILITIES
    )


async def require_web_registration_event(
    session: AsyncSession,
    event_id: UUID,
    *,
    for_update: bool = False,
) -> Event:
    query = select(Event).where(
        Event.id == event_id,
        Event.status == PUBLISHED_STATUS,
        Event.visibility == PUBLIC_VISIBILITY,
        Event.registration_mode == WEB_REGISTRATION_MODE,
        Event.web_visibility.in_(WEB_REGISTRATION_VISIBILITIES),
    )
    if for_update:
        query = query.with_for_update()
    event = await session.scalar(query)
    if event is None:
        raise WebRegistrationUnavailableError()
    return event


async def _taken_registration_seats(
    session: AsyncSession,
    *,
    event_id: UUID,
    occurrence_id: UUID | None,
) -> int:
    occurrence_clause = (
        EventRegistration.occurrence_id.is_(None)
        if occurrence_id is None
        else EventRegistration.occurrence_id == occurrence_id
    )
    taken = await session.scalar(
        select(func.coalesce(func.sum(EventRegistration.seats_count), 0)).where(
            EventRegistration.event_id == event_id,
            occurrence_clause,
            EventRegistration.status.in_(CAPACITY_REGISTRATION_STATUSES),
        ),
    )
    return int(taken or 0)


async def _public_occurrence_state(
    session: AsyncSession,
    event: Event,
    occurrence: EventOccurrence,
    now: datetime,
) -> str:
    if occurrence.registration_opens_at is not None and now < occurrence.registration_opens_at:
        return "not_yet_open"
    if occurrence.registration_closes_at is not None and now >= occurrence.registration_closes_at:
        return "closed"
    capacity = occurrence.capacity if occurrence.capacity is not None else event.capacity
    if capacity is not None:
        taken = await _taken_registration_seats(
            session,
            event_id=event.id,
            occurrence_id=occurrence.id,
        )
        if taken >= capacity:
            return "full"
    return "open"


def _aggregate_registration_state(states: list[str]) -> str:
    for candidate in ("open", "not_yet_open", "full", "closed", "unavailable"):
        if candidate in states:
            return candidate
    return "unavailable"


OccurrenceSelectionMode = Literal["none", "user_select", "nearest"]


def _occurrence_relevance_boundary(occurrence: EventOccurrence) -> datetime:
    return occurrence.ends_at or occurrence.starts_at


def select_nearest_public_occurrence(
    occurrences: Sequence[EventOccurrence],
    now: datetime,
) -> EventOccurrence | None:
    """Select the first occurrence that has not reached its terminal boundary."""
    return min(
        (
            occurrence
            for occurrence in occurrences
            if _occurrence_relevance_boundary(occurrence) > now
        ),
        key=lambda occurrence: (occurrence.starts_at, occurrence.id),
        default=None,
    )


def _select_occurrence(
    event: Event,
    occurrences: Sequence[EventOccurrence],
    now: datetime,
) -> tuple[OccurrenceSelectionMode, EventOccurrence | None]:
    if not occurrences:
        return "none", None
    if event.event_kind == "shabbat":
        return "nearest", select_nearest_public_occurrence(occurrences, now)
    if len(occurrences) == 1:
        return "none", occurrences[0]
    return "user_select", None


def _next_registration_state_check_at(
    selection_mode: OccurrenceSelectionMode,
    occurrences: Sequence[EventOccurrence],
    selected_occurrence: EventOccurrence | None,
    now: datetime,
) -> datetime | None:
    state_occurrences = (
        [selected_occurrence]
        if selection_mode == "nearest" and selected_occurrence is not None
        else occurrences
        if selection_mode != "nearest"
        else []
    )
    candidates = [
        boundary
        for occurrence in state_occurrences
        for boundary in (
            occurrence.registration_opens_at,
            occurrence.registration_closes_at,
        )
        if boundary is not None and boundary > now
    ]
    if selection_mode == "nearest" and selected_occurrence is not None:
        transition_at = _occurrence_relevance_boundary(selected_occurrence)
        if transition_at > now:
            candidates.append(transition_at)
    return min(candidates, default=None)


async def get_web_registration_form(
    session: AsyncSession,
    event_id: UUID,
) -> WebEventRegistrationFormResponse:
    event = await require_web_registration_event(session, event_id)
    canonical_slug = await get_canonical_public_slug(session, event.id)
    if canonical_slug is None:
        raise WebRegistrationUnavailableError()
    return await _build_web_registration_form(
        session,
        event,
        canonical_slug=canonical_slug.slug,
        resolved_from_alias=False,
    )


async def get_web_registration_form_by_slug(
    session: AsyncSession,
    public_slug: str,
) -> WebEventRegistrationFormResponse:
    try:
        validate_public_path_slug(public_slug)
    except InvalidPublicSlugError as error:
        raise WebRegistrationUnavailableError() from error

    resolved_slug = await session.scalar(
        select(EventPublicSlug).where(EventPublicSlug.slug == public_slug),
    )
    if resolved_slug is None:
        raise WebRegistrationUnavailableError()

    event = await require_web_registration_event(session, resolved_slug.event_id)
    canonical_slug = await get_canonical_public_slug(session, event.id)
    if canonical_slug is None:
        raise WebRegistrationUnavailableError()
    return await _build_web_registration_form(
        session,
        event,
        canonical_slug=canonical_slug.slug,
        resolved_from_alias=not resolved_slug.is_canonical,
    )


async def _build_web_registration_form(
    session: AsyncSession,
    event: Event,
    *,
    canonical_slug: str,
    resolved_from_alias: bool,
) -> WebEventRegistrationFormResponse:
    now = datetime.now(UTC)
    active_occurrences = list(
        await session.scalars(
            select(EventOccurrence)
            .where(
                EventOccurrence.event_id == event.id,
                EventOccurrence.status == OCCURRENCE_VISIBLE_STATUS,
            )
            .order_by(EventOccurrence.starts_at, EventOccurrence.id),
        ),
    )
    occurrences = [
        occurrence
        for occurrence in active_occurrences
        if _occurrence_relevance_boundary(occurrence) > now
    ]

    occurrence_responses: list[WebRegistrationOccurrenceResponse] = []
    occurrence_states: list[str] = []
    occurrence_states_by_id: dict[UUID, str] = {}
    for occurrence in occurrences:
        occurrence_state = await _public_occurrence_state(
            session,
            event,
            occurrence,
            now,
        )
        occurrence_states.append(occurrence_state)
        occurrence_states_by_id[occurrence.id] = occurrence_state
        occurrence_responses.append(
            WebRegistrationOccurrenceResponse.model_validate(
                {
                    **{
                        column: getattr(occurrence, column)
                        for column in (
                            "id",
                            "event_id",
                            "title",
                            "starts_at",
                            "ends_at",
                            "timezone",
                            "registration_opens_at",
                            "registration_closes_at",
                            "capacity",
                            "waitlist_enabled",
                            "requires_approval",
                        )
                    },
                    "registration_state": occurrence_state,
                },
            ),
        )

    occurrence_selection_mode, selected_occurrence = _select_occurrence(
        event,
        occurrences,
        now,
    )
    if selected_occurrence is not None:
        registration_state = occurrence_states_by_id[selected_occurrence.id]
    elif occurrence_selection_mode == "nearest":
        registration_state = "unavailable"
    elif occurrence_states:
        registration_state = _aggregate_registration_state(occurrence_states)
    else:
        has_occurrences = await session.scalar(
            select(EventOccurrence.id)
            .where(EventOccurrence.event_id == event.id)
            .limit(1),
        )
        registration_state = (
            "unavailable" if has_occurrences is not None else "open"
        )
        if registration_state == "open" and event.capacity is not None:
            taken = await _taken_registration_seats(
                session,
                event_id=event.id,
                occurrence_id=None,
            )
            if taken >= event.capacity:
                registration_state = "full"

    options = list(
        await session.scalars(
            select(EventParticipationOption)
            .where(
                EventParticipationOption.event_id == event.id,
                EventParticipationOption.is_active.is_(True),
                EventParticipationOption.price_amount == 0,
                EventParticipationOption.is_donation.is_(False),
                EventParticipationOption.option_type != "donation",
            )
            .order_by(
                EventParticipationOption.sort_order,
                EventParticipationOption.created_at,
                EventParticipationOption.id,
            ),
        ),
    )

    documents = list(
        await session.scalars(
            select(LegalDocument)
            .where(
                LegalDocument.document_type.in_(
                    ("event_registration_consent", "privacy_policy"),
                ),
                LegalDocument.effective_at <= now,
                or_(LegalDocument.retired_at.is_(None), LegalDocument.retired_at > now),
            )
            .order_by(
                LegalDocument.document_type,
                LegalDocument.effective_at.desc(),
                LegalDocument.created_at.desc(),
                LegalDocument.id,
            ),
        ),
    )
    current_documents: dict[str, LegalDocument] = {}
    for document in documents:
        current_documents.setdefault(document.document_type, document)
    consent = current_documents.get("event_registration_consent")
    if consent is None:
        raise WebRegistrationUnavailableError()
    selected_documents = [consent]
    privacy_policy = current_documents.get("privacy_policy")
    if privacy_policy is not None:
        selected_documents.append(privacy_policy)

    published_form_id = await session.scalar(
        select(EventRegistrationForm.id).where(
            EventRegistrationForm.event_id == event.id,
            EventRegistrationForm.channel == "web",
            EventRegistrationForm.status == "published",
        ),
    )
    question_fields: list[EventRegistrationFormField] = []
    if published_form_id is not None:
        question_fields = list(
            await session.scalars(
                select(EventRegistrationFormField)
                .where(
                    EventRegistrationFormField.form_id == published_form_id,
                    EventRegistrationFormField.data_category == "ordinary",
                )
                .order_by(
                    EventRegistrationFormField.sort_order,
                    EventRegistrationFormField.id,
                ),
            ),
        )

    return WebEventRegistrationFormResponse(
        canonical_public_path=f"/events/{canonical_slug}",
        resolved_from_alias=resolved_from_alias,
        event=WebRegistrationEventResponse.model_validate(event),
        registration_state=registration_state,
        occurrence_selection_mode=occurrence_selection_mode,
        default_occurrence_id=(
            selected_occurrence.id if selected_occurrence is not None else None
        ),
        next_registration_state_check_at=_next_registration_state_check_at(
            occurrence_selection_mode,
            occurrences,
            selected_occurrence,
            now,
        ),
        occurrences=occurrence_responses,
        participation_options=[
            WebRegistrationParticipationOptionResponse.model_validate(option)
            for option in options
        ],
        legal_documents=[
            WebRegistrationLegalDocumentResponse.model_validate(document)
            for document in selected_documents
        ],
        questionnaire_form_id=published_form_id,
        questions=[
            WebEventQuestionnaireFieldResponse(
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
                sort_order=field.sort_order,
            )
            for field in question_fields
        ],
    )


def encode_events_cursor(starts_at: datetime, event_id: UUID) -> str:
    raw = f"{starts_at.isoformat()}|{event_id}"
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")


def decode_events_cursor(cursor: str) -> tuple[datetime, UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8")
        starts_at_text, _, event_id_text = raw.partition("|")
        starts_at = datetime.fromisoformat(starts_at_text)
        event_id = UUID(event_id_text)
    except (ValueError, UnicodeError, binascii.Error) as exc:
        raise InvalidCursorError() from exc

    if starts_at.tzinfo is None:
        raise InvalidCursorError()

    return starts_at, event_id


async def resolve_member_community_ids(
    session: AsyncSession,
    current_user: AppUser | None,
) -> list[UUID]:
    if current_user is None:
        return []

    result = await session.scalars(
        select(CommunityMembership.community_id).where(
            CommunityMembership.user_id == current_user.id,
            CommunityMembership.status == ACTIVE_STATUS,
        ),
    )
    return list(result)


def _visibility_clause(member_community_ids: list[UUID]) -> ColumnElement[bool]:
    public_clause = and_(
        Event.status == PUBLISHED_STATUS,
        Event.visibility == PUBLIC_VISIBILITY,
    )
    if not member_community_ids:
        return public_clause

    members_clause = and_(
        Event.status == PUBLISHED_STATUS,
        Event.visibility == MEMBERS_ONLY_VISIBILITY,
        Event.community_id.in_(member_community_ids),
    )
    return or_(public_clause, members_clause)


async def list_visible_events(
    session: AsyncSession,
    member_community_ids: list[UUID],
    *,
    limit: int,
    cursor: str | None,
    category: str | None,
    starts_after: datetime | None,
    starts_before: datetime | None,
) -> tuple[list[Event], str | None, bool]:
    query = select(Event).where(_visibility_clause(member_community_ids))

    if category is not None:
        query = query.where(Event.category == category)
    if starts_after is not None:
        query = query.where(Event.starts_at >= starts_after)
    if starts_before is not None:
        query = query.where(Event.starts_at <= starts_before)

    if cursor is not None:
        cursor_starts_at, cursor_event_id = decode_events_cursor(cursor)
        query = query.where(
            tuple_(Event.starts_at, Event.id) > (cursor_starts_at, cursor_event_id),
        )

    query = query.order_by(Event.starts_at, Event.id).limit(limit + 1)
    events = list(await session.scalars(query))

    has_more = len(events) > limit
    events = events[:limit]

    next_cursor: str | None = None
    if has_more and events:
        last_event = events[-1]
        next_cursor = encode_events_cursor(last_event.starts_at, last_event.id)

    return events, next_cursor, has_more


async def get_visible_event(
    session: AsyncSession,
    event_id: UUID,
    member_community_ids: list[UUID],
) -> Event:
    event = await session.scalar(
        select(Event).where(
            Event.id == event_id,
            _visibility_clause(member_community_ids),
        ),
    )
    if event is None:
        raise EventNotFoundError()

    return event


async def list_event_occurrences(
    session: AsyncSession,
    event: Event,
) -> list[EventOccurrence]:
    result = await session.scalars(
        select(EventOccurrence)
        .where(
            EventOccurrence.event_id == event.id,
            EventOccurrence.status == OCCURRENCE_VISIBLE_STATUS,
        )
        .order_by(EventOccurrence.starts_at, EventOccurrence.id),
    )
    return list(result)


async def list_event_participation_options(
    session: AsyncSession,
    event: Event,
) -> list[EventParticipationOption]:
    result = await session.scalars(
        select(EventParticipationOption)
        .where(
            EventParticipationOption.event_id == event.id,
            EventParticipationOption.is_active.is_(True),
        )
        .order_by(
            EventParticipationOption.sort_order,
            EventParticipationOption.created_at,
            EventParticipationOption.id,
        ),
    )
    return list(result)


async def list_event_capacity_units(
    session: AsyncSession,
    event: Event,
) -> list[EventCapacityUnit]:
    result = await session.scalars(
        select(EventCapacityUnit)
        .where(
            EventCapacityUnit.event_id == event.id,
            EventCapacityUnit.is_active.is_(True),
        )
        .order_by(
            EventCapacityUnit.sort_order,
            EventCapacityUnit.created_at,
            EventCapacityUnit.id,
        ),
    )
    return list(result)


async def list_active_event_categories(session: AsyncSession) -> list[EventCategory]:
    result = await session.scalars(
        select(EventCategory)
        .where(EventCategory.is_active.is_(True))
        .order_by(
            EventCategory.sort_order,
            EventCategory.created_at,
            EventCategory.id,
        ),
    )
    return list(result)
