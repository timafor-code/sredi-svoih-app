from __future__ import annotations

import argparse
import asyncio
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID, uuid5

from sqlalchemy import select
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.models import (
    AppUser,
    Community,
    CommunityMembership,
    Event,
    EventCapacityUnit,
    EventCategory,
    EventOccurrence,
    EventParticipationOption,
    EventParticipationOptionCapacityUnit,
    EventRegistration,
    EventRegistrationCapacityReservation,
    EventRegistrationOptionSelection,
    Profile,
)
from app.db.session import AsyncSessionLocal, engine


LOCAL_APP_ENVS = {"local", "dev", "development", "test"}
LOCAL_DB_HOSTS = {"localhost", "127.0.0.1", "::1", "api_postgres"}
LOCAL_DB_NAMES = {"sredi_api"}
SEED_NAMESPACE = UUID("b09f7cb9-9b5e-48c4-bafd-c8a4a9d40c3a")

COMMUNITY_SLUG = "dev_synthetic_community"
CATEGORY_SLUG = "community"

JOINED_AT = datetime(2034, 1, 2, 9, 0, tzinfo=timezone.utc)
PUBLISHED_AT = datetime(2034, 12, 1, 9, 0, tzinfo=timezone.utc)


class SeedError(RuntimeError):
    pass


@dataclass(frozen=True)
class UserSpec:
    role: str
    email: str
    profile: dict[str, Any]


@dataclass
class SeedStats:
    created: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    existing: dict[str, int] = field(default_factory=lambda: defaultdict(int))

    def mark(self, label: str, was_created: bool) -> None:
        bucket = self.created if was_created else self.existing
        bucket[label] += 1


USER_SPECS = {
    "admin": UserSpec(
        role="admin",
        email="synthetic.admin@example.invalid",
        profile={
            "full_name": "Synthetic Admin User",
            "display_name": "Synthetic Admin",
            "first_name": "Synthetic",
            "last_name": "Admin",
            "city": "Synthetic City",
            "about": "Synthetic admin profile for local API development.",
        },
    ),
    "event_manager": UserSpec(
        role="event_manager",
        email="synthetic.event.manager@example.invalid",
        profile={
            "full_name": "Synthetic Event Manager User",
            "display_name": "Synthetic Event Manager",
            "first_name": "Synthetic",
            "last_name": "Event Manager",
            "city": "Synthetic City",
            "about": "Synthetic event manager profile for local API development.",
        },
    ),
    "member": UserSpec(
        role="member",
        email="synthetic.member@example.invalid",
        profile={
            "full_name": "Synthetic Member User",
            "display_name": "Synthetic Member",
            "first_name": "Synthetic",
            "last_name": "Member",
            "city": "Synthetic City",
            "about": "Synthetic member profile for local API development.",
        },
    ),
}


def seed_uuid(label: str) -> UUID:
    return uuid5(SEED_NAMESPACE, label)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Seed dev-only synthetic data into the local API database.",
    )
    parser.add_argument(
        "--admin-user-id",
        type=UUID,
        help="Optional local test UUID to use for the synthetic admin app user.",
    )
    parser.add_argument(
        "--event-manager-user-id",
        type=UUID,
        help=(
            "Optional local test UUID to use for the synthetic event manager "
            "app user."
        ),
    )
    parser.add_argument(
        "--member-user-id",
        type=UUID,
        help="Optional local test UUID to use for the synthetic member app user.",
    )
    return parser.parse_args()


def assert_local_dev_only() -> None:
    settings = get_settings()
    app_env = settings.app_env.strip().lower()
    if app_env not in LOCAL_APP_ENVS:
        raise SeedError(
            "Synthetic seeding is allowed only when APP_ENV is local/dev-like.",
        )

    url = make_url(settings.db_dsn)
    db_host = (url.host or "").lower()
    db_name = url.database or ""
    if db_host not in LOCAL_DB_HOSTS or db_name not in LOCAL_DB_NAMES:
        raise SeedError(
            "Synthetic seeding refused: the configured API database is not the "
            "known local development database.",
        )


async def first_or_none(session: AsyncSession, statement):
    result = await session.execute(statement)
    return result.scalars().first()


