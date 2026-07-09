from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    Numeric,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models.base import Base


def uuid_pk():
    return mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )


def timestamptz_now():
    return mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


class Community(Base):
    __tablename__ = "communities"
    __table_args__ = (
        Index(
            "communities_slug_key",
            "slug",
            unique=True,
            postgresql_where=text("slug IS NOT NULL"),
        ),
    )

    id: Mapped[UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(Text, nullable=False)
    city: Mapped[str] = mapped_column(Text, nullable=False)
    slug: Mapped[str | None] = mapped_column(Text)
    country: Mapped[str | None] = mapped_column(Text, server_default=text("'RU'"))
    timezone: Mapped[str | None] = mapped_column(
        Text,
        server_default=text("'Europe/Moscow'"),
    )
    logo_url: Mapped[str | None] = mapped_column(Text)
    website_url: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("true"),
    )
    created_at: Mapped[datetime] = timestamptz_now()


class CommunityEventLocation(Base):
    __tablename__ = "community_event_locations"
    __table_args__ = (
        CheckConstraint(
            "btrim(title) <> ''",
            name="community_event_locations_title_not_empty_check",
        ),
        CheckConstraint(
            "btrim(address) <> ''",
            name="community_event_locations_address_not_empty_check",
        ),
        Index("community_event_locations_community_id_idx", "community_id"),
        Index(
            "community_event_locations_active_sort_idx",
            "community_id",
            "is_active",
            text("is_default DESC"),
            "sort_order",
            "title",
        ),
        Index(
            "community_event_locations_one_default_idx",
            "community_id",
            unique=True,
            postgresql_where=text("is_default"),
        ),
    )

    id: Mapped[UUID] = uuid_pk()
    community_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("communities.id", ondelete="CASCADE"),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    address: Mapped[str] = mapped_column(Text, nullable=False)
    is_default: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("true"),
    )
    sort_order: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("100"),
    )
    created_at: Mapped[datetime] = timestamptz_now()
    updated_at: Mapped[datetime] = timestamptz_now()


class AppUser(Base):
    __tablename__ = "app_users"
    __table_args__ = (
        UniqueConstraint("phone", name="app_users_phone_key"),
        CheckConstraint("btrim(status) <> ''", name="app_users_status_not_empty"),
        Index(
            "app_users_email_lower_key",
            text("lower(email)"),
            unique=True,
            postgresql_where=text("email IS NOT NULL"),
        ),
    )

    id: Mapped[UUID] = uuid_pk()
    email: Mapped[str | None] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(Text)
    password_hash: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'active'"),
    )
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    phone_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = timestamptz_now()
    updated_at: Mapped[datetime] = timestamptz_now()


class Profile(Base):
    __tablename__ = "profiles"
    __table_args__ = (
        UniqueConstraint("user_id", name="profiles_user_id_key"),
        CheckConstraint(
            "tribe_status IS NULL OR tribe_status IN ('kohen', 'levi', 'israel')",
            name="profiles_tribe_status_check",
        ),
        CheckConstraint(
            (
                "marital_status IS NULL OR marital_status IN "
                "('single', 'married', 'divorced', 'widowed', 'other')"
            ),
            name="profiles_marital_status_check",
        ),
        CheckConstraint(
            "about IS NULL OR char_length(about) <= 200",
            name="profiles_about_length_check",
        ),
        CheckConstraint(
            "profile_visibility IN ('rabbi_only', 'members', 'public')",
            name="profiles_profile_visibility_check",
        ),
        CheckConstraint(
            "birthday_visibility IN ('rabbi_only', 'members', 'public')",
            name="profiles_birthday_visibility_check",
        ),
        CheckConstraint(
            "phone_visibility IN ('rabbi_only', 'members', 'public')",
            name="profiles_phone_visibility_check",
        ),
        CheckConstraint(
            "birth_time_context IN ('before_sunset', 'after_sunset', 'unknown')",
            name="profiles_birth_time_context_check",
        ),
        Index("profiles_user_id_idx", "user_id"),
        Index("profiles_community_id_idx", "community_id"),
    )

    id: Mapped[UUID] = uuid_pk()
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("app_users.id", ondelete="CASCADE"),
        nullable=False,
    )
    community_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("communities.id", ondelete="SET NULL"),
    )
    full_name: Mapped[str | None] = mapped_column(Text)
    hebrew_name: Mapped[str | None] = mapped_column(Text)
    display_name: Mapped[str | None] = mapped_column(Text)
    first_name: Mapped[str | None] = mapped_column(Text)
    last_name: Mapped[str | None] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(Text)
    email: Mapped[str | None] = mapped_column(Text)
    avatar_url: Mapped[str | None] = mapped_column(Text)
    birth_date: Mapped[date | None] = mapped_column(Date)
    hebrew_birth_date: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    birth_time_context: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'unknown'"),
    )
    nusach: Mapped[str | None] = mapped_column(Text, server_default=text("'chabad'"))
    city: Mapped[str | None] = mapped_column(Text)
    tribe_status: Mapped[str | None] = mapped_column(Text)
    marital_status: Mapped[str | None] = mapped_column(Text)
    about: Mapped[str | None] = mapped_column(Text)
    profile_visibility: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'members'"),
    )
    birthday_visibility: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'members'"),
    )
    phone_visibility: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'rabbi_only'"),
    )
    notification_preferences: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'{}'::jsonb"),
    )
    onboarding_completed: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )
    created_at: Mapped[datetime] = timestamptz_now()
    updated_at: Mapped[datetime] = timestamptz_now()


