"""Create core API schema.

Revision ID: 20260706135613
Revises:
Create Date: 2026-07-06 13:56:13.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260706135613"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def id_pk() -> sa.Column:
    return sa.Column(
        "id",
        postgresql.UUID(as_uuid=True),
        server_default=sa.text("gen_random_uuid()"),
        nullable=False,
    )


def uuid_fk(
    name: str,
    target: str,
    *,
    nullable: bool = False,
    ondelete: str,
) -> sa.Column:
    return sa.Column(
        name,
        postgresql.UUID(as_uuid=True),
        sa.ForeignKey(target, ondelete=ondelete),
        nullable=nullable,
    )


def timestamptz_now(name: str) -> sa.Column:
    return sa.Column(
        name,
        sa.DateTime(timezone=True),
        server_default=sa.func.now(),
        nullable=False,
    )


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    op.create_table(
        "communities",
        id_pk(),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("city", sa.Text(), nullable=False),
        sa.Column("slug", sa.Text(), nullable=True),
        sa.Column("country", sa.Text(), server_default=sa.text("'RU'"), nullable=True),
        sa.Column(
            "timezone",
            sa.Text(),
            server_default=sa.text("'Europe/Moscow'"),
            nullable=True,
        ),
        sa.Column("logo_url", sa.Text(), nullable=True),
        sa.Column("website_url", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        timestamptz_now("created_at"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "communities_slug_key",
        "communities",
        ["slug"],
        unique=True,
        postgresql_where=sa.text("slug IS NOT NULL"),
    )

    op.create_table(
        "app_users",
        id_pk(),
        sa.Column("email", sa.Text(), nullable=True),
        sa.Column("phone", sa.Text(), nullable=True),
        sa.Column("password_hash", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), server_default=sa.text("'active'"), nullable=False),
        sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("phone_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        timestamptz_now("created_at"),
        timestamptz_now("updated_at"),
        sa.CheckConstraint("btrim(status) <> ''", name="app_users_status_not_empty"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("phone", name="app_users_phone_key"),
    )
    op.create_index(
        "app_users_email_lower_key",
        "app_users",
        [sa.text("lower(email)")],
        unique=True,
        postgresql_where=sa.text("email IS NOT NULL"),
    )

    op.create_table(
        "profiles",
        id_pk(),
        uuid_fk("user_id", "app_users.id", ondelete="CASCADE"),
        uuid_fk("community_id", "communities.id", nullable=True, ondelete="SET NULL"),
        sa.Column("full_name", sa.Text(), nullable=True),
        sa.Column("hebrew_name", sa.Text(), nullable=True),
        sa.Column("display_name", sa.Text(), nullable=True),
        sa.Column("first_name", sa.Text(), nullable=True),
        sa.Column("last_name", sa.Text(), nullable=True),
        sa.Column("phone", sa.Text(), nullable=True),
        sa.Column("email", sa.Text(), nullable=True),
        sa.Column("avatar_url", sa.Text(), nullable=True),
        sa.Column("birth_date", sa.Date(), nullable=True),
        sa.Column("hebrew_birth_date", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "birth_time_context",
            sa.Text(),
            server_default=sa.text("'unknown'"),
            nullable=False,
        ),
        sa.Column("nusach", sa.Text(), server_default=sa.text("'chabad'"), nullable=True),
        sa.Column("city", sa.Text(), nullable=True),
        sa.Column("tribe_status", sa.Text(), nullable=True),
        sa.Column("marital_status", sa.Text(), nullable=True),
        sa.Column("about", sa.Text(), nullable=True),
        sa.Column(
            "profile_visibility",
            sa.Text(),
            server_default=sa.text("'members'"),
            nullable=False,
        ),
        sa.Column(
            "birthday_visibility",
            sa.Text(),
            server_default=sa.text("'members'"),
            nullable=False,
        ),
        sa.Column(
            "phone_visibility",
            sa.Text(),
            server_default=sa.text("'rabbi_only'"),
            nullable=False,
        ),
        sa.Column(
            "notification_preferences",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "onboarding_completed",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        timestamptz_now("created_at"),
        timestamptz_now("updated_at"),
        sa.CheckConstraint(
            "tribe_status IS NULL OR tribe_status IN ('kohen', 'levi', 'israel')",
            name="profiles_tribe_status_check",
        ),
        sa.CheckConstraint(
            "marital_status IS NULL OR marital_status IN ('single', 'married', 'divorced', 'widowed', 'other')",
            name="profiles_marital_status_check",
        ),
        sa.CheckConstraint(
            "about IS NULL OR char_length(about) <= 200",
            name="profiles_about_length_check",
        ),
        sa.CheckConstraint(
            "profile_visibility IN ('rabbi_only', 'members', 'public')",
            name="profiles_profile_visibility_check",
        ),
        sa.CheckConstraint(
            "birthday_visibility IN ('rabbi_only', 'members', 'public')",
            name="profiles_birthday_visibility_check",
        ),
        sa.CheckConstraint(
            "phone_visibility IN ('rabbi_only', 'members', 'public')",
            name="profiles_phone_visibility_check",
        ),
        sa.CheckConstraint(
            "birth_time_context IN ('before_sunset', 'after_sunset', 'unknown')",
            name="profiles_birth_time_context_check",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", name="profiles_user_id_key"),
    )
    op.create_index("profiles_user_id_idx", "profiles", ["user_id"])
    op.create_index("profiles_community_id_idx", "profiles", ["community_id"])

    op.create_table(
        "community_memberships",
        id_pk(),
        uuid_fk("community_id", "communities.id", ondelete="CASCADE"),
        uuid_fk("user_id", "app_users.id", ondelete="CASCADE"),
        sa.Column("role", sa.Text(), server_default=sa.text("'member'"), nullable=False),
        sa.Column("status", sa.Text(), server_default=sa.text("'pending'"), nullable=False),
        uuid_fk("invited_by", "app_users.id", nullable=True, ondelete="SET NULL"),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=True),
        timestamptz_now("created_at"),
        sa.CheckConstraint(
            "role IN ('member', 'rabbi', 'event_manager', 'admin')",
            name="community_memberships_role_check",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'active', 'suspended', 'left')",
            name="community_memberships_status_check",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "community_id",
            "user_id",
            name="community_memberships_unique_user_community",
        ),
    )
    op.create_index(
        "community_memberships_user_id_idx",
        "community_memberships",
        ["user_id"],
    )
    op.create_index(
        "community_memberships_community_id_idx",
        "community_memberships",
        ["community_id"],
    )

    op.create_table(
        "invites",
        id_pk(),
        uuid_fk("community_id", "communities.id", ondelete="CASCADE"),
        sa.Column("code_hash", sa.Text(), nullable=False),
        sa.Column("email", sa.Text(), nullable=True),
        sa.Column("phone", sa.Text(), nullable=True),
        sa.Column("role", sa.Text(), server_default=sa.text("'member'"), nullable=False),
        sa.Column("max_uses", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("used_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        uuid_fk("created_by", "app_users.id", nullable=True, ondelete="SET NULL"),
        uuid_fk("accepted_by", "app_users.id", nullable=True, ondelete="SET NULL"),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.Text(), server_default=sa.text("'active'"), nullable=False),
        timestamptz_now("created_at"),
        sa.CheckConstraint(
            "role IN ('member', 'rabbi', 'event_manager', 'admin')",
            name="invites_role_check",
        ),
        sa.CheckConstraint(
            "status IN ('active', 'used', 'expired', 'revoked')",
            name="invites_status_check",
        ),
        sa.CheckConstraint(
            "max_uses > 0 AND used_count >= 0 AND used_count <= max_uses",
            name="invites_usage_check",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code_hash", name="invites_code_hash_key"),
    )
    op.create_index("invites_community_id_idx", "invites", ["community_id"])

    op.create_table(
        "event_categories",
        id_pk(),
        uuid_fk("community_id", "communities.id", ondelete="CASCADE"),
        sa.Column("slug", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("color", sa.Text(), server_default=sa.text("'#7B68EE'"), nullable=False),
        sa.Column("icon", sa.Text(), server_default=sa.text("'*'"), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default=sa.text("100"), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        uuid_fk("created_by", "app_users.id", nullable=True, ondelete="SET NULL"),
        uuid_fk("updated_by", "app_users.id", nullable=True, ondelete="SET NULL"),
        timestamptz_now("created_at"),
        timestamptz_now("updated_at"),
        sa.CheckConstraint(
            "slug ~ '^[a-z0-9][a-z0-9_]{1,63}$'",
            name="event_categories_slug_format_check",
        ),
        sa.CheckConstraint(
            "color ~ '^#[0-9a-fA-F]{6}$'",
            name="event_categories_color_format_check",
        ),
        sa.CheckConstraint("btrim(title) <> ''", name="event_categories_title_not_empty_check"),
        sa.CheckConstraint("btrim(icon) <> ''", name="event_categories_icon_not_empty_check"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "community_id",
            "slug",
            name="event_categories_unique_slug_per_community",
        ),
    )
    op.create_index(
        "event_categories_community_id_idx",
        "event_categories",
        ["community_id"],
    )
    op.create_index(
        "event_categories_active_sort_idx",
        "event_categories",
        ["community_id", "is_active", "sort_order"],
    )

    op.create_table(
        "events",
        id_pk(),
        uuid_fk("community_id", "communities.id", ondelete="CASCADE"),
        sa.Column("event_kind", sa.Text(), server_default=sa.text("'single'"), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("subtitle", sa.Text(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("short_description", sa.Text(), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_permanent", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "timezone",
            sa.Text(),
            server_default=sa.text("'Europe/Moscow'"),
            nullable=True,
        ),
        sa.Column("location_name", sa.Text(), nullable=True),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("latitude", sa.Numeric(10, 7), nullable=True),
        sa.Column("longitude", sa.Numeric(10, 7), nullable=True),
        sa.Column("image_url", sa.Text(), nullable=True),
        sa.Column("category", sa.Text(), server_default=sa.text("'community'"), nullable=False),
        sa.Column("audience", sa.Text(), server_default=sa.text("'all'"), nullable=True),
        sa.Column("visibility", sa.Text(), server_default=sa.text("'public'"), nullable=False),
        sa.Column("status", sa.Text(), server_default=sa.text("'published'"), nullable=False),
        sa.Column("source_type", sa.Text(), server_default=sa.text("'manual'"), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=True),
        sa.Column("source_external_id", sa.Text(), nullable=True),
        sa.Column("manual_override", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "registration_mode",
            sa.Text(),
            server_default=sa.text("'none'"),
            nullable=False,
        ),
        sa.Column("registration_url", sa.Text(), nullable=True),
        sa.Column("capacity", sa.Integer(), nullable=True),
        sa.Column("waitlist_enabled", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("requires_approval", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("price_amount", sa.Integer(), nullable=True),
        sa.Column("price_currency", sa.Text(), server_default=sa.text("'RUB'"), nullable=True),
        uuid_fk("created_by", "app_users.id", nullable=True, ondelete="SET NULL"),
        uuid_fk("updated_by", "app_users.id", nullable=True, ondelete="SET NULL"),
        timestamptz_now("created_at"),
        timestamptz_now("updated_at"),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "event_kind IN ('single', 'course', 'sunday_school', 'shabbat', 'holiday', 'announcement')",
            name="events_event_kind_check",
        ),
        sa.CheckConstraint(
            "visibility IN ('public', 'members_only', 'hidden')",
            name="events_visibility_check",
        ),
        sa.CheckConstraint(
            "status IN ('draft', 'published', 'cancelled', 'archived')",
            name="events_status_check",
        ),
        sa.CheckConstraint(
            "source_type IN ('manual', 'website_scrape')",
            name="events_source_type_check",
        ),
        sa.CheckConstraint(
            "registration_mode IN ('none', 'external_link', 'internal_free', 'internal_paid')",
            name="events_registration_mode_check",
        ),
        sa.CheckConstraint("capacity IS NULL OR capacity > 0", name="events_capacity_check"),
        sa.CheckConstraint(
            "price_amount IS NULL OR price_amount >= 0",
            name="events_price_amount_check",
        ),
        sa.CheckConstraint(
            "price_currency IS NULL OR btrim(price_currency) <> ''",
            name="events_price_currency_check",
        ),
        sa.CheckConstraint("ends_at IS NULL OR ends_at > starts_at", name="events_ends_at_check"),
        sa.ForeignKeyConstraint(
            ["community_id", "category"],
            ["event_categories.community_id", "event_categories.slug"],
            name="events_category_event_categories_fkey",
            onupdate="CASCADE",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("events_community_id_idx", "events", ["community_id"])
    op.create_index(
        "events_status_visibility_starts_at_idx",
        "events",
        ["status", "visibility", "starts_at"],
    )
    op.create_index(
        "events_source_external_id_idx",
        "events",
        ["source_type", "source_external_id"],
        postgresql_where=sa.text("source_external_id IS NOT NULL"),
    )
    op.create_index("events_community_id_category_idx", "events", ["community_id", "category"])

    op.create_table(
        "event_occurrences",
        id_pk(),
        uuid_fk("event_id", "events.id", ondelete="CASCADE"),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "timezone",
            sa.Text(),
            server_default=sa.text("'Europe/Moscow'"),
            nullable=False,
        ),
        sa.Column("registration_opens_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("registration_closes_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("capacity", sa.Integer(), nullable=True),
        sa.Column("waitlist_enabled", sa.Boolean(), nullable=True),
        sa.Column("requires_approval", sa.Boolean(), nullable=True),
        sa.Column("status", sa.Text(), server_default=sa.text("'active'"), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default=sa.text("0"), nullable=False),
        timestamptz_now("created_at"),
        timestamptz_now("updated_at"),
        sa.CheckConstraint(
            "status IN ('active', 'hidden', 'cancelled', 'archived')",
            name="event_occurrences_status_check",
        ),
        sa.CheckConstraint(
            "capacity IS NULL OR capacity > 0",
            name="event_occurrences_capacity_check",
        ),
        sa.CheckConstraint(
            "ends_at IS NULL OR ends_at > starts_at",
            name="event_occurrences_ends_at_check",
        ),
        sa.CheckConstraint(
            "registration_closes_at IS NULL OR registration_opens_at IS NULL OR registration_closes_at > registration_opens_at",
            name="event_occurrences_registration_window_check",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("event_occurrences_event_id_idx", "event_occurrences", ["event_id"])
    op.create_index(
        "event_occurrences_event_starts_at_idx",
        "event_occurrences",
        ["event_id", "starts_at"],
    )
    op.create_index(
        "event_occurrences_status_starts_at_idx",
        "event_occurrences",
        ["status", "starts_at"],
    )

    op.create_table(
        "event_participation_options",
        id_pk(),
        uuid_fk("event_id", "events.id", ondelete="CASCADE"),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("price_amount", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("price_currency", sa.Text(), server_default=sa.text("'RUB'"), nullable=False),
        sa.Column(
            "option_type",
            sa.Text(),
            server_default=sa.text("'participation'"),
            nullable=False,
        ),
        sa.Column("seat_limit", sa.Integer(), nullable=True),
        sa.Column("allow_quantity", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("min_quantity", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("max_quantity", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("is_donation", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "counts_toward_capacity",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column("group_key", sa.Text(), nullable=True),
        sa.Column(
            "conflicts_with",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("sort_order", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        timestamptz_now("created_at"),
        timestamptz_now("updated_at"),
        sa.CheckConstraint(
            "price_amount >= 0",
            name="event_participation_options_price_amount_check",
        ),
        sa.CheckConstraint(
            "btrim(price_currency) <> ''",
            name="event_participation_options_price_currency_check",
        ),
        sa.CheckConstraint(
            "option_type IN ('participation', 'meal', 'package', 'donation', 'child', 'family', 'other')",
            name="event_participation_options_option_type_check",
        ),
        sa.CheckConstraint(
            "seat_limit IS NULL OR seat_limit > 0",
            name="event_participation_options_seat_limit_check",
        ),
        sa.CheckConstraint(
            "min_quantity >= 1",
            name="event_participation_options_min_quantity_check",
        ),
        sa.CheckConstraint(
            "max_quantity >= min_quantity",
            name="event_participation_options_max_quantity_check",
        ),
        sa.CheckConstraint(
            "allow_quantity = true OR (min_quantity = 1 AND max_quantity = 1)",
            name="event_participation_options_allow_quantity_check",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(conflicts_with) = 'array'",
            name="event_participation_options_conflicts_with_array_check",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "id",
            "event_id",
            name="event_participation_options_id_event_id_unique",
        ),
    )
    op.create_index(
        "event_participation_options_event_id_idx",
        "event_participation_options",
        ["event_id"],
    )
    op.create_index(
        "event_participation_options_active_sort_idx",
        "event_participation_options",
        ["event_id", "is_active", "sort_order"],
    )

    op.create_table(
        "event_capacity_units",
        id_pk(),
        uuid_fk("event_id", "events.id", ondelete="CASCADE"),
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("capacity", sa.Integer(), nullable=True),
        sa.Column("sort_order", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        timestamptz_now("created_at"),
        timestamptz_now("updated_at"),
        sa.CheckConstraint("btrim(key) <> ''", name="event_capacity_units_key_not_empty"),
        sa.CheckConstraint("btrim(title) <> ''", name="event_capacity_units_title_not_empty"),
        sa.CheckConstraint(
            "capacity IS NULL OR capacity > 0",
            name="event_capacity_units_capacity_check",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id", "key", name="event_capacity_units_event_key_unique"),
        sa.UniqueConstraint("id", "event_id", name="event_capacity_units_id_event_id_unique"),
    )
    op.create_index(
        "event_capacity_units_event_active_sort_idx",
        "event_capacity_units",
        ["event_id", "is_active", "sort_order"],
    )

    op.create_table(
        "event_participation_option_capacity_units",
        id_pk(),
        uuid_fk("event_id", "events.id", ondelete="CASCADE"),
        sa.Column("option_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("capacity_unit_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "seats_per_quantity",
            sa.Integer(),
            server_default=sa.text("1"),
            nullable=False,
        ),
        timestamptz_now("created_at"),
        sa.CheckConstraint(
            "seats_per_quantity > 0",
            name="event_option_capacity_units_seats_per_quantity_check",
        ),
        sa.ForeignKeyConstraint(
            ["option_id", "event_id"],
            ["event_participation_options.id", "event_participation_options.event_id"],
            name="event_option_capacity_units_option_event_fkey",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["capacity_unit_id", "event_id"],
            ["event_capacity_units.id", "event_capacity_units.event_id"],
            name="event_option_capacity_units_unit_event_fkey",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "option_id",
            "capacity_unit_id",
            name="event_option_capacity_units_option_unit_unique",
        ),
    )
    op.create_index(
        "event_option_capacity_units_event_id_idx",
        "event_participation_option_capacity_units",
        ["event_id"],
    )
    op.create_index(
        "event_option_capacity_units_option_id_idx",
        "event_participation_option_capacity_units",
        ["option_id"],
    )
    op.create_index(
        "event_option_capacity_units_capacity_unit_id_idx",
        "event_participation_option_capacity_units",
        ["capacity_unit_id"],
    )

    op.create_table(
        "event_registrations",
        id_pk(),
        uuid_fk("event_id", "events.id", ondelete="CASCADE"),
        uuid_fk("user_id", "app_users.id", ondelete="CASCADE"),
        uuid_fk("occurrence_id", "event_occurrences.id", nullable=True, ondelete="SET NULL"),
        sa.Column("status", sa.Text(), server_default=sa.text("'pending'"), nullable=False),
        sa.Column("seats_count", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column(
            "guest_names",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("comment", sa.Text(), nullable=True),
        timestamptz_now("registered_at"),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "payment_status",
            sa.Text(),
            server_default=sa.text("'not_required'"),
            nullable=False,
        ),
        sa.Column("payment_id", sa.Text(), nullable=True),
        timestamptz_now("created_at"),
        timestamptz_now("updated_at"),
        sa.CheckConstraint(
            "status IN ('pending', 'confirmed', 'waitlisted', 'cancelled', 'rejected', 'attended', 'no_show')",
            name="event_registrations_status_check",
        ),
        sa.CheckConstraint("seats_count > 0", name="event_registrations_seats_count_check"),
        sa.CheckConstraint(
            "payment_status IN ('not_required', 'pending', 'succeeded', 'failed', 'cancelled', 'refunded', 'paid')",
            name="event_registrations_payment_status_check",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("event_registrations_event_id_idx", "event_registrations", ["event_id"])
    op.create_index("event_registrations_user_id_idx", "event_registrations", ["user_id"])
    op.create_index("event_registrations_status_idx", "event_registrations", ["status"])
    op.create_index(
        "event_registrations_occurrence_id_idx",
        "event_registrations",
        ["occurrence_id"],
    )

    op.create_table(
        "event_registration_option_selections",
        id_pk(),
        uuid_fk("registration_id", "event_registrations.id", ondelete="CASCADE"),
        uuid_fk("option_id", "event_participation_options.id", nullable=True, ondelete="SET NULL"),
        sa.Column("title_snapshot", sa.Text(), nullable=False),
        sa.Column("description_snapshot", sa.Text(), nullable=True),
        sa.Column("option_type_snapshot", sa.Text(), nullable=False),
        sa.Column("quantity", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("unit_price_amount", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("total_amount", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("currency", sa.Text(), server_default=sa.text("'RUB'"), nullable=False),
        sa.Column(
            "counts_toward_capacity",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column("seats_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("is_donation", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        timestamptz_now("created_at"),
        sa.CheckConstraint(
            "quantity > 0",
            name="event_registration_option_selections_quantity_check",
        ),
        sa.CheckConstraint(
            "unit_price_amount >= 0",
            name="event_registration_option_selections_unit_price_amount_check",
        ),
        sa.CheckConstraint(
            "total_amount >= 0",
            name="event_registration_option_selections_total_amount_check",
        ),
        sa.CheckConstraint(
            "btrim(currency) <> ''",
            name="event_registration_option_selections_currency_check",
        ),
        sa.CheckConstraint(
            "seats_count >= 0",
            name="event_registration_option_selections_seats_count_check",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "event_registration_option_selections_registration_id_idx",
        "event_registration_option_selections",
        ["registration_id"],
    )
    op.create_index(
        "event_registration_option_selections_option_id_idx",
        "event_registration_option_selections",
        ["option_id"],
    )

    op.create_table(
        "event_registration_capacity_reservations",
        id_pk(),
        uuid_fk("registration_id", "event_registrations.id", ondelete="CASCADE"),
        uuid_fk("event_id", "events.id", ondelete="CASCADE"),
        uuid_fk("occurrence_id", "event_occurrences.id", nullable=True, ondelete="CASCADE"),
        uuid_fk("capacity_unit_id", "event_capacity_units.id", ondelete="RESTRICT"),
        uuid_fk("option_id", "event_participation_options.id", nullable=True, ondelete="SET NULL"),
        sa.Column("capacity_unit_key_snapshot", sa.Text(), nullable=False),
        sa.Column("capacity_unit_title_snapshot", sa.Text(), nullable=False),
        sa.Column("option_title_snapshot", sa.Text(), nullable=True),
        sa.Column("quantity", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("seats_per_quantity", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("seats_count", sa.Integer(), nullable=False),
        timestamptz_now("created_at"),
        sa.CheckConstraint(
            "quantity > 0",
            name="event_registration_capacity_reservations_quantity_check",
        ),
        sa.CheckConstraint(
            "seats_per_quantity > 0",
            name="event_reg_capacity_reservations_seats_per_qty_check",
        ),
        sa.CheckConstraint(
            "seats_count > 0",
            name="event_registration_capacity_reservations_seats_count_check",
        ),
        sa.CheckConstraint(
            "btrim(capacity_unit_key_snapshot) <> ''",
            name="event_registration_capacity_reservations_unit_key_not_empty",
        ),
        sa.CheckConstraint(
            "btrim(capacity_unit_title_snapshot) <> ''",
            name="event_registration_capacity_reservations_unit_title_not_empty",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "event_registration_capacity_reservations_registration_id_idx",
        "event_registration_capacity_reservations",
        ["registration_id"],
    )
    op.create_index(
        "event_registration_capacity_reservations_event_occurrence_idx",
        "event_registration_capacity_reservations",
        ["event_id", "occurrence_id"],
    )
    op.create_index(
        "event_registration_capacity_reservations_capacity_unit_idx",
        "event_registration_capacity_reservations",
        ["capacity_unit_id"],
    )
    op.create_index(
        "event_reg_capacity_reservations_event_unit_occ_idx",
        "event_registration_capacity_reservations",
        ["event_id", "capacity_unit_id", "occurrence_id"],
    )


def downgrade() -> None:
    op.drop_table("event_registration_capacity_reservations")
    op.drop_table("event_registration_option_selections")
    op.drop_table("event_registrations")
    op.drop_table("event_participation_option_capacity_units")
    op.drop_table("event_capacity_units")
    op.drop_table("event_participation_options")
    op.drop_table("event_occurrences")
    op.drop_table("events")
    op.drop_table("event_categories")
    op.drop_table("invites")
    op.drop_table("community_memberships")
    op.drop_table("profiles")
    op.drop_table("app_users")
    op.drop_table("communities")