async def ensure_row(
    session: AsyncSession,
    stats: SeedStats,
    model,
    label: str,
    seed_id: UUID,
    values: dict[str, Any],
    key_statement=None,
):
    by_id = await session.get(model, seed_id)
    by_key = (
        await first_or_none(session, key_statement)
        if key_statement is not None
        else None
    )

    if by_id is not None and by_key is not None and by_id.id != by_key.id:
        raise SeedError(f"Conflicting existing rows found for synthetic {label}.")

    row = by_key or by_id
    was_created = row is None
    if was_created:
        row = model(id=seed_id, **values)
        session.add(row)
    else:
        for key, value in values.items():
            setattr(row, key, value)

    stats.mark(label, was_created)
    return row


async def ensure_community(session: AsyncSession, stats: SeedStats) -> Community:
    return await ensure_row(
        session,
        stats,
        Community,
        "community",
        seed_uuid("community"),
        {
            "name": "Synthetic Local Community",
            "city": "Synthetic City",
            "slug": COMMUNITY_SLUG,
            "country": "ZZ",
            "timezone": "Europe/Moscow",
            "logo_url": None,
            "website_url": None,
            "is_active": True,
        },
        select(Community).where(Community.slug == COMMUNITY_SLUG),
    )


async def ensure_user(
    session: AsyncSession,
    stats: SeedStats,
    spec: UserSpec,
    requested_id: UUID | None,
) -> AppUser:
    seed_id = requested_id or seed_uuid(f"app_user:{spec.role}")
    by_id = await session.get(AppUser, seed_id)
    by_email = await first_or_none(
        session,
        select(AppUser).where(AppUser.email == spec.email),
    )

    if by_id is not None and by_email is not None and by_id.id != by_email.id:
        raise SeedError(
            f"The requested UUID for synthetic {spec.role} already belongs to "
            "a different local app user.",
        )

    if requested_id is not None and by_email is not None and by_email.id != requested_id:
        raise SeedError(
            f"Synthetic {spec.role} already exists with another app user UUID. "
            "Use a fresh local API database for UUID-aligned smoke data.",
        )

    if by_id is not None and by_id.email != spec.email:
        raise SeedError(
            f"The requested UUID for synthetic {spec.role} is already in use.",
        )

    user = by_email or by_id
    was_created = user is None
    if was_created:
        user = AppUser(
            id=seed_id,
            email=spec.email,
            phone=None,
            password_hash=None,
            status="active",
            email_verified_at=None,
            phone_verified_at=None,
            last_login_at=None,
        )
        session.add(user)
    else:
        user.email = spec.email
        user.phone = None
        user.password_hash = None
        user.status = "active"

    stats.mark("app_user", was_created)
    return user


async def ensure_profile(
    session: AsyncSession,
    stats: SeedStats,
    community: Community,
    user: AppUser,
    spec: UserSpec,
) -> Profile:
    values = {
        "user_id": user.id,
        "community_id": community.id,
        "phone": None,
        "email": spec.email,
        "avatar_url": None,
        "birth_date": None,
        "hebrew_birth_date": None,
        "birth_time_context": "unknown",
        "nusach": "chabad",
        "tribe_status": None,
        "marital_status": None,
        "profile_visibility": "members",
        "birthday_visibility": "members",
        "phone_visibility": "rabbi_only",
        "notification_preferences": {},
        "onboarding_completed": True,
        **spec.profile,
    }
    return await ensure_row(
        session,
        stats,
        Profile,
        "profile",
        seed_uuid(f"profile:{spec.role}"),
        values,
        select(Profile).where(Profile.user_id == user.id),
    )


async def ensure_membership(
    session: AsyncSession,
    stats: SeedStats,
    community: Community,
    user: AppUser,
    spec: UserSpec,
    admin_user: AppUser | None,
) -> CommunityMembership:
    return await ensure_row(
        session,
        stats,
        CommunityMembership,
        "community_membership",
        seed_uuid(f"community_membership:{spec.role}"),
        {
            "community_id": community.id,
            "user_id": user.id,
            "role": spec.role,
            "status": "active",
            "invited_by": admin_user.id if admin_user and admin_user.id != user.id else None,
            "joined_at": JOINED_AT,
        },
        select(CommunityMembership).where(
            CommunityMembership.community_id == community.id,
            CommunityMembership.user_id == user.id,
        ),
    )