class CommunityMembership(Base):
    __tablename__ = "community_memberships"
    __table_args__ = (
        CheckConstraint(
            "role IN ('member', 'rabbi', 'event_manager', 'admin')",
            name="community_memberships_role_check",
        ),
        CheckConstraint(
            "status IN ('pending', 'active', 'suspended', 'left')",
            name="community_memberships_status_check",
        ),
        UniqueConstraint(
            "community_id",
            "user_id",
            name="community_memberships_unique_user_community",
        ),
        Index("community_memberships_user_id_idx", "user_id"),
        Index("community_memberships_community_id_idx", "community_id"),
    )

    id: Mapped[UUID] = uuid_pk()
    community_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("communities.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("app_users.id", ondelete="CASCADE"),
        nullable=False,
    )
    role: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'member'"),
    )
    status: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'pending'"),
    )
    invited_by: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("app_users.id", ondelete="SET NULL"),
    )
    joined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = timestamptz_now()


class Invite(Base):
    __tablename__ = "invites"
    __table_args__ = (
        CheckConstraint(
            "role IN ('member', 'rabbi', 'event_manager', 'admin')",
            name="invites_role_check",
        ),
        CheckConstraint(
            "status IN ('active', 'used', 'expired', 'revoked')",
            name="invites_status_check",
        ),
        CheckConstraint(
            "max_uses > 0 AND used_count >= 0 AND used_count <= max_uses",
            name="invites_usage_check",
        ),
        UniqueConstraint("code_hash", name="invites_code_hash_key"),
        Index("invites_community_id_idx", "community_id"),
    )

    id: Mapped[UUID] = uuid_pk()
    community_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("communities.id", ondelete="CASCADE"),
        nullable=False,
    )
    code_hash: Mapped[str] = mapped_column(Text, nullable=False)
    email: Mapped[str | None] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(Text)
    role: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'member'"),
    )
    max_uses: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("1"),
    )
    used_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("0"),
    )
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("app_users.id", ondelete="SET NULL"),
    )
    accepted_by: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("app_users.id", ondelete="SET NULL"),
    )
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'active'"),
    )
    created_at: Mapped[datetime] = timestamptz_now()


class EventCategory(Base):
    __tablename__ = "event_categories"
    __table_args__ = (
        CheckConstraint(
            "slug ~ '^[a-z0-9][a-z0-9_]{1,63}$'",
            name="event_categories_slug_format_check",
        ),
        CheckConstraint(
            "color ~ '^#[0-9a-fA-F]{6}$'",
            name="event_categories_color_format_check",
        ),
        CheckConstraint(
            "btrim(title) <> ''",
            name="event_categories_title_not_empty_check",
        ),
        CheckConstraint(
            "btrim(icon) <> ''",
            name="event_categories_icon_not_empty_check",
        ),
        UniqueConstraint(
            "community_id",
            "slug",
            name="event_categories_unique_slug_per_community",
        ),
        Index("event_categories_community_id_idx", "community_id"),
        Index(
            "event_categories_active_sort_idx",
            "community_id",
            "is_active",
            "sort_order",
        ),
    )

    id: Mapped[UUID] = uuid_pk()
    community_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("communities.id", ondelete="CASCADE"),
        nullable=False,
    )
    slug: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    color: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'#7B68EE'"),
    )
    icon: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'*'"))
    sort_order: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("100"),
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("true"),
    )
    created_by: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("app_users.id", ondelete="SET NULL"),
    )
    updated_by: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("app_users.id", ondelete="SET NULL"),
    )
    created_at: Mapped[datetime] = timestamptz_now()
    updated_at: Mapped[datetime] = timestamptz_now()


