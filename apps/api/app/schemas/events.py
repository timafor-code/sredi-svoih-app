from __future__ import annotations

from datetime import datetime
from typing import Any, Generic, TypeVar
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field

DataT = TypeVar("DataT")


class PaginationMeta(BaseModel):
    limit: int
    next_cursor: str | None
    has_more: bool


class ResponseMeta(BaseModel):
    request_id: UUID = Field(default_factory=uuid4)


class ListResponseMeta(ResponseMeta):
    pagination: PaginationMeta


class ApiResponse(BaseModel, Generic[DataT]):
    data: DataT
    error: None = None
    meta: ResponseMeta = Field(default_factory=ResponseMeta)


class PaginatedApiResponse(BaseModel, Generic[DataT]):
    data: list[DataT]
    error: None = None
    meta: ListResponseMeta


class EventCategoryResponse(BaseModel):
    id: UUID
    community_id: UUID
    slug: str
    title: str
    description: str | None
    color: str
    icon: str
    sort_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class EventResponse(BaseModel):
    id: UUID
    community_id: UUID
    event_kind: str
    title: str
    subtitle: str | None
    description: str | None
    short_description: str | None
    starts_at: datetime
    ends_at: datetime | None
    is_permanent: bool
    timezone: str | None
    location_name: str | None
    address: str | None
    latitude: float | None
    longitude: float | None
    image_url: str | None
    category: str
    audience: str | None
    visibility: str
    status: str
    source_url: str | None
    registration_mode: str
    registration_url: str | None
    capacity: int | None
    waitlist_enabled: bool
    requires_approval: bool
    price_amount: int | None
    price_currency: str | None
    published_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class EventOccurrenceResponse(BaseModel):
    id: UUID
    event_id: UUID
    title: str | None
    starts_at: datetime
    ends_at: datetime | None
    timezone: str
    registration_opens_at: datetime | None
    registration_closes_at: datetime | None
    capacity: int | None
    waitlist_enabled: bool | None
    requires_approval: bool | None
    status: str
    sort_order: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class EventParticipationOptionResponse(BaseModel):
    id: UUID
    event_id: UUID
    title: str
    description: str | None
    price_amount: int
    price_currency: str
    option_type: str
    seat_limit: int | None
    allow_quantity: bool
    min_quantity: int
    max_quantity: int
    is_donation: bool
    counts_toward_capacity: bool
    group_key: str | None
    conflicts_with: list[Any]
    sort_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class EventCapacityUnitResponse(BaseModel):
    id: UUID
    event_id: UUID
    key: str
    title: str
    description: str | None
    capacity: int | None
    sort_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