async def ensure_category(
    session: AsyncSession,
    stats: SeedStats,
    community: Community,
    event_manager: AppUser,
) -> EventCategory:
    return await ensure_row(
        session,
        stats,
        EventCategory,
        "event_category",
        seed_uuid("event_category:community"),
        {
            "community_id": community.id,
            "slug": CATEGORY_SLUG,
            "title": "Synthetic Community",
            "description": "Synthetic category for local API development.",
            "color": "#2E7D32",
            "icon": "*",
            "sort_order": 10,
            "is_active": True,
            "created_by": event_manager.id,
            "updated_by": event_manager.id,
        },
        select(EventCategory).where(
            EventCategory.community_id == community.id,
            EventCategory.slug == CATEGORY_SLUG,
        ),
    )


async def ensure_event(
    session: AsyncSession,
    stats: SeedStats,
    *,
    seed_key: str,
    community: Community,
    event_manager: AppUser,
    title: str,
    short_description: str,
    starts_at: datetime,
    ends_at: datetime,
    event_kind: str,
    visibility: str,
    capacity: int,
) -> Event:
    source_external_id = f"dev-synthetic-seed:{seed_key}"
    return await ensure_row(
        session,
        stats,
        Event,
        "event",
        seed_uuid(f"event:{seed_key}"),
        {
            "community_id": community.id,
            "event_kind": event_kind,
            "title": title,
            "subtitle": None,
            "description": f"{short_description} Seeded synthetic event.",
            "short_description": short_description,
            "starts_at": starts_at,
            "ends_at": ends_at,
            "is_permanent": False,
            "timezone": "Europe/Moscow",
            "location_name": "Synthetic Local Venue",
            "address": "Synthetic Local Address",
            "latitude": None,
            "longitude": None,
            "image_url": None,
            "category": CATEGORY_SLUG,
            "audience": "all",
            "visibility": visibility,
            "status": "published",
            "source_type": "manual",
            "source_url": None,
            "source_external_id": source_external_id,
            "manual_override": True,
            "registration_mode": "internal_free",
            "registration_url": None,
            "capacity": capacity,
            "waitlist_enabled": True,
            "requires_approval": False,
            "price_amount": None,
            "price_currency": "RUB",
            "created_by": event_manager.id,
            "updated_by": event_manager.id,
            "published_at": PUBLISHED_AT,
        },
        select(Event).where(
            Event.community_id == community.id,
            Event.source_type == "manual",
            Event.source_external_id == source_external_id,
        ),
    )


async def ensure_occurrence(
    session: AsyncSession,
    stats: SeedStats,
    event: Event,
    seed_key: str,
    title: str,
    starts_at: datetime,
    ends_at: datetime,
    capacity: int,
) -> EventOccurrence:
    return await ensure_row(
        session,
        stats,
        EventOccurrence,
        "event_occurrence",
        seed_uuid(f"event_occurrence:{seed_key}"),
        {
            "event_id": event.id,
            "title": title,
            "starts_at": starts_at,
            "ends_at": ends_at,
            "timezone": "Europe/Moscow",
            "registration_opens_at": starts_at - timedelta(days=30),
            "registration_closes_at": starts_at - timedelta(hours=2),
            "capacity": capacity,
            "waitlist_enabled": True,
            "requires_approval": False,
            "status": "active",
            "sort_order": 10,
        },
        select(EventOccurrence).where(
            EventOccurrence.event_id == event.id,
            EventOccurrence.title == title,
        ),
    )