class Event(Base):
    __tablename__ = "events"
    __table_args__ = (
        ForeignKeyConstraint(
            ["community_id", "category"],
            ["event_categories.community_id", "event_categories.slug"],
            name="events_category_event_categories_fkey",
            onupdate="CASCADE",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            (
                "event_kind IN ('single', 'course', 'sunday_school', 'shabbat', "
                "'holiday', 'announcement')"
            ),
            name="events_event_kind_check",
        ),
        CheckConstraint(
            "visibility IN ('public', 'members_only', 'hidden')",
            name="events_visibility_check",
        ),
        CheckConstraint(
            "status IN ('draft', 'published', 'cancelled', 'archived')",
            name="events_status_check",
        ),
        CheckConstraint(
            "source_type IN ('manual', 'website_scrape')",
            name="events_source_type_check",
        ),
        CheckConstraint(
            (
                "registration_mode IN "
                "('none', 'external_link', 'internal_free', 'internal_paid')"
            ),
            name="events_registration_mode_check",
        ),
        CheckConstraint("capacity IS NULL OR capacity > 0", name="events_capacity_check"),
        CheckConstraint(
            "price_amount IS NULL OR price_amount >= 0",
            name="events_price_amount_check",
        ),
        CheckConstraint(
            "price_currency IS NULL OR btrim(price_currency) <> ''",
            name="events_price_currency_check",
        ),
        CheckConstraint(
            "ends_at IS NULL OR ends_at > starts_at",
            name="events_ends_at_check",
        ),
        Index("events_community_id_idx", "community_id"),
        Index(
            "events_status_visibility_starts_at_idx",
            "status",
            "visibility",
            "starts_at",
        ),
        Index(
            "events_source_external_id_idx",
            "source_type",
            "source_external_id",
            postgresql_where=text("source_external_id IS NOT NULL"),
        ),
        Index("events_community_id_category_idx", "community_id", "category"),
    )

    id: Mapped[UUID] = uuid_pk()
    community_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("communities.id", ondelete="CASCADE"),
        nullable=False,
    )
    event_kind: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'single'"),
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    subtitle: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    short_description: Mapped[str | None] = mapped_column(Text)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_permanent: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )
    timezone: Mapped[str | None] = mapped_column(
        Text,
        server_default=text("'Europe/Moscow'"),
    )
    location_name: Mapped[str | None] = mapped_column(Text)
    address: Mapped[str | None] = mapped_column(Text)
    latitude: Mapped[Decimal | None] = mapped_column(Numeric(10, 7))
    longitude: Mapped[Decimal | None] = mapped_column(Numeric(10, 7))
    image_url: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'community'"),
    )
    audience: Mapped[str | None] = mapped_column(Text, server_default=text("'all'"))
    visibility: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'public'"),
    )
    status: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'published'"),
    )
    source_type: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'manual'"),
    )
    source_url: Mapped[str | None] = mapped_column(Text)
    source_external_id: Mapped[str | None] = mapped_column(Text)
    manual_override: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )
    registration_mode: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'none'"),
    )
    registration_url: Mapped[str | None] = mapped_column(Text)
    capacity: Mapped[int | None] = mapped_column(Integer)
    waitlist_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )
    requires_approval: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )
    price_amount: Mapped[int | None] = mapped_column(Integer)
    price_currency: Mapped[str | None] = mapped_column(Text, server_default=text("'RUB'"))
    created_by: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("app_users.id", ondelete="SET NULL"),
    )
    updated_by: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("app_users.id", ondelete="SET NULL"),
    )
    created_at: Mapped[datetime] = timestamptz_now()
    updated_at: Mapped[datetime] = timestamptz_now()
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class EventOccurrence(Base):
    __tablename__ = "event_occurrences"
    __table_args__ = (
        CheckConstraint(
            "status IN ('active', 'hidden', 'cancelled', 'archived')",
            name="event_occurrences_status_check",
        ),
        CheckConstraint(
            "capacity IS NULL OR capacity > 0",
            name="event_occurrences_capacity_check",
        ),
        CheckConstraint(
            "ends_at IS NULL OR ends_at > starts_at",
            name="event_occurrences_ends_at_check",
        ),
        CheckConstraint(
            (
                "registration_closes_at IS NULL OR registration_opens_at IS NULL "
                "OR registration_closes_at > registration_opens_at"
            ),
            name="event_occurrences_registration_window_check",
        ),
        Index("event_occurrences_event_id_idx", "event_id"),
        Index("event_occurrences_event_starts_at_idx", "event_id", "starts_at"),
        Index("event_occurrences_status_starts_at_idx", "status", "starts_at"),
    )

    id: Mapped[UUID] = uuid_pk()
    event_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("events.id", ondelete="CASCADE"),
        nullable=False,
    )
    title: Mapped[str | None] = mapped_column(Text)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    timezone: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'Europe/Moscow'"),
    )
    registration_opens_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    registration_closes_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
    )
    capacity: Mapped[int | None] = mapped_column(Integer)
    waitlist_enabled: Mapped[bool | None] = mapped_column(Boolean)
    requires_approval: Mapped[bool | None] = mapped_column(Boolean)
    status: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'active'"),
    )
    sort_order: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("0"),
    )
    created_at: Mapped[datetime] = timestamptz_now()
    updated_at: Mapped[datetime] = timestamptz_now()


