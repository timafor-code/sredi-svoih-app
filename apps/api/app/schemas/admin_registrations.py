from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class AdminRegistrationSelectedOptionResponse(BaseModel):
    id: UUID
    option_id: UUID | None
    title: str
    description: str | None
    option_type: str
    quantity: int
    unit_price_amount: int
    total_amount: int
    currency: str
    counts_toward_capacity: bool
    seats_count: int
    is_donation: bool
    created_at: datetime


class AdminEventRegistrationResponse(BaseModel):
    id: UUID
    event_id: UUID
    occurrence_id: UUID | None
    user_id: UUID
    participant_display_name: str
    email: str | None
    phone: str | None
    status: str
    seats_count: int
    guest_names: list[object]
    comment: str | None
    payment_status: str
    payment_id: str | None
    registered_at: datetime
    confirmed_at: datetime | None
    cancelled_at: datetime | None
    occurrence_starts_at: datetime | None
    occurrence_ends_at: datetime | None
    occurrence_title: str | None
    selected_options: list[AdminRegistrationSelectedOptionResponse]
    total_amount: int | None
    created_at: datetime
    updated_at: datetime


class AdminRegistrationCapacityStatusCountsResponse(BaseModel):
    confirmed: int
    pending: int
    waitlisted: int
    cancelled: int
    rejected: int
    attended: int
    no_show: int


class AdminRegistrationCapacityOptionStatResponse(BaseModel):
    option_id: UUID | None
    title: str
    option_type: str
    registrations_count: int
    quantity: int
    seats_count: int
    is_donation: bool
    counts_toward_capacity: bool


class AdminRegistrationCapacityBucketOptionBreakdownResponse(BaseModel):
    option_id: UUID | None
    title: str
    registrations_count: int
    quantity: int
    seats_count: int
    is_donation: bool
    counts_toward_capacity: bool


class AdminRegistrationCapacityBucketResponse(BaseModel):
    capacity_unit_id: UUID
    key: str
    code: str
    title: str
    capacity: int | None
    effective_capacity: int | None
    occupied_seats: int
    remaining_seats: int | None
    free_seats: int | None
    effective_remaining_seats: int | None
    fill_percent: int | None
    effective_fill_percent: int | None
    effective_free_percent: int | None
    reservations_count: int
    option_titles: list[str]
    option_breakdown: list[AdminRegistrationCapacityBucketOptionBreakdownResponse]
    is_unlimited: bool
    uses_fallback_capacity: bool


class AdminRegistrationCapacityBucketAggregateResponse(BaseModel):
    occupied_seats: int
    known_capacity: int
    remaining_seats: int
    fill_percent: int | None
    free_percent: int | None
    limited_bucket_count: int
    has_unlimited_buckets: bool


class AdminRegistrationCapacityTotalsResponse(BaseModel):
    total_registrations: int
    total_registrations_count: int
    status_counts: AdminRegistrationCapacityStatusCountsResponse
    confirmed_count: int
    pending_count: int
    waitlisted_count: int
    cancelled_count: int
    rejected_count: int
    attended_count: int
    no_show_count: int
    active_registrations_count: int
    active_seats_count: int
    unique_registered_users_count: int
    unique_guests_count: int
    unique_people_count: int
    multi_meal_guests_count: int
    sponsors_donations_count: int
    donations_count: int
    donation_quantity: int
    donation_registrations_count: int
    capacity: int | None
    remaining_seats: int | None
    free_seats: int | None
    fill_percent: int | None
    free_percent: int | None


class AdminRegistrationCapacityAnalyticsResponse(BaseModel):
    event_id: UUID
    occurrence_id: UUID | None
    totals: AdminRegistrationCapacityTotalsResponse
    bucket_aggregate: AdminRegistrationCapacityBucketAggregateResponse
    buckets: list[AdminRegistrationCapacityBucketResponse]
    option_stats: list[AdminRegistrationCapacityOptionStatResponse]
    donation_options: list[AdminRegistrationCapacityOptionStatResponse]