async def ensure_option(
    session: AsyncSession,
    stats: SeedStats,
    event: Event,
    seed_key: str,
    *,
    title: str,
    option_type: str,
    seats_count: int,
    sort_order: int,
) -> EventParticipationOption:
    counts_toward_capacity = seats_count > 0
    return await ensure_row(
        session,
        stats,
        EventParticipationOption,
        "event_participation_option",
        seed_uuid(f"event_participation_option:{seed_key}"),
        {
            "event_id": event.id,
            "title": title,
            "description": "Synthetic option for local API development.",
            "price_amount": 0,
            "price_currency": "RUB",
            "option_type": option_type,
            "seat_limit": event.capacity if counts_toward_capacity else None,
            "allow_quantity": not counts_toward_capacity,
            "min_quantity": 1,
            "max_quantity": 4 if not counts_toward_capacity else 1,
            "is_donation": False,
            "counts_toward_capacity": counts_toward_capacity,
            "group_key": None,
            "conflicts_with": [],
            "sort_order": sort_order,
            "is_active": True,
        },
        select(EventParticipationOption).where(
            EventParticipationOption.event_id == event.id,
            EventParticipationOption.title == title,
        ),
    )


async def ensure_capacity_unit(
    session: AsyncSession,
    stats: SeedStats,
    event: Event,
    seed_key: str,
    capacity: int,
) -> EventCapacityUnit:
    return await ensure_row(
        session,
        stats,
        EventCapacityUnit,
        "event_capacity_unit",
        seed_uuid(f"event_capacity_unit:{seed_key}"),
        {
            "event_id": event.id,
            "key": "main_room",
            "title": "Synthetic Main Room",
            "description": "Synthetic capacity unit for local API development.",
            "capacity": capacity,
            "sort_order": 10,
            "is_active": True,
        },
        select(EventCapacityUnit).where(
            EventCapacityUnit.event_id == event.id,
            EventCapacityUnit.key == "main_room",
        ),
    )


async def ensure_option_capacity_unit(
    session: AsyncSession,
    stats: SeedStats,
    event: Event,
    option: EventParticipationOption,
    capacity_unit: EventCapacityUnit,
    seed_key: str,
) -> EventParticipationOptionCapacityUnit:
    return await ensure_row(
        session,
        stats,
        EventParticipationOptionCapacityUnit,
        "event_option_capacity_unit",
        seed_uuid(f"event_option_capacity_unit:{seed_key}"),
        {
            "event_id": event.id,
            "option_id": option.id,
            "capacity_unit_id": capacity_unit.id,
            "seats_per_quantity": 1,
        },
        select(EventParticipationOptionCapacityUnit).where(
            EventParticipationOptionCapacityUnit.option_id == option.id,
            EventParticipationOptionCapacityUnit.capacity_unit_id == capacity_unit.id,
        ),
    )


async def ensure_registration(
    session: AsyncSession,
    stats: SeedStats,
    *,
    seed_key: str,
    event: Event,
    user: AppUser,
    occurrence: EventOccurrence,
    status: str,
    registered_at: datetime,
    seats_count: int,
) -> EventRegistration:
    return await ensure_row(
        session,
        stats,
        EventRegistration,
        "event_registration",
        seed_uuid(f"event_registration:{seed_key}"),
        {
            "event_id": event.id,
            "user_id": user.id,
            "occurrence_id": occurrence.id,
            "status": status,
            "seats_count": seats_count,
            "guest_names": [],
            "comment": "Synthetic seed registration for local API testing.",
            "registered_at": registered_at,
            "confirmed_at": registered_at if status == "confirmed" else None,
            "cancelled_at": None,
            "payment_status": "not_required",
            "payment_id": None,
        },
        select(EventRegistration).where(
            EventRegistration.event_id == event.id,
            EventRegistration.user_id == user.id,
            EventRegistration.occurrence_id == occurrence.id,
        ),
    )


async def ensure_option_selection(
    session: AsyncSession,
    stats: SeedStats,
    *,
    seed_key: str,
    registration: EventRegistration,
    option: EventParticipationOption,
    quantity: int,
    seats_count: int,
) -> EventRegistrationOptionSelection:
    return await ensure_row(
        session,
        stats,
        EventRegistrationOptionSelection,
        "registration_option_selection",
        seed_uuid(f"registration_option_selection:{seed_key}"),
        {
            "registration_id": registration.id,
            "option_id": option.id,
            "title_snapshot": option.title,
            "description_snapshot": option.description,
            "option_type_snapshot": option.option_type,
            "quantity": quantity,
            "unit_price_amount": option.price_amount,
            "total_amount": option.price_amount * quantity,
            "currency": option.price_currency,
            "counts_toward_capacity": option.counts_toward_capacity,
            "seats_count": seats_count,
            "is_donation": option.is_donation,
        },
        select(EventRegistrationOptionSelection).where(
            EventRegistrationOptionSelection.registration_id == registration.id,
            EventRegistrationOptionSelection.option_id == option.id,
        ),
    )