class EventParticipationOption(Base):
    __tablename__ = "event_participation_options"
    __table_args__ = (
        UniqueConstraint(
            "id",
            "event_id",
            name="event_participation_options_id_event_id_unique",
        ),
        CheckConstraint(
            "price_amount >= 0",
            name="event_participation_options_price_amount_check",
        ),
        CheckConstraint(
            "btrim(price_currency) <> ''",
            name="event_participation_options_price_currency_check",
        ),
        CheckConstraint(
            (
                "option_type IN ('participation', 'meal', 'package', 'donation', "
                "'child', 'family', 'other')"
            ),
            name="event_participation_options_option_type_check",
        ),
        CheckConstraint(
            "seat_limit IS NULL OR seat_limit > 0",
            name="event_participation_options_seat_limit_check",
        ),
        CheckConstraint(
            "min_quantity >= 1",
            name="event_participation_options_min_quantity_check",
        ),
        CheckConstraint(
            "max_quantity >= min_quantity",
            name="event_participation_options_max_quantity_check",
        ),
        CheckConstraint(
            "allow_quantity = true OR (min_quantity = 1 AND max_quantity = 1)",
            name="event_participation_options_allow_quantity_check",
        ),
        CheckConstraint(
            "jsonb_typeof(conflicts_with) = 'array'",
            name="event_participation_options_conflicts_with_array_check",
        ),
        Index("event_participation_options_event_id_idx", "event_id"),
        Index(
            "event_participation_options_active_sort_idx",
            "event_id",
            "is_active",
            "sort_order",
        ),
    )

    id: Mapped[UUID] = uuid_pk()
    event_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("events.id", ondelete="CASCADE"),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    price_amount: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("0"),
    )
    price_currency: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'RUB'"),
    )
    option_type: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'participation'"),
    )
    seat_limit: Mapped[int | None] = mapped_column(Integer)
    allow_quantity: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )
    min_quantity: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("1"),
    )
    max_quantity: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("1"),
    )
    is_donation: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )
    counts_toward_capacity: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("true"),
    )
    group_key: Mapped[str | None] = mapped_column(Text)
    conflicts_with: Mapped[list[Any]] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'[]'::jsonb"),
    )
    sort_order: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("0"),
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("true"),
    )
    created_at: Mapped[datetime] = timestamptz_now()
    updated_at: Mapped[datetime] = timestamptz_now()


class EventCapacityUnit(Base):
    __tablename__ = "event_capacity_units"
    __table_args__ = (
        UniqueConstraint("event_id", "key", name="event_capacity_units_event_key_unique"),
        UniqueConstraint("id", "event_id", name="event_capacity_units_id_event_id_unique"),
        CheckConstraint("btrim(key) <> ''", name="event_capacity_units_key_not_empty"),
        CheckConstraint("btrim(title) <> ''", name="event_capacity_units_title_not_empty"),
        CheckConstraint(
            "capacity IS NULL OR capacity > 0",
            name="event_capacity_units_capacity_check",
        ),
        Index(
            "event_capacity_units_event_active_sort_idx",
            "event_id",
            "is_active",
            "sort_order",
        ),
    )

    id: Mapped[UUID] = uuid_pk()
    event_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("events.id", ondelete="CASCADE"),
        nullable=False,
    )
    key: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    capacity: Mapped[int | None] = mapped_column(Integer)
    sort_order: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("0"),
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("true"),
    )
    created_at: Mapped[datetime] = timestamptz_now()
    updated_at: Mapped[datetime] = timestamptz_now()


class EventParticipationOptionCapacityUnit(Base):
    __tablename__ = "event_participation_option_capacity_units"
    __table_args__ = (
        ForeignKeyConstraint(
            ["option_id", "event_id"],
            ["event_participation_options.id", "event_participation_options.event_id"],
            name="event_option_capacity_units_option_event_fkey",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["capacity_unit_id", "event_id"],
            ["event_capacity_units.id", "event_capacity_units.event_id"],
            name="event_option_capacity_units_unit_event_fkey",
            ondelete="CASCADE",
        ),
        UniqueConstraint(
            "option_id",
            "capacity_unit_id",
            name="event_option_capacity_units_option_unit_unique",
        ),
        CheckConstraint(
            "seats_per_quantity > 0",
            name="event_option_capacity_units_seats_per_quantity_check",
        ),
        Index("event_option_capacity_units_event_id_idx", "event_id"),
        Index("event_option_capacity_units_option_id_idx", "option_id"),
        Index(
            "event_option_capacity_units_capacity_unit_id_idx",
            "capacity_unit_id",
        ),
    )

    id: Mapped[UUID] = uuid_pk()
    event_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("events.id", ondelete="CASCADE"),
        nullable=False,
    )
    option_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    capacity_unit_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    seats_per_quantity: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("1"),
    )
    created_at: Mapped[datetime] = timestamptz_now()


class EventRegistration(Base):
    __tablename__ = "event_registrations"
    __table_args__ = (
        CheckConstraint(
            (
                "status IN ('pending', 'confirmed', 'waitlisted', 'cancelled', "
                "'rejected', 'attended', 'no_show')"
            ),
            name="event_registrations_status_check",
        ),
        CheckConstraint("seats_count > 0", name="event_registrations_seats_count_check"),
        CheckConstraint(
            (
                "payment_status IN ('not_required', 'pending', 'succeeded', "
                "'failed', 'cancelled', 'refunded', 'paid')"
            ),
            name="event_registrations_payment_status_check",
        ),
        Index("event_registrations_event_id_idx", "event_id"),
        Index("event_registrations_user_id_idx", "user_id"),
        Index("event_registrations_status_idx", "status"),
        Index("event_registrations_occurrence_id_idx", "occurrence_id"),
    )

    id: Mapped[UUID] = uuid_pk()
    event_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("events.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("app_users.id", ondelete="CASCADE"),
        nullable=False,
    )
    occurrence_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("event_occurrences.id", ondelete="SET NULL"),
    )
    status: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'pending'"),
    )
    seats_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("1"),
    )
    guest_names: Mapped[list[Any]] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'[]'::jsonb"),
    )
    comment: Mapped[str | None] = mapped_column(Text)
    registered_at: Mapped[datetime] = timestamptz_now()
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    payment_status: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'not_required'"),
    )
    payment_id: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = timestamptz_now()
    updated_at: Mapped[datetime] = timestamptz_now()


class EventRegistrationOptionSelection(Base):
    __tablename__ = "event_registration_option_selections"
    __table_args__ = (
        CheckConstraint(
            "quantity > 0",
            name="event_registration_option_selections_quantity_check",
        ),
        CheckConstraint(
            "unit_price_amount >= 0",
            name="event_registration_option_selections_unit_price_amount_check",
        ),
        CheckConstraint(
            "total_amount >= 0",
            name="event_registration_option_selections_total_amount_check",
        ),
        CheckConstraint(
            "btrim(currency) <> ''",
            name="event_registration_option_selections_currency_check",
        ),
        CheckConstraint(
            "seats_count >= 0",
            name="event_registration_option_selections_seats_count_check",
        ),
        Index(
            "event_registration_option_selections_registration_id_idx",
            "registration_id",
        ),
        Index("event_registration_option_selections_option_id_idx", "option_id"),
    )

    id: Mapped[UUID] = uuid_pk()
    registration_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("event_registrations.id", ondelete="CASCADE"),
        nullable=False,
    )
    option_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("event_participation_options.id", ondelete="SET NULL"),
    )
    title_snapshot: Mapped[str] = mapped_column(Text, nullable=False)
    description_snapshot: Mapped[str | None] = mapped_column(Text)
    option_type_snapshot: Mapped[str] = mapped_column(Text, nullable=False)
    quantity: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("1"),
    )
    unit_price_amount: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("0"),
    )
    total_amount: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("0"),
    )
    currency: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'RUB'"),
    )
    counts_toward_capacity: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("true"),
    )
    seats_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("0"),
    )
    is_donation: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )
    created_at: Mapped[datetime] = timestamptz_now()