async def ensure_capacity_reservation(
    session: AsyncSession,
    stats: SeedStats,
    *,
    seed_key: str,
    registration: EventRegistration,
    event: Event,
    occurrence: EventOccurrence,
    option: EventParticipationOption,
    capacity_unit: EventCapacityUnit,
    quantity: int,
) -> EventRegistrationCapacityReservation:
    return await ensure_row(
        session,
        stats,
        EventRegistrationCapacityReservation,
        "registration_capacity_reservation",
        seed_uuid(f"registration_capacity_reservation:{seed_key}"),
        {
            "registration_id": registration.id,
            "event_id": event.id,
            "occurrence_id": occurrence.id,
            "capacity_unit_id": capacity_unit.id,
            "option_id": option.id,
            "capacity_unit_key_snapshot": capacity_unit.key,
            "capacity_unit_title_snapshot": capacity_unit.title,
            "option_title_snapshot": option.title,
            "quantity": quantity,
            "seats_per_quantity": 1,
            "seats_count": quantity,
        },
        select(EventRegistrationCapacityReservation).where(
            EventRegistrationCapacityReservation.registration_id == registration.id,
            EventRegistrationCapacityReservation.capacity_unit_id == capacity_unit.id,
            EventRegistrationCapacityReservation.option_id == option.id,
        ),
    )