class EventRegistrationCapacityReservation(Base):
    __tablename__ = "event_registration_capacity_reservations"
    __table_args__ = (
        CheckConstraint(
            "quantity > 0",
            name="event_registration_capacity_reservations_quantity_check",
        ),
        CheckConstraint(
            "seats_per_quantity > 0",
            name="event_reg_capacity_reservations_seats_per_qty_check",
        ),
        CheckConstraint(
            "seats_count > 0",
            name="event_registration_capacity_reservations_seats_count_check",
        ),
        CheckConstraint(
            "btrim(capacity_unit_key_snapshot) <> ''",
            name="event_registration_capacity_reservations_unit_key_not_empty",
        ),
        CheckConstraint(
            "btrim(capacity_unit_title_snapshot) <> ''",
            name="event_registration_capacity_reservations_unit_title_not_empty",
        ),
        Index(
            "event_registration_capacity_reservations_registration_id_idx",
            "registration_id",
        ),
        Index(
            "event_registration_capacity_reservations_event_occurrence_idx",
            "event_id",
            "occurrence_id",
        ),
        Index(
            "event_registration_capacity_reservations_capacity_unit_idx",
            "capacity_unit_id",
        ),
        Index(
            "event_reg_capacity_reservations_event_unit_occ_idx",
            "event_id",
            "capacity_unit_id",
            "occurrence_id",
        ),
    )

    id: Mapped[UUID] = uuid_pk()
    registration_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("event_registrations.id", ondelete="CASCADE"),
        nullable=False,
    )
    event_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("events.id", ondelete="CASCADE"),
        nullable=False,
    )
    occurrence_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("event_occurrences.id", ondelete="CASCADE"),
    )
    capacity_unit_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("event_capacity_units.id", ondelete="RESTRICT"),
        nullable=False,
    )
    option_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("event_participation_options.id", ondelete="SET NULL"),
    )
    capacity_unit_key_snapshot: Mapped[str] = mapped_column(Text, nullable=False)
    capacity_unit_title_snapshot: Mapped[str] = mapped_column(Text, nullable=False)
    option_title_snapshot: Mapped[str | None] = mapped_column(Text)
    quantity: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("1"),
    )
    seats_per_quantity: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("1"),
    )
    seats_count: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = timestamptz_now()


class AdminFeedback(Base):
    __tablename__ = "admin_feedback"
    __table_args__ = (
        CheckConstraint(
            "severity IN ('note', 'issue', 'blocker', 'idea')",
            name="admin_feedback_severity_check",
        ),
        CheckConstraint(
            "status IN ('open', 'reviewed', 'resolved', 'closed')",
            name="admin_feedback_status_check",
        ),
        CheckConstraint(
            "btrim(section) <> ''",
            name="admin_feedback_section_not_blank_check",
        ),
        CheckConstraint(
            "btrim(message) <> ''",
            name="admin_feedback_message_not_blank_check",
        ),
        CheckConstraint(
            "char_length(section) <= 80",
            name="admin_feedback_section_length_check",
        ),
        CheckConstraint(
            "entity_type IS NULL OR char_length(entity_type) <= 80",
            name="admin_feedback_entity_type_length_check",
        ),
        CheckConstraint(
            "char_length(message) <= 4000",
            name="admin_feedback_message_length_check",
        ),
        CheckConstraint(
            "user_agent IS NULL OR char_length(user_agent) <= 500",
            name="admin_feedback_user_agent_length_check",
        ),
        CheckConstraint(
            "url IS NULL OR char_length(url) <= 1000",
            name="admin_feedback_url_length_check",
        ),
        Index(
            "admin_feedback_community_created_idx",
            "community_id",
            text("created_at DESC"),
        ),
        Index("admin_feedback_status_created_idx", "status", text("created_at DESC")),
        Index("admin_feedback_user_created_idx", "user_id", text("created_at DESC")),
    )

    id: Mapped[UUID] = uuid_pk()
    community_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("communities.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("app_users.id", ondelete="CASCADE"),
        nullable=False,
    )
    section: Mapped[str] = mapped_column(Text, nullable=False)
    entity_type: Mapped[str | None] = mapped_column(Text)
    entity_id: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True))
    severity: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'note'"),
    )
    message: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'open'"),
    )
    user_agent: Mapped[str | None] = mapped_column(Text)
    url: Mapped[str | None] = mapped_column(Text)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_by: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("app_users.id", ondelete="SET NULL"),
    )
    created_at: Mapped[datetime] = timestamptz_now()
    updated_at: Mapped[datetime] = timestamptz_now()


class CommunityContact(Base):
    __tablename__ = "community_contacts"
    __table_args__ = (
        CheckConstraint(
            "btrim(full_name) <> ''",
            name="community_contacts_full_name_not_empty_check",
        ),
        Index("community_contacts_community_id_idx", "community_id"),
    )

    id: Mapped[UUID] = uuid_pk()
    community_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("communities.id", ondelete="CASCADE"),
        nullable=False,
    )
    full_name: Mapped[str] = mapped_column(Text, nullable=False)
    hebrew_name: Mapped[str | None] = mapped_column(Text)
    role: Mapped[str | None] = mapped_column(Text)
    city: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = timestamptz_now()


class DeviceToken(Base):
    __tablename__ = "device_tokens"
    __table_args__ = (
        CheckConstraint(
            "platform IN ('ios', 'android', 'web', 'unknown')",
            name="device_tokens_platform_check",
        ),
        CheckConstraint(
            "push_provider IN ('expo')",
            name="device_tokens_push_provider_check",
        ),
        CheckConstraint(
            "environment IN ('development', 'preview', 'production', 'unknown')",
            name="device_tokens_environment_check",
        ),
        CheckConstraint(
            "btrim(expo_push_token) <> ''",
            name="device_tokens_expo_push_token_not_empty_check",
        ),
        UniqueConstraint(
            "user_id",
            "expo_push_token",
            name="device_tokens_user_expo_push_token_key",
        ),
        Index("device_tokens_user_id_idx", "user_id"),
        Index(
            "device_tokens_active_user_idx",
            "user_id",
            postgresql_where=text("is_active = true"),
        ),
    )

    id: Mapped[UUID] = uuid_pk()
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("app_users.id", ondelete="CASCADE"),
        nullable=False,
    )
    platform: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'unknown'"),
    )
    push_provider: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'expo'"),
    )
    expo_push_token: Mapped[str] = mapped_column(Text, nullable=False)
    device_id: Mapped[str | None] = mapped_column(Text)
    app_version: Mapped[str | None] = mapped_column(Text)
    build_version: Mapped[str | None] = mapped_column(Text)
    environment: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'development'"),
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("true"),
    )
    last_seen_at: Mapped[datetime] = timestamptz_now()
    created_at: Mapped[datetime] = timestamptz_now()
    updated_at: Mapped[datetime] = timestamptz_now()


class PrayerActivityLog(Base):
    __tablename__ = "prayer_activity_logs"
    __table_args__ = (
        CheckConstraint(
            (
                "activity_type IN ('shacharit', 'mincha', 'maariv', "
                "'shema_morning', 'shema_evening', 'omer_count')"
            ),
            name="prayer_activity_logs_activity_type_check",
        ),
        CheckConstraint(
            "started_at IS NOT NULL OR completed_at IS NOT NULL",
            name="prayer_activity_logs_has_activity_timestamp_check",
        ),
        UniqueConstraint(
            "user_id",
            "activity_date",
            "activity_type",
            name="prayer_activity_logs_user_date_type_key",
        ),
        Index(
            "prayer_activity_logs_user_activity_date_idx",
            "user_id",
            text("activity_date DESC"),
        ),
        Index("prayer_activity_logs_activity_type_idx", "activity_type"),
    )

    id: Mapped[UUID] = uuid_pk()
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("app_users.id", ondelete="CASCADE"),
        nullable=False,
    )
    activity_type: Mapped[str] = mapped_column(Text, nullable=False)
    activity_date: Mapped[date] = mapped_column(Date, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    timezone: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'Europe/Moscow'"),
    )
    city: Mapped[str | None] = mapped_column(Text)
    hebrew_date: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'{}'::jsonb"),
    )
    metadata_json: Mapped[dict[str, Any]] = mapped_column(
        "metadata",
        JSONB,
        nullable=False,
        server_default=text("'{}'::jsonb"),
    )
    created_at: Mapped[datetime] = timestamptz_now()
    updated_at: Mapped[datetime] = timestamptz_now()