async def seed(args: argparse.Namespace) -> SeedStats:
    assert_local_dev_only()
    stats = SeedStats()

    requested_ids = {
        "admin": args.admin_user_id,
        "event_manager": args.event_manager_user_id,
        "member": args.member_user_id,
    }

    async with AsyncSessionLocal() as session:
        async with session.begin():
            community = await ensure_community(session, stats)

            users: dict[str, AppUser] = {}
            for role, spec in USER_SPECS.items():
                users[role] = await ensure_user(
                    session,
                    stats,
                    spec,
                    requested_ids[role],
                )
            await session.flush()

            for role, spec in USER_SPECS.items():
                await ensure_profile(session, stats, community, users[role], spec)
                await ensure_membership(
                    session,
                    stats,
                    community,
                    users[role],
                    spec,
                    users["admin"],
                )

            await ensure_category(session, stats, community, users["event_manager"])
            await session.flush()

            orientation_starts = datetime(2035, 1, 10, 15, 0, tzinfo=timezone.utc)
            orientation_ends = datetime(2035, 1, 10, 17, 0, tzinfo=timezone.utc)
            lab_starts = datetime(2035, 1, 17, 15, 0, tzinfo=timezone.utc)
            lab_ends = datetime(2035, 1, 17, 18, 0, tzinfo=timezone.utc)

            orientation = await ensure_event(
                session,
                stats,
                seed_key="orientation",
                community=community,
                event_manager=users["event_manager"],
                title="Synthetic Open Orientation",
                short_description="Synthetic public event for local testing.",
                starts_at=orientation_starts,
                ends_at=orientation_ends,
                event_kind="single",
                visibility="public",
                capacity=30,
            )
            lab = await ensure_event(
                session,
                stats,
                seed_key="members_lab",
                community=community,
                event_manager=users["event_manager"],
                title="Synthetic Members Lab",
                short_description="Synthetic members-only event for local testing.",
                starts_at=lab_starts,
                ends_at=lab_ends,
                event_kind="course",
                visibility="members_only",
                capacity=12,
            )
            await session.flush()

            orientation_occurrence = await ensure_occurrence(
                session,
                stats,
                orientation,
                "orientation",
                "Synthetic Orientation Session",
                orientation_starts,
                orientation_ends,
                30,
            )
            lab_occurrence = await ensure_occurrence(
                session,
                stats,
                lab,
                "members_lab",
                "Synthetic Lab Session",
                lab_starts,
                lab_ends,
                12,
            )

            orientation_seat = await ensure_option(
                session,
                stats,
                orientation,
                "orientation_seat",
                title="Synthetic Standard Seat",
                option_type="participation",
                seats_count=1,
                sort_order=10,
            )
            orientation_meal = await ensure_option(
                session,
                stats,
                orientation,
                "orientation_meal",
                title="Synthetic Boxed Meal",
                option_type="meal",
                seats_count=0,
                sort_order=20,
            )
            lab_seat = await ensure_option(
                session,
                stats,
                lab,
                "members_lab_seat",
                title="Synthetic Lab Seat",
                option_type="participation",
                seats_count=1,
                sort_order=10,
            )

            orientation_capacity = await ensure_capacity_unit(
                session,
                stats,
                orientation,
                "orientation",
                30,
            )
            lab_capacity = await ensure_capacity_unit(
                session,
                stats,
                lab,
                "members_lab",
                12,
            )
            await session.flush()

            await ensure_option_capacity_unit(
                session,
                stats,
                orientation,
                orientation_seat,
                orientation_capacity,
                "orientation_seat",
            )
            await ensure_option_capacity_unit(
                session,
                stats,
                lab,
                lab_seat,
                lab_capacity,
                "members_lab_seat",
            )

            orientation_registration = await ensure_registration(
                session,
                stats,
                seed_key="member_orientation",
                event=orientation,
                user=users["member"],
                occurrence=orientation_occurrence,
                status="confirmed",
                registered_at=orientation_starts - timedelta(days=12),
                seats_count=1,
            )
            lab_registration = await ensure_registration(
                session,
                stats,
                seed_key="member_lab",
                event=lab,
                user=users["member"],
                occurrence=lab_occurrence,
                status="pending",
                registered_at=lab_starts - timedelta(days=10),
                seats_count=1,
            )
            await session.flush()

            await ensure_option_selection(
                session,
                stats,
                seed_key="member_orientation_seat",
                registration=orientation_registration,
                option=orientation_seat,
                quantity=1,
                seats_count=1,
            )
            await ensure_option_selection(
                session,
                stats,
                seed_key="member_orientation_meal",
                registration=orientation_registration,
                option=orientation_meal,
                quantity=1,
                seats_count=0,
            )
            await ensure_option_selection(
                session,
                stats,
                seed_key="member_lab_seat",
                registration=lab_registration,
                option=lab_seat,
                quantity=1,
                seats_count=1,
            )
            await ensure_capacity_reservation(
                session,
                stats,
                seed_key="member_orientation_seat",
                registration=orientation_registration,
                event=orientation,
                occurrence=orientation_occurrence,
                option=orientation_seat,
                capacity_unit=orientation_capacity,
                quantity=1,
            )
            await ensure_capacity_reservation(
                session,
                stats,
                seed_key="member_lab_seat",
                registration=lab_registration,
                event=lab,
                occurrence=lab_occurrence,
                option=lab_seat,
                capacity_unit=lab_capacity,
                quantity=1,
            )

    return stats


def print_summary(stats: SeedStats, uuid_alignment_enabled: bool) -> None:
    print("Synthetic seed complete.")
    print(f"UUID alignment: {'enabled' if uuid_alignment_enabled else 'disabled'}")
    for label in sorted(set(stats.created) | set(stats.existing)):
        created = stats.created.get(label, 0)
        existing = stats.existing.get(label, 0)
        print(f"{label}: {created} created, {existing} existing")


async def async_main() -> None:
    args = parse_args()
    uuid_alignment_enabled = any(
        [
            args.admin_user_id,
            args.event_manager_user_id,
            args.member_user_id,
        ],
    )
    try:
        stats = await seed(args)
    finally:
        await engine.dispose()
    print_summary(stats, uuid_alignment_enabled)


def main() -> None:
    try:
        asyncio.run(async_main())
    except SeedError as exc:
        raise SystemExit(f"Refusing to run synthetic seed: {exc}") from exc


if __name__ == "__main__":
    main()