class ProfileContactVisibility(Base):
    __tablename__ = "profile_contact_visibility"
    __table_args__ = (
        Index(
            "profile_contact_visibility_directory_user_idx",
            "user_id",
            postgresql_where=text("show_in_community_directory = true"),
        ),
    )

    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("app_users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    show_in_community_directory: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )
    share_phone: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )
    share_email: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )
    share_birth_date: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )
    share_hebrew_birth_date: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )
    share_city: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )
    share_hebrew_name: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )
    birthday_reminders_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )
    created_at: Mapped[datetime] = timestamptz_now()
    updated_at: Mapped[datetime] = timestamptz_now()


class SyncedContact(Base):
    __tablename__ = "synced_contacts"
    __table_args__ = (Index("synced_contacts_user_id_idx", "user_id"),)

    id: Mapped[UUID] = uuid_pk()
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("app_users.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str | None] = mapped_column(Text)
    phone_hash: Mapped[str | None] = mapped_column(Text)
    email_hash: Mapped[str | None] = mapped_column(Text)
    birthday: Mapped[date | None] = mapped_column(Date)
    consented_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = timestamptz_now()


class PushNotificationJob(Base):
    __tablename__ = "push_notification_jobs"
    __table_args__ = (
        CheckConstraint(
            (
                "notification_kind IN ('event_created', 'event_updated', "
                "'event_cancelled', 'registration_confirmed', "
                "'registration_rejected', 'waitlist_available', 'news', 'manual')"
            ),
            name="push_notification_jobs_notification_kind_check",
        ),
        CheckConstraint(
            (
                "audience IN ('event_registrants', 'community_members', "
                "'single_user', 'manual_tokens')"
            ),
            name="push_notification_jobs_audience_check",
        ),
        CheckConstraint(
            (
                "status IN ('queued', 'processing', 'sent', 'partially_sent', "
                "'failed', 'cancelled')"
            ),
            name="push_notification_jobs_status_check",
        ),
        Index(
            "push_notification_jobs_community_created_at_idx",
            "community_id",
            text("created_at DESC"),
        ),
        Index("push_notification_jobs_event_id_idx", "event_id"),
        Index("push_notification_jobs_status_queued_at_idx", "status", "queued_at"),
        Index("push_notification_jobs_created_by_idx", "created_by"),
        Index(
            "push_notification_jobs_target_user_id_idx",
            "target_user_id",
            postgresql_where=text("target_user_id IS NOT NULL"),
        ),
    )

    id: Mapped[UUID] = uuid_pk()
    community_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("communities.id", ondelete="CASCADE"),
    )
    created_by: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("app_users.id", ondelete="SET NULL"),
    )
    notification_kind: Mapped[str] = mapped_column(Text, nullable=False)
    audience: Mapped[str] = mapped_column(Text, nullable=False)
    event_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("events.id", ondelete="CASCADE"),
    )
    occurrence_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("event_occurrences.id", ondelete="SET NULL"),
    )
    registration_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("event_registrations.id", ondelete="CASCADE"),
    )
    target_user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("app_users.id", ondelete="CASCADE"),
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    data: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'{}'::jsonb"),
    )
    status: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'queued'"),
    )
    queued_at: Mapped[datetime] = timestamptz_now()
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = timestamptz_now()
    updated_at: Mapped[datetime] = timestamptz_now()


class PushNotificationDelivery(Base):
    __tablename__ = "push_notification_deliveries"
    __table_args__ = (
        CheckConstraint(
            "status IN ('queued', 'sent', 'failed', 'skipped', 'receipt_checked')",
            name="push_notification_deliveries_status_check",
        ),
        Index("push_notification_deliveries_job_id_idx", "job_id"),
        Index(
            "push_notification_deliveries_status_created_at_idx",
            "status",
            "created_at",
        ),
        Index("push_notification_deliveries_user_id_idx", "user_id"),
        Index(
            "push_notification_deliveries_device_token_id_idx",
            "device_token_id",
            postgresql_where=text("device_token_id IS NOT NULL"),
        ),
        Index(
            "push_notification_deliveries_job_device_token_key",
            "job_id",
            "device_token_id",
            unique=True,
            postgresql_where=text("device_token_id IS NOT NULL"),
        ),
    )

    id: Mapped[UUID] = uuid_pk()
    job_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("push_notification_jobs.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("app_users.id", ondelete="CASCADE"),
        nullable=False,
    )
    device_token_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("device_tokens.id", ondelete="SET NULL"),
    )
    expo_push_token: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'queued'"),
    )
    expo_ticket_id: Mapped[str | None] = mapped_column(Text)
    expo_receipt_id: Mapped[str | None] = mapped_column(Text)
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = timestamptz_now()
    updated_at: Mapped[datetime] = timestamptz_now()
