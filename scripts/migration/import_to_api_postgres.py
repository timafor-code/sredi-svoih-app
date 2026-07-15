#!/usr/bin/env python3
"""Fail-closed owner utility for importing a controlled Supabase JSONL export.

This module intentionally uses only the owner-provided API_MIGRATION_DATABASE_URL.
It never reads dotenv files, Supabase Auth tables, or Supabase services.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlsplit
from uuid import UUID


FORMAT_VERSION = "1.0.0"
DATABASE_ENV = "API_MIGRATION_DATABASE_URL"
ACK_ENV = "API_MIGRATION_RUN_ACK"
ACKNOWLEDGEMENT = "LOCAL_OR_OWNER_APPROVED_IMPORT"
REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "0.0.0.0", "host.docker.internal"}
SAFE_IDENTIFIER = re.compile(r"^[a-z_][a-z0-9_]*$")
IMPORT_KEY = re.compile(r"^[a-z0-9][a-z0-9_]{1,63}$")
EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")

# This is the exporter allowlist from PR #324.  Its order is intentionally not
# inferred from artifact file names.
PUBLIC_TABLES: tuple[tuple[str, bool], ...] = (
    ("profiles", True),
    ("communities", True),
    ("community_memberships", True),
    ("invites", True),
    ("events", True),
    ("event_occurrences", False),
    ("event_categories", False),
    ("event_participation_options", False),
    ("event_participation_option_capacity_units", False),
    ("event_registration_option_selections", False),
    ("event_capacity_units", False),
    ("event_registrations", True),
    ("event_registration_capacity_reservations", False),
    ("event_seating_layout_templates", False),
    ("event_seating_layouts", False),
    ("event_seating_tables", False),
    ("event_seating_table_connections", False),
    ("event_seating_assignments", False),
    ("event_import_sources", False),
    ("event_import_runs", False),
    ("event_import_items", False),
    ("admin_feedback", False),
    ("device_tokens", False),
    ("prayer_activity_logs", False),
    ("profile_contact_visibility", False),
    ("community_contacts", True),
    ("synced_contacts", True),
    ("community_event_locations", False),
    ("push_notification_jobs", False),
    ("push_notification_deliveries", False),
)
PUBLIC_REQUIRED = {name for name, required in PUBLIC_TABLES if required}
PUBLIC_ALLOWED = {name for name, _ in PUBLIC_TABLES}


class MigrationError(RuntimeError):
    """An error whose text is safe to show without source values or credentials."""


@dataclass(frozen=True)
class Problem:
    domain: str
    category: str
    row: int | None = None
    field: str | None = None

    def compact(self) -> dict[str, Any]:
        result: dict[str, Any] = {"domain": self.domain, "category": self.category}
        if self.row is not None:
            result["row"] = self.row
        if self.field is not None:
            result["field"] = self.field
        return result


@dataclass
class Collector:
    problems: list[Problem] = field(default_factory=list)
    limit: int = 100

    def add(self, domain: str, category: str, *, row: int | None = None, field: str | None = None) -> None:
        if len(self.problems) < self.limit:
            self.problems.append(Problem(domain, category, row, field))

    def require_clean(self, label: str) -> None:
        if self.problems:
            raise MigrationError(f"{label} failed with {len(self.problems)} safe validation issue(s).")


@dataclass(frozen=True)
class Mapping:
    source_table: str
    target_table: str
    primary_key: tuple[str, ...]
    columns: tuple[str, ...]
    required_for_apply: bool = True
    ignored_source_columns: frozenset[str] = frozenset()


# Explicit source-to-target field maps.  They deliberately do not enumerate or
# import arbitrary JSONL files.  Most API tables were designed to preserve the
# legacy public-table shape; the three event-import tables have verified
# transformations in map_special_row below.
MAPPINGS: tuple[Mapping, ...] = (
    Mapping("communities", "communities", ("id",), ("id", "name", "city", "slug", "country", "timezone", "logo_url", "website_url", "is_active", "created_at")),
    Mapping("profiles", "profiles", ("id",), ("id", "community_id", "full_name", "hebrew_name", "display_name", "first_name", "last_name", "phone", "email", "avatar_url", "birth_date", "hebrew_birth_date", "birth_time_context", "nusach", "city", "tribe_status", "marital_status", "about", "profile_visibility", "birthday_visibility", "phone_visibility", "notification_preferences", "onboarding_completed", "created_at", "updated_at")),
    Mapping("community_memberships", "community_memberships", ("id",), ("id", "community_id", "user_id", "role", "status", "invited_by", "joined_at", "created_at")),
    Mapping("invites", "invites", ("id",), ("id", "community_id", "code_hash", "email", "phone", "role", "max_uses", "used_count", "expires_at", "created_by", "accepted_by", "accepted_at", "status", "created_at")),
    Mapping("event_categories", "event_categories", ("id",), ("id", "community_id", "slug", "title", "description", "color", "icon", "sort_order", "is_active", "created_by", "updated_by", "created_at", "updated_at")),
    Mapping("community_event_locations", "community_event_locations", ("id",), ("id", "community_id", "title", "address", "is_default", "is_active", "sort_order", "created_at", "updated_at")),
    Mapping("events", "events", ("id",), ("id", "community_id", "event_kind", "title", "subtitle", "description", "short_description", "starts_at", "ends_at", "is_permanent", "timezone", "location_name", "address", "latitude", "longitude", "image_url", "category", "audience", "visibility", "status", "source_type", "source_url", "source_external_id", "manual_override", "registration_mode", "registration_url", "capacity", "waitlist_enabled", "requires_approval", "price_amount", "price_currency", "created_by", "updated_by", "created_at", "updated_at", "published_at"), ignored_source_columns=frozenset({"seats_total"})),
    Mapping("event_occurrences", "event_occurrences", ("id",), ("id", "event_id", "title", "starts_at", "ends_at", "timezone", "registration_opens_at", "registration_closes_at", "capacity", "waitlist_enabled", "requires_approval", "status", "sort_order", "created_at", "updated_at")),
    Mapping("event_participation_options", "event_participation_options", ("id",), ("id", "event_id", "title", "description", "price_amount", "price_currency", "option_type", "seat_limit", "allow_quantity", "min_quantity", "max_quantity", "is_donation", "counts_toward_capacity", "group_key", "conflicts_with", "sort_order", "is_active", "created_at", "updated_at")),
    Mapping("event_capacity_units", "event_capacity_units", ("id",), ("id", "event_id", "key", "title", "description", "capacity", "sort_order", "is_active", "created_at", "updated_at")),
    Mapping("event_participation_option_capacity_units", "event_participation_option_capacity_units", ("id",), ("id", "event_id", "option_id", "capacity_unit_id", "seats_per_quantity", "created_at")),
    Mapping("event_registrations", "event_registrations", ("id",), ("id", "event_id", "user_id", "occurrence_id", "status", "seats_count", "guest_names", "comment", "registered_at", "confirmed_at", "cancelled_at", "payment_status", "payment_id", "created_at", "updated_at")),
    Mapping("event_registration_option_selections", "event_registration_option_selections", ("id",), ("id", "registration_id", "option_id", "title_snapshot", "description_snapshot", "option_type_snapshot", "quantity", "unit_price_amount", "total_amount", "currency", "counts_toward_capacity", "seats_count", "is_donation", "created_at")),
    Mapping("event_registration_capacity_reservations", "event_registration_capacity_reservations", ("id",), ("id", "registration_id", "event_id", "occurrence_id", "capacity_unit_id", "option_id", "capacity_unit_key_snapshot", "capacity_unit_title_snapshot", "option_title_snapshot", "quantity", "seats_per_quantity", "seats_count", "created_at")),
    Mapping("profile_contact_visibility", "profile_contact_visibility", ("user_id",), ("user_id", "show_in_community_directory", "share_phone", "share_email", "share_birth_date", "share_hebrew_birth_date", "share_city", "share_hebrew_name", "birthday_reminders_enabled", "created_at", "updated_at")),
    Mapping("community_contacts", "community_contacts", ("id",), ("id", "community_id", "full_name", "hebrew_name", "role", "city", "created_at")),
    Mapping("synced_contacts", "synced_contacts", ("id",), ("id", "user_id", "name", "phone_hash", "email_hash", "birthday", "consented_at", "created_at")),
    Mapping("admin_feedback", "admin_feedback", ("id",), ("id", "community_id", "user_id", "section", "entity_type", "entity_id", "severity", "message", "status", "user_agent", "url", "resolved_at", "resolved_by", "created_at", "updated_at")),
    Mapping("device_tokens", "device_tokens", ("id",), ("id", "user_id", "platform", "push_provider", "expo_push_token", "device_id", "app_version", "build_version", "environment", "is_active", "last_seen_at", "created_at", "updated_at")),
    Mapping("prayer_activity_logs", "prayer_activity_logs", ("id",), ("id", "user_id", "activity_type", "activity_date", "started_at", "completed_at", "timezone", "city", "hebrew_date", "metadata", "created_at", "updated_at")),
    Mapping("event_seating_layout_templates", "event_seating_layout_templates", ("id",), ("id", "community_id", "title", "snapshot", "is_builtin", "is_active", "created_by", "created_at", "updated_at")),
    Mapping("event_seating_layouts", "event_seating_layouts", ("id",), ("id", "community_id", "event_id", "occurrence_id", "capacity_unit_id", "template_id", "capacity_limit_snapshot", "seating_done", "created_by", "created_at", "updated_at")),
    Mapping("event_seating_tables", "event_seating_tables", ("id",), ("id", "layout_id", "client_table_id", "cx", "cy", "w", "h", "angle", "long_side_seats", "is_rabbi_table", "created_at")),
    Mapping("event_seating_table_connections", "event_seating_table_connections", ("id",), ("id", "layout_id", "from_client_table_id", "from_end", "to_client_table_id", "to_end", "anchor_x", "anchor_y", "created_at")),
    Mapping("event_seating_assignments", "event_seating_assignments", ("id",), ("id", "layout_id", "registration_id", "seat_key", "guest_label", "guest_initials", "assignment_type", "created_at")),
    Mapping("push_notification_jobs", "push_notification_jobs", ("id",), ("id", "community_id", "created_by", "notification_kind", "audience", "event_id", "occurrence_id", "registration_id", "target_user_id", "title", "body", "data", "status", "queued_at", "processed_at", "error_message", "created_at", "updated_at")),
    Mapping("push_notification_deliveries", "push_notification_deliveries", ("id",), ("id", "job_id", "user_id", "device_token_id", "expo_push_token", "status", "expo_ticket_id", "expo_receipt_id", "error_message", "created_at", "updated_at")),
    Mapping("event_import_sources", "event_import_sources", ("id",), tuple()),
    Mapping("event_import_runs", "event_import_runs", ("id",), tuple()),
    Mapping("event_import_items", "event_import_items", ("id",), tuple()),
)
MAPPING_BY_SOURCE = {mapping.source_table: mapping for mapping in MAPPINGS}

IMPORT_SOURCE_FIELDS = {"id", "community_id", "name", "source_type", "url", "parser_name", "is_active", "last_run_at", "created_at"}
IMPORT_RUN_FIELDS = {"id", "source_id", "status", "started_at", "finished_at", "error", "found_count", "created_count", "updated_count"}
IMPORT_ITEM_FIELDS = {"id", "source_id", "run_id", "external_id", "source_url", "raw_payload", "parsed_title", "parsed_starts_at", "parsed_location", "linked_event_id", "status", "created_at"}

UUID_FIELDS = {
    "id", "community_id", "user_id", "avatar_id", "invited_by", "created_by", "updated_by", "accepted_by",
    "event_id", "occurrence_id", "option_id", "capacity_unit_id", "registration_id", "layout_id", "template_id",
    "entity_id", "resolved_by", "target_user_id", "job_id", "device_token_id", "source_id", "run_id", "linked_event_id",
}
TIMESTAMP_FIELDS = {
    "created_at", "updated_at", "joined_at", "expires_at", "accepted_at", "starts_at", "ends_at", "registered_at",
    "confirmed_at", "cancelled_at", "published_at", "registration_opens_at", "registration_closes_at", "resolved_at",
    "last_seen_at", "started_at", "completed_at", "queued_at", "processed_at", "finished_at", "parsed_starts_at",
    "consented_at",
}
DATE_FIELDS = {"birth_date", "birthday", "activity_date"}
DECIMAL_FIELDS = {"latitude", "longitude", "cx", "cy", "w", "h", "anchor_x", "anchor_y"}
INTEGER_FIELDS = {
    "sort_order", "capacity", "price_amount", "seat_limit", "min_quantity", "max_quantity", "seats_per_quantity",
    "seats_count", "quantity", "unit_price_amount", "total_amount", "max_uses", "used_count", "long_side_seats",
    "angle", "capacity_limit_snapshot", "found_count", "parsed_count", "created_count", "updated_count", "guest_index",
    "size_bytes",
}
BOOLEAN_FIELDS = {
    "is_active", "is_default", "is_permanent", "manual_override", "waitlist_enabled", "requires_approval",
    "allow_quantity", "is_donation", "counts_toward_capacity", "onboarding_completed", "show_in_community_directory",
    "share_phone", "share_email", "share_birth_date", "share_hebrew_birth_date", "share_city", "share_hebrew_name",
    "birthday_reminders_enabled", "is_builtin", "seating_done", "is_rabbi_table",
}
JSON_OBJECT_FIELDS = {
    "hebrew_birth_date", "notification_preferences", "hebrew_date", "metadata", "data", "settings", "summary",
    "parser_metadata", "debug_metadata", "raw_payload", "snapshot",
}
JSON_ARRAY_FIELDS = {"guest_names", "conflicts_with"}

ENUMS: dict[tuple[str, str], set[str]] = {
    ("profiles", "tribe_status"): {"kohen", "levi", "israel"},
    ("profiles", "marital_status"): {"single", "married", "divorced", "widowed", "other"},
    ("profiles", "birth_time_context"): {"before_sunset", "after_sunset", "unknown"},
    ("profiles", "profile_visibility"): {"rabbi_only", "members", "public"},
    ("profiles", "birthday_visibility"): {"rabbi_only", "members", "public"},
    ("profiles", "phone_visibility"): {"rabbi_only", "members", "public"},
    ("community_memberships", "role"): {"member", "rabbi", "event_manager", "admin"},
    ("community_memberships", "status"): {"pending", "active", "suspended", "left"},
    ("invites", "role"): {"member", "rabbi", "event_manager", "admin"},
    ("invites", "status"): {"active", "used", "expired", "revoked"},
    ("events", "event_kind"): {"single", "course", "sunday_school", "shabbat", "holiday", "announcement"},
    ("events", "visibility"): {"public", "members_only", "hidden"},
    ("events", "status"): {"draft", "published", "cancelled", "archived"},
    ("events", "source_type"): {"manual", "website_scrape"},
    ("events", "registration_mode"): {"none", "external_link", "internal_free", "internal_paid"},
    ("event_occurrences", "status"): {"active", "hidden", "cancelled", "archived"},
    ("event_participation_options", "option_type"): {"participation", "meal", "package", "donation", "child", "family", "other"},
    ("event_registrations", "status"): {"pending", "confirmed", "waitlisted", "cancelled", "rejected", "attended", "no_show"},
    ("event_registrations", "payment_status"): {"not_required", "pending", "succeeded", "failed", "cancelled", "refunded", "paid"},
    ("admin_feedback", "severity"): {"note", "issue", "blocker", "idea"},
    ("admin_feedback", "status"): {"open", "reviewed", "resolved", "closed"},
    ("device_tokens", "platform"): {"ios", "android", "web", "unknown"},
    ("device_tokens", "push_provider"): {"expo"},
    ("device_tokens", "environment"): {"development", "preview", "production", "unknown"},
    ("prayer_activity_logs", "activity_type"): {"shacharit", "mincha", "maariv", "shema_morning", "shema_evening", "omer_count"},
    ("event_seating_assignments", "assignment_type"): {"guest", "reserve"},
    ("push_notification_jobs", "notification_kind"): {"event_created", "event_updated", "event_cancelled", "registration_confirmed", "registration_rejected", "waitlist_available", "news", "manual"},
    ("push_notification_jobs", "audience"): {"event_registrants", "community_members", "single_user", "manual_tokens"},
    ("push_notification_jobs", "status"): {"queued", "processing", "sent", "partially_sent", "failed", "cancelled"},
    ("push_notification_deliveries", "status"): {"queued", "sent", "failed", "skipped", "receipt_checked"},
    ("event_import_runs", "mode"): {"apply_review_only"},
    ("event_import_runs", "status"): {"started", "success", "failed"},
    ("event_import_items", "status"): {"new", "linked", "ignored", "error"},
}

REQUIRED_COLUMNS: dict[str, set[str]] = {
    "communities": {"id", "name", "city", "is_active", "created_at"},
    "app_users": {"id", "status"},
    "profiles": {"id", "user_id", "birth_time_context", "profile_visibility", "birthday_visibility", "phone_visibility", "notification_preferences", "onboarding_completed", "created_at", "updated_at"},
    "community_memberships": {"id", "community_id", "user_id", "role", "status", "created_at"},
    "invites": {"id", "community_id", "code_hash", "role", "max_uses", "used_count", "status", "created_at"},
    "event_categories": {"id", "community_id", "slug", "title", "color", "icon", "sort_order", "is_active", "created_at", "updated_at"},
    "community_event_locations": {"id", "community_id", "title", "address", "is_default", "is_active", "sort_order", "created_at", "updated_at"},
    "events": {"id", "community_id", "event_kind", "title", "starts_at", "is_permanent", "category", "visibility", "status", "source_type", "manual_override", "registration_mode", "waitlist_enabled", "requires_approval", "created_at", "updated_at"},
    "event_occurrences": {"id", "event_id", "starts_at", "timezone", "status", "sort_order", "created_at", "updated_at"},
    "event_participation_options": {"id", "event_id", "title", "price_amount", "price_currency", "option_type", "allow_quantity", "min_quantity", "max_quantity", "is_donation", "counts_toward_capacity", "conflicts_with", "sort_order", "is_active", "created_at", "updated_at"},
    "event_capacity_units": {"id", "event_id", "key", "title", "sort_order", "is_active", "created_at", "updated_at"},
    "event_participation_option_capacity_units": {"id", "event_id", "option_id", "capacity_unit_id", "seats_per_quantity", "created_at"},
    "event_registrations": {"id", "event_id", "user_id", "status", "seats_count", "guest_names", "registered_at", "payment_status", "created_at", "updated_at"},
    "event_registration_option_selections": {"id", "registration_id", "title_snapshot", "option_type_snapshot", "quantity", "unit_price_amount", "total_amount", "currency", "counts_toward_capacity", "seats_count", "is_donation", "created_at"},
    "event_registration_capacity_reservations": {"id", "registration_id", "event_id", "capacity_unit_id", "capacity_unit_key_snapshot", "capacity_unit_title_snapshot", "quantity", "seats_per_quantity", "seats_count", "created_at"},
    "profile_contact_visibility": {"user_id", "show_in_community_directory", "share_phone", "share_email", "share_birth_date", "share_hebrew_birth_date", "share_city", "share_hebrew_name", "birthday_reminders_enabled", "created_at", "updated_at"},
    "community_contacts": {"id", "community_id", "full_name", "created_at"},
    "synced_contacts": {"id", "user_id", "created_at"},
    "admin_feedback": {"id", "community_id", "user_id", "section", "severity", "message", "status", "created_at", "updated_at"},
    "device_tokens": {"id", "user_id", "platform", "push_provider", "expo_push_token", "environment", "is_active", "last_seen_at", "created_at", "updated_at"},
    "prayer_activity_logs": {"id", "user_id", "activity_type", "activity_date", "timezone", "hebrew_date", "metadata", "created_at", "updated_at"},
    "event_seating_layout_templates": {"id", "community_id", "title", "snapshot", "is_builtin", "is_active", "created_at", "updated_at"},
    "event_seating_layouts": {"id", "community_id", "event_id", "capacity_unit_id", "seating_done", "created_at", "updated_at"},
    "event_seating_tables": {"id", "layout_id", "client_table_id", "cx", "cy", "w", "h", "angle", "long_side_seats", "is_rabbi_table", "created_at"},
    "event_seating_table_connections": {"id", "layout_id", "from_client_table_id", "to_client_table_id", "created_at"},
    "event_seating_assignments": {"id", "layout_id", "assignment_type", "created_at"},
    "push_notification_jobs": {"id", "notification_kind", "audience", "title", "body", "data", "status", "queued_at", "created_at", "updated_at"},
    "push_notification_deliveries": {"id", "job_id", "user_id", "expo_push_token", "status", "created_at", "updated_at"},
    "event_import_sources": {"id", "community_id", "key", "title", "source_type", "source_url", "settings", "is_active", "created_at"},
    "event_import_runs": {"id", "source_id", "community_id", "mode", "status", "started_at", "found_count", "created_count", "updated_count", "summary", "parser_metadata", "debug_metadata"},
    "event_import_items": {"id", "run_id", "source_id", "raw_payload", "status", "created_at"},
}

NOT_BLANK_FIELDS: dict[str, set[str]] = {
    "invites": {"code_hash"}, "event_categories": {"slug", "title", "color", "icon"},
    "community_event_locations": {"title", "address"}, "event_capacity_units": {"key", "title"},
    "event_registration_option_selections": {"title_snapshot", "option_type_snapshot", "currency"},
    "event_registration_capacity_reservations": {"capacity_unit_key_snapshot", "capacity_unit_title_snapshot"},
    "community_contacts": {"full_name"}, "admin_feedback": {"section", "message"},
    "device_tokens": {"expo_push_token"}, "event_seating_layout_templates": {"title"},
    "event_seating_tables": {"client_table_id"}, "event_seating_table_connections": {"from_client_table_id", "to_client_table_id"},
    "event_import_sources": {"key", "title", "source_type", "source_url"},
}

USER_REFERENCE_FIELDS: dict[str, set[str]] = {
    "profiles": {"id"},
    "community_memberships": {"user_id", "invited_by"},
    "invites": {"created_by", "accepted_by"},
    "event_categories": {"created_by", "updated_by"},
    "events": {"created_by", "updated_by"},
    "event_registrations": {"user_id"},
    "admin_feedback": {"user_id", "resolved_by"},
    "device_tokens": {"user_id"},
    "prayer_activity_logs": {"user_id"},
    "profile_contact_visibility": {"user_id"},
    "synced_contacts": {"user_id"},
    "event_seating_layout_templates": {"created_by"},
    "event_seating_layouts": {"created_by"},
    "event_seating_assignments": {"user_id", "created_by"},
    "push_notification_jobs": {"created_by", "target_user_id"},
    "push_notification_deliveries": {"user_id"},
}

UNIQUE_KEYS: dict[str, tuple[tuple[str, ...], ...]] = {
    "communities": (("slug",),),
    "app_users": (("email",), ("phone",)),
    "profiles": (("user_id",),),
    "community_memberships": (("community_id", "user_id"),),
    "invites": (("code_hash",),),
    "event_categories": (("community_id", "slug"),),
    "event_capacity_units": (("event_id", "key"),),
    "event_participation_option_capacity_units": (("option_id", "capacity_unit_id"),),
    "event_seating_tables": (("layout_id", "client_table_id"),),
    "event_import_sources": (("community_id", "key"),),
}


@dataclass
class ArtifactBundle:
    input_dir: Path
    manifest: dict[str, Any]
    records: dict[str, dict[str, Any]]
    rows: dict[str, list[dict[str, Any]]]
    avatar_rows: list[dict[str, Any]] | None


@dataclass
class PreparedDomain:
    mapping: Mapping
    status: str
    rows: list[dict[str, Any]]
    source_count: int

    @property
    def primary_column(self) -> str:
        return self.mapping.primary_key[0]


@dataclass
class ImportPlan:
    domains: list[PreparedDomain]
    identities: list[dict[str, Any]]
    avatar_rows: list[dict[str, Any]] | None
    collector: Collector
    report: dict[str, Any]

    def rows_for_target(self, target_table: str) -> list[dict[str, Any]]:
        if target_table == "app_users":
            return self.identities
        for domain in self.domains:
            if domain.mapping.target_table == target_table and domain.status == "ready":
                return domain.rows
        return []


def safe_identifier(name: str) -> str:
    if not SAFE_IDENTIFIER.fullmatch(name):
        raise MigrationError("An internal table or column identifier is invalid.")
    return f'"{name}"'


def safe_relative_path(path: str) -> bool:
    candidate = Path(path)
    return not candidate.is_absolute() and ".." not in candidate.parts and path.replace("\\", "/") == path


def assert_not_symlink(path: Path, *, category: str = "symlink") -> None:
    try:
        if path.is_symlink():
            raise MigrationError(f"Artifact {category} is not allowed.")
    except OSError as exc:
        raise MigrationError("Artifact filesystem metadata could not be inspected.") from exc


def resolve_input_dir(value: str) -> Path:
    path = Path(value).expanduser()
    try:
        path_stat = path.lstat()
    except OSError as exc:
        raise MigrationError("Input directory is missing or cannot be inspected.") from exc
    if not path_stat or not path.is_dir() or path.is_symlink():
        raise MigrationError("--input-dir must be a real directory, not a symbolic link.")
    return path.resolve()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            for block in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(block)
    except OSError as exc:
        raise MigrationError("An artifact cannot be read for checksum verification.") from exc
    return digest.hexdigest()


def parse_checksum_index(path: Path) -> dict[str, str]:
    assert_not_symlink(path)
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise MigrationError("checksums.sha256 cannot be read as UTF-8.") from exc
    result: dict[str, str] = {}
    for number, line in enumerate(text.splitlines(), start=1):
        match = re.fullmatch(r"([0-9a-f]{64})  ([^\r\n]+)", line)
        if match is None:
            raise MigrationError(f"checksums.sha256 has a malformed entry at line {number}.")
        digest, relative_path = match.groups()
        if not safe_relative_path(relative_path) or relative_path in result:
            raise MigrationError(f"checksums.sha256 has an unsafe or duplicate entry at line {number}.")
        result[relative_path] = digest
    return result


def parse_jsonl(path: Path, domain: str, primary_key: tuple[str, ...], collector: Collector) -> list[dict[str, Any]]:
    assert_not_symlink(path)
    rows: list[dict[str, Any]] = []
    seen_keys: set[tuple[str, ...]] = set()
    try:
        with path.open("r", encoding="utf-8", newline="") as handle:
            for line_number, raw_line in enumerate(handle, start=1):
                if not raw_line.endswith("\n"):
                    collector.add(domain, "jsonl_missing_newline", row=line_number)
                line = raw_line.rstrip("\r\n")
                if not line:
                    collector.add(domain, "jsonl_blank_line", row=line_number)
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    collector.add(domain, "jsonl_malformed", row=line_number)
                    continue
                if not isinstance(row, dict):
                    collector.add(domain, "jsonl_row_not_object", row=line_number)
                    continue
                if primary_key:
                    try:
                        key = tuple(_primary_key_component(row, field) for field in primary_key)
                    except KeyError as exc:
                        collector.add(domain, "primary_key_missing", row=line_number, field=str(exc))
                    else:
                        if key in seen_keys:
                            collector.add(domain, "duplicate_primary_key", row=line_number)
                        seen_keys.add(key)
                rows.append(row)
    except (OSError, UnicodeDecodeError) as exc:
        raise MigrationError(f"Artifact for {domain} cannot be read as UTF-8 JSONL.") from exc
    return rows


def _primary_key_component(row: dict[str, Any], field: str) -> str:
    value = row[field]
    if value is None or isinstance(value, (dict, list)):
        raise KeyError(field)
    return str(value)


def _expected_artifact_path(record: dict[str, Any]) -> str | None:
    if record["schema"] == "public":
        return f"tables/{record['table']}.jsonl"
    if record["schema"] == "storage" and record["table"] == "objects":
        return "storage/avatar_objects.jsonl"
    return None


def load_export(input_dir: Path) -> ArtifactBundle:
    expected_root = {"manifest.json", "checksums.sha256", "tables", "storage"}
    try:
        entries = list(input_dir.iterdir())
    except OSError as exc:
        raise MigrationError("Input directory cannot be enumerated.") from exc
    names = {entry.name for entry in entries}
    if names != expected_root:
        raise MigrationError("Input directory does not have exactly the verified export structure.")
    for entry in entries:
        assert_not_symlink(entry)
    manifest_path = input_dir / "manifest.json"
    checksum_path = input_dir / "checksums.sha256"
    tables_dir = input_dir / "tables"
    storage_dir = input_dir / "storage"
    if not manifest_path.is_file() or not checksum_path.is_file() or not tables_dir.is_dir() or not storage_dir.is_dir():
        raise MigrationError("Input export entries have an unexpected filesystem type.")
    try:
        manifest_value = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise MigrationError("manifest.json cannot be parsed as UTF-8 JSON.") from exc
    if not isinstance(manifest_value, dict) or manifest_value.get("format_version") != FORMAT_VERSION:
        raise MigrationError("manifest.json has an unsupported format_version.")
    if manifest_value.get("checksum_algorithm") != "sha256" or manifest_value.get("checksum_index") != "checksums.sha256":
        raise MigrationError("manifest.json does not declare the supported SHA-256 checksum contract.")
    records_value = manifest_value.get("tables")
    if not isinstance(records_value, list):
        raise MigrationError("manifest.json does not contain a table-record list.")
    checksum_index = parse_checksum_index(checksum_path)
    records: dict[str, dict[str, Any]] = {}
    declared_paths: set[str] = set()
    for record in records_value:
        if not isinstance(record, dict):
            raise MigrationError("manifest.json contains an invalid table record.")
        schema = record.get("schema")
        table = record.get("table")
        status = record.get("status")
        if not isinstance(schema, str) or not isinstance(table, str) or status not in {"exported", "skipped"}:
            raise MigrationError("manifest.json contains an invalid table-record identity or status.")
        key = f"{schema}.{table}"
        if key in records:
            raise MigrationError("manifest.json contains duplicate table records.")
        expected_path = _expected_artifact_path(record)
        if expected_path is None or (schema == "public" and table not in PUBLIC_ALLOWED):
            raise MigrationError("manifest.json declares a table outside the supported exporter allowlist.")
        if status == "exported":
            primary_key = record.get("primary_key")
            if record.get("artifact") != expected_path or not isinstance(record.get("sha256"), str) or not isinstance(record.get("row_count"), int) or isinstance(record.get("row_count"), bool) or not isinstance(primary_key, list) or not primary_key or not all(isinstance(item, str) and SAFE_IDENTIFIER.fullmatch(item) for item in primary_key):
                raise MigrationError("manifest.json has an invalid exported-artifact record.")
            if schema == "public" and tuple(primary_key) != MAPPING_BY_SOURCE[table].primary_key:
                raise MigrationError("manifest.json primary-key contract does not match the supported source table.")
            if expected_path in declared_paths:
                raise MigrationError("manifest.json declares duplicate artifact paths.")
            declared_paths.add(expected_path)
        elif "reason" not in record or record.get("artifact") is not None:
            raise MigrationError("manifest.json has an invalid skipped-artifact record.")
        records[key] = record
    expected_record_keys = {f"public.{name}" for name, _ in PUBLIC_TABLES} | {"storage.objects"}
    if set(records) != expected_record_keys:
        raise MigrationError("manifest.json does not declare exactly the supported export domains.")
    for required_table in PUBLIC_REQUIRED:
        if records[f"public.{required_table}"].get("status") != "exported":
            raise MigrationError(f"Required source table {required_table} was not exported.")
    checksum_expected = {"manifest.json", *declared_paths}
    if set(checksum_index) != checksum_expected:
        raise MigrationError("checksums.sha256 does not match the manifest artifact set.")
    if checksum_index["manifest.json"] != sha256_file(manifest_path):
        raise MigrationError("manifest.json SHA-256 verification failed.")
    rows: dict[str, list[dict[str, Any]]] = {}
    avatar_rows: list[dict[str, Any]] | None = None
    collector = Collector()
    for key, record in records.items():
        if record["status"] == "skipped":
            continue
        relative_path = record["artifact"]
        artifact_path = input_dir / relative_path
        if not artifact_path.is_file() or artifact_path.is_symlink():
            raise MigrationError("A declared export artifact is missing or has an unsafe filesystem type.")
        expected_hash = record["sha256"]
        if checksum_index[relative_path] != expected_hash or sha256_file(artifact_path) != expected_hash:
            raise MigrationError("An export artifact SHA-256 verification failed.")
        if key == "storage.objects":
            parsed_rows = parse_jsonl(artifact_path, "avatar_objects", ("bucket", "object_key"), collector)
            avatar_rows = parsed_rows
        else:
            parsed_rows = parse_jsonl(artifact_path, record["table"], tuple(record.get("primary_key", ())), collector)
            rows[record["table"]] = parsed_rows
        if len(parsed_rows) != record["row_count"]:
            collector.add(record["table"], "manifest_row_count_mismatch")
    # Directories must contain exactly declared, flat JSONL artifacts; this also
    # rejects undeclared extras and nested paths.
    actual_paths: set[str] = set()
    for parent, prefix in ((tables_dir, "tables"), (storage_dir, "storage")):
        for entry in parent.iterdir():
            assert_not_symlink(entry)
            if not entry.is_file() or entry.suffix != ".jsonl":
                raise MigrationError("Export artifact directories may contain only declared JSONL files.")
            actual_paths.add(f"{prefix}/{entry.name}")
    if actual_paths != declared_paths:
        raise MigrationError("Artifact files do not exactly match manifest declarations.")
    collector.require_clean("Artifact parsing")
    return ArtifactBundle(input_dir, manifest_value, records, rows, avatar_rows)


def as_uuid(value: Any, domain: str, row: int, field_name: str, collector: Collector) -> UUID | None:
    if value is None:
        return None
    if not isinstance(value, str):
        collector.add(domain, "uuid_type", row=row, field=field_name)
        return None
    try:
        return UUID(value)
    except (ValueError, AttributeError):
        collector.add(domain, "uuid_invalid", row=row, field=field_name)
        return None


def as_timestamp(value: Any, domain: str, row: int, field_name: str, collector: Collector) -> datetime | None:
    if value is None:
        return None
    if not isinstance(value, str):
        collector.add(domain, "timestamp_type", row=row, field=field_name)
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        collector.add(domain, "timestamp_invalid", row=row, field=field_name)
        return None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        collector.add(domain, "timestamp_timezone_required", row=row, field=field_name)
        return None
    return parsed


def as_date(value: Any, domain: str, row: int, field_name: str, collector: Collector) -> date | None:
    if value is None:
        return None
    if not isinstance(value, str):
        collector.add(domain, "date_type", row=row, field=field_name)
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        collector.add(domain, "date_invalid", row=row, field=field_name)
        return None


def as_decimal(value: Any, domain: str, row: int, field_name: str, collector: Collector) -> Decimal | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (str, int, float, Decimal)):
        collector.add(domain, "numeric_type", row=row, field=field_name)
        return None
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, ValueError):
        collector.add(domain, "numeric_invalid", row=row, field=field_name)
        return None
    if not parsed.is_finite():
        collector.add(domain, "numeric_non_finite", row=row, field=field_name)
        return None
    return parsed


def as_integer(value: Any, domain: str, row: int, field_name: str, collector: Collector) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        collector.add(domain, "integer_type", row=row, field=field_name)
        return None
    return value


def as_boolean(value: Any, domain: str, row: int, field_name: str, collector: Collector) -> bool | None:
    if value is None:
        return None
    if not isinstance(value, bool):
        collector.add(domain, "boolean_type", row=row, field=field_name)
        return None
    return value


def as_json(value: Any, expected: type, domain: str, row: int, field_name: str, collector: Collector) -> Any:
    if value is None:
        return None
    if not isinstance(value, expected):
        collector.add(domain, "json_shape", row=row, field=field_name)
        return None
    try:
        json.dumps(value, allow_nan=False, separators=(",", ":"))
    except (TypeError, ValueError):
        collector.add(domain, "json_invalid", row=row, field=field_name)
        return None
    return value


def convert_field(value: Any, field_name: str, domain: str, row: int, collector: Collector) -> Any:
    if field_name in UUID_FIELDS:
        return as_uuid(value, domain, row, field_name, collector)
    if field_name in TIMESTAMP_FIELDS:
        return as_timestamp(value, domain, row, field_name, collector)
    if field_name in DATE_FIELDS:
        return as_date(value, domain, row, field_name, collector)
    if field_name in DECIMAL_FIELDS:
        return as_decimal(value, domain, row, field_name, collector)
    if field_name in INTEGER_FIELDS:
        return as_integer(value, domain, row, field_name, collector)
    if field_name in BOOLEAN_FIELDS:
        return as_boolean(value, domain, row, field_name, collector)
    if field_name in JSON_OBJECT_FIELDS:
        return as_json(value, dict, domain, row, field_name, collector)
    if field_name in JSON_ARRAY_FIELDS:
        return as_json(value, list, domain, row, field_name, collector)
    if value is not None and not isinstance(value, str):
        collector.add(domain, "text_type", row=row, field=field_name)
        return None
    return value


def validate_constraints(domain: str, row: dict[str, Any], row_number: int, collector: Collector) -> None:
    for field_name in REQUIRED_COLUMNS.get(domain, set()):
        if row.get(field_name) is None:
            collector.add(domain, "required_target_value_missing", row=row_number, field=field_name)
    for field_name in NOT_BLANK_FIELDS.get(domain, set()):
        value = row.get(field_name)
        if not isinstance(value, str) or not value.strip():
            collector.add(domain, "check_value", row=row_number, field=field_name)
    for (enum_domain, field_name), allowed in ENUMS.items():
        if enum_domain == domain and row.get(field_name) is not None and row[field_name] not in allowed:
            collector.add(domain, "enum_value", row=row_number, field=field_name)
    def positive(*fields: str, allow_zero: bool = False) -> None:
        for field_name in fields:
            value = row.get(field_name)
            if value is not None and value < (0 if allow_zero else 1):
                collector.add(domain, "check_value", row=row_number, field=field_name)
    if domain == "profiles":
        if row.get("about") is not None and len(row["about"]) > 200:
            collector.add(domain, "check_value", row=row_number, field="about")
    elif domain == "invites":
        positive("max_uses")
        positive("used_count", allow_zero=True)
        if row.get("max_uses") is not None and row.get("used_count") is not None and row["used_count"] > row["max_uses"]:
            collector.add(domain, "check_value", row=row_number, field="used_count")
    elif domain == "events":
        positive("capacity")
        positive("price_amount", allow_zero=True)
        if row.get("ends_at") is not None and row.get("starts_at") is not None and row["ends_at"] <= row["starts_at"]:
            collector.add(domain, "check_value", row=row_number, field="ends_at")
    elif domain == "event_occurrences":
        positive("capacity")
        if row.get("ends_at") is not None and row.get("starts_at") is not None and row["ends_at"] <= row["starts_at"]:
            collector.add(domain, "check_value", row=row_number, field="ends_at")
        if row.get("registration_closes_at") is not None and row.get("registration_opens_at") is not None and row["registration_closes_at"] <= row["registration_opens_at"]:
            collector.add(domain, "check_value", row=row_number, field="registration_closes_at")
    elif domain == "event_participation_options":
        positive("price_amount", allow_zero=True)
        positive("seat_limit")
        positive("min_quantity", "max_quantity")
        if row.get("min_quantity") is not None and row.get("max_quantity") is not None and row["max_quantity"] < row["min_quantity"]:
            collector.add(domain, "check_value", row=row_number, field="max_quantity")
        if row.get("allow_quantity") is False and (row.get("min_quantity") != 1 or row.get("max_quantity") != 1):
            collector.add(domain, "check_value", row=row_number, field="allow_quantity")
    elif domain in {"event_capacity_units", "event_participation_option_capacity_units", "event_registration_capacity_reservations"}:
        positive("capacity", "seats_per_quantity", "quantity", "seats_count")
    elif domain == "event_registrations":
        positive("seats_count")
    elif domain == "event_registration_option_selections":
        positive("quantity")
        positive("unit_price_amount", "total_amount", "seats_count", allow_zero=True)
    elif domain == "event_seating_tables":
        positive("w", "h")
        if row.get("angle") not in {0, 90, 180, 270}:
            collector.add(domain, "check_value", row=row_number, field="angle")
        if row.get("long_side_seats") not in {2, 3}:
            collector.add(domain, "check_value", row=row_number, field="long_side_seats")
    elif domain == "event_seating_assignments":
        if row.get("assignment_type") == "reserve" and row.get("registration_id") is not None:
            collector.add(domain, "check_value", row=row_number, field="registration_id")
    elif domain == "prayer_activity_logs":
        if row.get("started_at") is None and row.get("completed_at") is None:
            collector.add(domain, "check_value", row=row_number, field="started_at")
    elif domain == "event_import_runs":
        positive("found_count", "parsed_count", "created_count", "updated_count", allow_zero=True)
    elif domain == "admin_feedback":
        for field_name, maximum in (("section", 80), ("entity_type", 80), ("message", 4000), ("user_agent", 500), ("url", 1000)):
            if row.get(field_name) is not None and len(row[field_name]) > maximum:
                collector.add(domain, "check_value", row=row_number, field=field_name)


def map_special_row(source_table: str, source: dict[str, Any], row_number: int, source_rows: dict[str, list[dict[str, Any]]], collector: Collector) -> dict[str, Any] | None:
    if source_table == "event_import_sources":
        if set(source) - IMPORT_SOURCE_FIELDS:
            collector.add(source_table, "unsupported_source_column", row=row_number)
        required = {"id", "community_id", "name", "source_type", "url", "parser_name", "is_active", "created_at"}
        for field_name in required - set(source):
            collector.add(source_table, "required_field_missing", row=row_number, field=field_name)
        parser_name = source.get("parser_name")
        if not isinstance(parser_name, str) or not IMPORT_KEY.fullmatch(parser_name):
            collector.add(source_table, "unsupported_target_key_mapping", row=row_number, field="parser_name")
        legacy_settings: dict[str, Any] = {"legacy_parser_name": parser_name} if isinstance(parser_name, str) else {}
        if source.get("last_run_at") is not None:
            parsed_last_run = as_timestamp(source["last_run_at"], source_table, row_number, "last_run_at", collector)
            if parsed_last_run is not None:
                legacy_settings["legacy_last_run_at"] = parsed_last_run.isoformat()
        target = {
            "id": convert_field(source.get("id"), "id", source_table, row_number, collector),
            "community_id": convert_field(source.get("community_id"), "community_id", source_table, row_number, collector),
            "key": convert_field(parser_name, "key", source_table, row_number, collector),
            "title": convert_field(source.get("name"), "title", source_table, row_number, collector),
            "source_type": convert_field(source.get("source_type"), "source_type", source_table, row_number, collector),
            "source_url": convert_field(source.get("url"), "source_url", source_table, row_number, collector),
            "settings": legacy_settings,
            "is_active": convert_field(source.get("is_active"), "is_active", source_table, row_number, collector),
            "created_at": convert_field(source.get("created_at"), "created_at", source_table, row_number, collector),
        }
        return target
    if source_table == "event_import_runs":
        if set(source) - IMPORT_RUN_FIELDS:
            collector.add(source_table, "unsupported_source_column", row=row_number)
        required = {"id", "source_id", "status", "started_at", "found_count", "created_count", "updated_count"}
        for field_name in required - set(source):
            collector.add(source_table, "required_field_missing", row=row_number, field=field_name)
        source_by_id = {str(entry.get("id")): entry for entry in source_rows.get("event_import_sources", [])}
        source_parent = source_by_id.get(str(source.get("source_id")))
        if source_parent is None:
            collector.add(source_table, "missing_source_reference", row=row_number, field="source_id")
            community_id: Any = None
        else:
            community_id = source_parent.get("community_id")
        return {
            "id": convert_field(source.get("id"), "id", source_table, row_number, collector),
            "source_id": convert_field(source.get("source_id"), "source_id", source_table, row_number, collector),
            "community_id": convert_field(community_id, "community_id", source_table, row_number, collector),
            "mode": "apply_review_only",
            "status": source.get("status"),
            "started_at": convert_field(source.get("started_at"), "started_at", source_table, row_number, collector),
            "finished_at": convert_field(source.get("finished_at"), "finished_at", source_table, row_number, collector),
            "found_count": convert_field(source.get("found_count"), "found_count", source_table, row_number, collector),
            "parsed_count": None,
            "created_count": convert_field(source.get("created_count"), "created_count", source_table, row_number, collector),
            "updated_count": convert_field(source.get("updated_count"), "updated_count", source_table, row_number, collector),
            "error": source.get("error"),
            "summary": {},
            "parser_metadata": {},
            "debug_metadata": {},
        }
    if source_table == "event_import_items":
        if set(source) - IMPORT_ITEM_FIELDS:
            collector.add(source_table, "unsupported_source_column", row=row_number)
        required = {"id", "source_id", "run_id", "raw_payload", "status", "created_at"}
        for field_name in required - set(source):
            collector.add(source_table, "required_field_missing", row=row_number, field=field_name)
        if source.get("run_id") is None:
            collector.add(source_table, "unsupported_target_null_run", row=row_number, field="run_id")
        return {
            "id": convert_field(source.get("id"), "id", source_table, row_number, collector),
            "run_id": convert_field(source.get("run_id"), "run_id", source_table, row_number, collector),
            "source_id": convert_field(source.get("source_id"), "source_id", source_table, row_number, collector),
            "external_id": source.get("external_id"),
            "source_url": source.get("source_url"),
            "raw_payload": convert_field(source.get("raw_payload"), "raw_payload", source_table, row_number, collector),
            "parsed_title": source.get("parsed_title"),
            "parsed_starts_at": convert_field(source.get("parsed_starts_at"), "parsed_starts_at", source_table, row_number, collector),
            "parsed_location": source.get("parsed_location"),
            "linked_event_id": convert_field(source.get("linked_event_id"), "linked_event_id", source_table, row_number, collector),
            "status": source.get("status"),
            "created_at": convert_field(source.get("created_at"), "created_at", source_table, row_number, collector),
        }
    raise AssertionError(f"No special mapper for {source_table}")


def map_direct_row(mapping: Mapping, source: dict[str, Any], row_number: int, collector: Collector) -> dict[str, Any]:
    allowed = set(mapping.columns) | set(mapping.ignored_source_columns)
    unexpected = set(source) - allowed
    if unexpected:
        collector.add(mapping.source_table, "unsupported_source_column", row=row_number)
    target: dict[str, Any] = {}
    for field_name in mapping.columns:
        if field_name not in source:
            collector.add(mapping.source_table, "required_field_missing", row=row_number, field=field_name)
            continue
        target[field_name] = convert_field(source[field_name], field_name, mapping.source_table, row_number, collector)
    if mapping.source_table == "profiles" and "id" in target:
        # Supabase public profiles use auth UUID as id.  The API keeps that
        # UUID both as profile id and as app_users.id/user_id.
        target["user_id"] = target["id"]
    return target


def is_valid_phone(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    digits = re.sub(r"\D", "", value)
    return 7 <= len(digits) <= 15 and all(character.isdigit() or character in "+-() ." for character in value)


def build_identities(source_rows: dict[str, list[dict[str, Any]]], collector: Collector, report: dict[str, Any]) -> list[dict[str, Any]]:
    candidates: set[UUID] = set()
    profiles_by_id: dict[UUID, dict[str, Any]] = {}
    for table_name, rows in source_rows.items():
        for row_number, row in enumerate(rows, start=1):
            for field_name in USER_REFERENCE_FIELDS.get(table_name, set()):
                raw = row.get(field_name)
                if raw is not None:
                    parsed = as_uuid(raw, table_name, row_number, field_name, collector)
                    if parsed is not None:
                        candidates.add(parsed)
            if table_name == "profiles":
                profile_id = as_uuid(row.get("id"), table_name, row_number, "id", collector)
                if profile_id is not None:
                    profiles_by_id[profile_id] = row
    identities: list[dict[str, Any]] = []
    email_owners: dict[str, UUID] = {}
    phone_owners: dict[str, UUID] = {}
    invalid_email_count = 0
    invalid_phone_count = 0
    for user_id in sorted(candidates, key=str):
        profile = profiles_by_id.get(user_id)
        email_value: str | None = None
        phone_value: str | None = None
        created_at: datetime | None = None
        updated_at: datetime | None = None
        if profile is not None:
            raw_email = profile.get("email")
            raw_phone = profile.get("phone")
            if raw_email is not None:
                if isinstance(raw_email, str) and EMAIL.fullmatch(raw_email):
                    email_value = raw_email
                else:
                    invalid_email_count += 1
            if raw_phone is not None:
                if is_valid_phone(raw_phone):
                    phone_value = raw_phone
                else:
                    invalid_phone_count += 1
            created_at = as_timestamp(profile.get("created_at"), "profiles", 0, "created_at", collector)
            updated_at = as_timestamp(profile.get("updated_at"), "profiles", 0, "updated_at", collector)
        if email_value is not None:
            normalized_email = email_value.casefold()
            existing = email_owners.setdefault(normalized_email, user_id)
            if existing != user_id:
                collector.add("app_users", "source_unique_email_conflict")
        if phone_value is not None:
            existing = phone_owners.setdefault(phone_value, user_id)
            if existing != user_id:
                collector.add("app_users", "source_unique_phone_conflict")
        identity: dict[str, Any] = {
            "id": user_id,
            "email": email_value,
            "phone": phone_value,
            "password_hash": None,
            "status": "active",
        }
        if created_at is not None:
            identity["created_at"] = created_at
        if updated_at is not None:
            identity["updated_at"] = updated_at
        identities.append(identity)
    report["identity"] = {
        "candidate_user_count": len(candidates),
        "missing_profile_count": len(candidates - set(profiles_by_id)),
        "invalid_profile_email_omitted_count": invalid_email_count,
        "invalid_profile_phone_omitted_count": invalid_phone_count,
        "password_hash_imported_count": 0,
        "oauth_identity_imported_count": 0,
    }
    return identities


def add_domain_report(report: dict[str, Any], domain: str, *, source_count: int, status: str, planned: int = 0) -> None:
    report["domains"][domain] = {
        "source_count": source_count,
        "planned_target_count": planned,
        "insert_count": 0,
        "update_count": 0,
        "unchanged_count": 0,
        "skip_count": 0,
        "conflict_count": 0,
        "missing_reference_count": 0,
        "status": status,
    }


def build_import_plan(bundle: ArtifactBundle) -> ImportPlan:
    collector = Collector()
    report: dict[str, Any] = {
        "format_version": FORMAT_VERSION,
        "domains": {},
        "identity": {},
        "avatar": {"status": "not_exported", "source_count": 0, "target_count": 0},
        "safe_problem_count": 0,
        "safe_problems": [],
    }
    add_domain_report(report, "privacy_requests", source_count=0, status="not_exported_by_pr324")
    report["domains"]["privacy_requests"]["skip_count"] = 1
    source_rows = bundle.rows
    domains: list[PreparedDomain] = []
    for mapping in MAPPINGS:
        record = bundle.records[f"public.{mapping.source_table}"]
        if record["status"] == "skipped":
            add_domain_report(report, mapping.source_table, source_count=0, status="skipped_source")
            report["domains"][mapping.source_table]["skip_count"] = 1
            domains.append(PreparedDomain(mapping, "skipped", [], 0))
            continue
        source = source_rows.get(mapping.source_table, [])
        mapped_rows: list[dict[str, Any]] = []
        for row_number, row in enumerate(source, start=1):
            if mapping.columns:
                mapped = map_direct_row(mapping, row, row_number, collector)
            else:
                mapped = map_special_row(mapping.source_table, row, row_number, source_rows, collector)
            if mapped is not None:
                validate_constraints(mapping.target_table, mapped, row_number, collector)
                mapped_rows.append(mapped)
        mapped_rows.sort(key=lambda item: str(item.get(mapping.primary_key[0], "")))
        add_domain_report(report, mapping.source_table, source_count=len(source), status="ready", planned=len(mapped_rows))
        domains.append(PreparedDomain(mapping, "ready", mapped_rows, len(source)))
    identities = build_identities(source_rows, collector, report)
    add_domain_report(report, "app_users", source_count=len(identities), status="ready", planned=len(identities))
    validate_unique_keys(domains, identities, collector)
    validate_foreign_keys(domains, identities, collector, report)
    validate_avatar_rows(bundle.avatar_rows, identities, collector, report)
    report["safe_problem_count"] = len(collector.problems)
    report["safe_problems"] = [problem.compact() for problem in collector.problems]
    return ImportPlan(domains, identities, bundle.avatar_rows, collector, report)


def validate_unique_keys(domains: list[PreparedDomain], identities: list[dict[str, Any]], collector: Collector) -> None:
    rows_by_target = {domain.mapping.target_table: domain.rows for domain in domains if domain.status == "ready"}
    rows_by_target["app_users"] = identities
    for table_name, keys in UNIQUE_KEYS.items():
        for fields in keys:
            seen: set[tuple[str, ...]] = set()
            for row in rows_by_target.get(table_name, []):
                values = tuple(row.get(field_name) for field_name in fields)
                if any(value is None for value in values):
                    continue
                key = tuple(str(value).casefold() if field_name == "email" else str(value) for field_name, value in zip(fields, values))
                if key in seen:
                    collector.add(table_name, "source_unique_constraint_conflict")
                seen.add(key)


def validate_foreign_keys(domains: list[PreparedDomain], identities: list[dict[str, Any]], collector: Collector, report: dict[str, Any]) -> None:
    rows_by_target = {domain.mapping.target_table: domain.rows for domain in domains if domain.status == "ready"}
    rows_by_target["app_users"] = identities
    ids: dict[str, set[UUID]] = {}
    for table_name, rows in rows_by_target.items():
        primary = "user_id" if table_name == "profile_contact_visibility" else "id"
        ids[table_name] = {row[primary] for row in rows if isinstance(row.get(primary), UUID)}
    refs = (
        ("profiles", "user_id", "app_users"), ("profiles", "community_id", "communities"),
        ("community_memberships", "community_id", "communities"), ("community_memberships", "user_id", "app_users"), ("community_memberships", "invited_by", "app_users"),
        ("invites", "community_id", "communities"), ("invites", "created_by", "app_users"), ("invites", "accepted_by", "app_users"),
        ("event_categories", "community_id", "communities"), ("event_categories", "created_by", "app_users"), ("event_categories", "updated_by", "app_users"),
        ("community_event_locations", "community_id", "communities"),
        ("events", "community_id", "communities"), ("events", "created_by", "app_users"), ("events", "updated_by", "app_users"),
        ("event_occurrences", "event_id", "events"),
        ("event_participation_options", "event_id", "events"), ("event_capacity_units", "event_id", "events"),
        ("event_participation_option_capacity_units", "event_id", "events"), ("event_participation_option_capacity_units", "option_id", "event_participation_options"), ("event_participation_option_capacity_units", "capacity_unit_id", "event_capacity_units"),
        ("event_registrations", "event_id", "events"), ("event_registrations", "user_id", "app_users"), ("event_registrations", "occurrence_id", "event_occurrences"),
        ("event_registration_option_selections", "registration_id", "event_registrations"), ("event_registration_option_selections", "option_id", "event_participation_options"),
        ("event_registration_capacity_reservations", "registration_id", "event_registrations"), ("event_registration_capacity_reservations", "event_id", "events"), ("event_registration_capacity_reservations", "occurrence_id", "event_occurrences"), ("event_registration_capacity_reservations", "capacity_unit_id", "event_capacity_units"), ("event_registration_capacity_reservations", "option_id", "event_participation_options"),
        ("profile_contact_visibility", "user_id", "app_users"), ("synced_contacts", "user_id", "app_users"), ("admin_feedback", "community_id", "communities"), ("admin_feedback", "user_id", "app_users"), ("admin_feedback", "resolved_by", "app_users"),
        ("device_tokens", "user_id", "app_users"), ("prayer_activity_logs", "user_id", "app_users"),
        ("event_seating_layout_templates", "community_id", "communities"), ("event_seating_layout_templates", "created_by", "app_users"),
        ("event_seating_layouts", "community_id", "communities"), ("event_seating_layouts", "event_id", "events"), ("event_seating_layouts", "occurrence_id", "event_occurrences"), ("event_seating_layouts", "capacity_unit_id", "event_capacity_units"), ("event_seating_layouts", "template_id", "event_seating_layout_templates"), ("event_seating_layouts", "created_by", "app_users"),
        ("event_seating_tables", "layout_id", "event_seating_layouts"), ("event_seating_table_connections", "layout_id", "event_seating_layouts"),
        ("event_seating_assignments", "layout_id", "event_seating_layouts"), ("event_seating_assignments", "registration_id", "event_registrations"),
        ("push_notification_jobs", "community_id", "communities"), ("push_notification_jobs", "created_by", "app_users"), ("push_notification_jobs", "event_id", "events"), ("push_notification_jobs", "occurrence_id", "event_occurrences"), ("push_notification_jobs", "registration_id", "event_registrations"), ("push_notification_jobs", "target_user_id", "app_users"),
        ("push_notification_deliveries", "job_id", "push_notification_jobs"), ("push_notification_deliveries", "user_id", "app_users"), ("push_notification_deliveries", "device_token_id", "device_tokens"),
        ("event_import_sources", "community_id", "communities"), ("event_import_runs", "source_id", "event_import_sources"), ("event_import_items", "run_id", "event_import_runs"), ("event_import_items", "source_id", "event_import_sources"), ("event_import_items", "linked_event_id", "events"),
    )
    missing_by_domain: defaultdict[str, int] = defaultdict(int)
    for child, field_name, parent in refs:
        for row in rows_by_target.get(child, []):
            value = row.get(field_name)
            if value is not None and value not in ids.get(parent, set()):
                collector.add(child, "missing_parent_reference", field=field_name)
                missing_by_domain[child] += 1
    categories = {(row.get("community_id"), row.get("slug")) for row in rows_by_target.get("event_categories", [])}
    for row in rows_by_target.get("events", []):
        if (row.get("community_id"), row.get("category")) not in categories:
            collector.add("events", "missing_category_reference", field="category")
            missing_by_domain["events"] += 1
    option_events = {row.get("id"): row.get("event_id") for row in rows_by_target.get("event_participation_options", [])}
    unit_events = {row.get("id"): row.get("event_id") for row in rows_by_target.get("event_capacity_units", [])}
    for child in ("event_participation_option_capacity_units", "event_registration_capacity_reservations", "event_seating_layouts"):
        for row in rows_by_target.get(child, []):
            event_id = row.get("event_id")
            for field_name, lookup in (("option_id", option_events), ("capacity_unit_id", unit_events)):
                value = row.get(field_name)
                if value is not None and lookup.get(value) != event_id:
                    collector.add(child, "composite_foreign_key_mismatch", field=field_name)
                    missing_by_domain[child] += 1
    run_sources = {row.get("id"): row.get("source_id") for row in rows_by_target.get("event_import_runs", [])}
    for row in rows_by_target.get("event_import_items", []):
        if run_sources.get(row.get("run_id")) != row.get("source_id"):
            collector.add("event_import_items", "composite_foreign_key_mismatch", field="source_id")
            missing_by_domain["event_import_items"] += 1
    table_pairs = {(row.get("layout_id"), row.get("client_table_id")) for row in rows_by_target.get("event_seating_tables", [])}
    for row in rows_by_target.get("event_seating_table_connections", []):
        for field_name in ("from_client_table_id", "to_client_table_id"):
            if (row.get("layout_id"), row.get(field_name)) not in table_pairs:
                collector.add("event_seating_table_connections", "missing_parent_reference", field=field_name)
                missing_by_domain["event_seating_table_connections"] += 1
    for domain, count in missing_by_domain.items():
        report["domains"][domain]["missing_reference_count"] = count


def validate_avatar_rows(avatar_rows: list[dict[str, Any]] | None, identities: list[dict[str, Any]], collector: Collector, report: dict[str, Any]) -> None:
    if avatar_rows is None:
        report["avatar"] = {"status": "skipped_source", "source_count": 0, "target_count": 0}
        return
    user_ids = {row["id"] for row in identities}
    missing_profile_links = 0
    for row_number, row in enumerate(avatar_rows, start=1):
        allowed = {"bucket", "object_key", "owner_id", "content_type", "size_bytes", "created_at", "updated_at", "profile_id", "source_metadata"}
        if set(row) - allowed:
            collector.add("avatar_objects", "unsupported_source_column", row=row_number)
        if row.get("bucket") != "avatars" or not isinstance(row.get("object_key"), str) or not row.get("object_key"):
            collector.add("avatar_objects", "avatar_metadata_invalid", row=row_number)
        profile_id = as_uuid(row.get("profile_id"), "avatar_objects", row_number, "profile_id", collector) if row.get("profile_id") is not None else None
        if profile_id is not None and profile_id not in user_ids:
            missing_profile_links += 1
            collector.add("avatar_objects", "missing_profile_reference", row=row_number, field="profile_id")
    report["avatar"] = {
        "status": "pending_storage_migration",
        "source_count": len(avatar_rows),
        "target_count": 0,
        "missing_profile_link_count": missing_profile_links,
        "object_upload_count": 0,
        "metadata_write_count": 0,
    }


def validate_owner_environment(allow_hosted: bool) -> str:
    value = os.environ.get(DATABASE_ENV)
    if not value:
        raise MigrationError(f"{DATABASE_ENV} is required; this utility has no default database URL.")
    if os.environ.get(ACK_ENV) != ACKNOWLEDGEMENT:
        raise MigrationError(f"{ACK_ENV} must exactly equal {ACKNOWLEDGEMENT}.")
    parsed = urlsplit(value)
    if parsed.scheme not in {"postgres", "postgresql", "postgresql+asyncpg"} or not parsed.hostname:
        raise MigrationError(f"{DATABASE_ENV} must be a PostgreSQL URL.")
    hostname = parsed.hostname.lower()
    hosted = hostname not in LOCAL_HOSTS and not hostname.endswith(".local")
    if hosted and not allow_hosted:
        raise MigrationError("Target is not clearly local; a separately authorized owner command must add --allow-hosted-with-owner-command.")
    return value


def asyncpg_url(database_url: str) -> str:
    if database_url.startswith("postgresql+asyncpg://"):
        return "postgresql://" + database_url[len("postgresql+asyncpg://"):]
    return database_url


async def connect_database(database_url: str):
    try:
        import asyncpg
    except ImportError as exc:
        raise MigrationError("asyncpg is required by the API Python environment to connect to PostgreSQL.") from exc
    try:
        connection = await asyncpg.connect(asyncpg_url(database_url), server_settings={"application_name": "sredi-svoih-api-migration-import"})
        await connection.set_type_codec("json", schema="pg_catalog", encoder=lambda value: json.dumps(value, allow_nan=False), decoder=json.loads, format="text")
        await connection.set_type_codec("jsonb", schema="pg_catalog", encoder=lambda value: json.dumps(value, allow_nan=False), decoder=json.loads, format="text")
        return connection
    except Exception as exc:
        raise MigrationError("Target database connection failed without exposing connection details.") from exc


def target_types_for(field_name: str) -> set[str]:
    if field_name in UUID_FIELDS:
        return {"uuid"}
    if field_name in TIMESTAMP_FIELDS:
        return {"timestamptz"}
    if field_name in DATE_FIELDS:
        return {"date"}
    if field_name in DECIMAL_FIELDS:
        return {"numeric"}
    if field_name in INTEGER_FIELDS:
        return {"int4", "int8"}
    if field_name in BOOLEAN_FIELDS:
        return {"bool"}
    if field_name in JSON_OBJECT_FIELDS | JSON_ARRAY_FIELDS:
        return {"jsonb"}
    return {"text"}


async def verify_target_schema(connection: Any, plan: ImportPlan) -> None:
    target_rows: dict[str, list[dict[str, Any]]] = {"app_users": plan.identities}
    target_rows.update({domain.mapping.target_table: domain.rows for domain in plan.domains if domain.status == "ready"})
    for table_name, rows in target_rows.items():
        if not rows:
            continue
        columns = sorted({column for row in rows for column in row})
        actual = await connection.fetch(
            "select column_name, udt_name from information_schema.columns where table_schema = 'public' and table_name = $1",
            table_name,
        )
        actual_by_name = {item["column_name"]: item["udt_name"] for item in actual}
        for column in columns:
            if column not in actual_by_name or actual_by_name[column] not in target_types_for(column):
                plan.collector.add(table_name, "target_schema_mismatch", field=column)
    plan.collector.require_clean("Target schema preflight")


def canonical_value(value: Any) -> str:
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, datetime):
        return value.astimezone().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, (dict, list)):
        return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str)
    return repr(value)


def rows_compatible(expected: dict[str, Any], actual: Any) -> bool:
    return all(canonical_value(actual[field_name]) == canonical_value(value) for field_name, value in expected.items())


async def existing_rows(connection: Any, table_name: str, primary_column: str, rows: list[dict[str, Any]]) -> dict[UUID, Any]:
    keys = [row[primary_column] for row in rows if isinstance(row.get(primary_column), UUID)]
    if not keys:
        return {}
    columns = sorted({column for row in rows for column in row})
    sql = f"select {', '.join(safe_identifier(column) for column in columns)} from {safe_identifier(table_name)} where {safe_identifier(primary_column)} = any($1::uuid[])"
    result = await connection.fetch(sql, keys)
    return {item[primary_column]: item for item in result}


async def preflight_existing_data(connection: Any, plan: ImportPlan, allow_existing: bool) -> None:
    target_entries: list[tuple[str, str, list[dict[str, Any]], str]] = [("app_users", "id", plan.identities, "app_users")]
    target_entries.extend((domain.mapping.target_table, domain.primary_column, domain.rows, domain.mapping.source_table) for domain in plan.domains if domain.status == "ready")
    for table_name, primary_column, rows, report_name in target_entries:
        if not rows:
            continue
        total = await connection.fetchval(f"select count(*) from {safe_identifier(table_name)}")
        matching = await existing_rows(connection, table_name, primary_column, rows)
        plan.report["domains"][report_name]["planned_insert_count"] = len(rows) - len(matching)
        plan.report["domains"][report_name]["planned_update_count"] = 0
        if total and not allow_existing:
            plan.collector.add(report_name, "existing_target_data")
            plan.report["domains"][report_name]["conflict_count"] += int(total)
            continue
        for row in rows:
            existing = matching.get(row[primary_column])
            if existing is None:
                continue
            if allow_existing and rows_compatible(row, existing):
                plan.report["domains"][report_name]["unchanged_count"] += 1
            else:
                plan.collector.add(report_name, "existing_target_conflict")
                plan.report["domains"][report_name]["conflict_count"] += 1
    await preflight_identity_uniques(connection, plan, allow_existing)
    plan.collector.require_clean("Target existing-data preflight")


async def preflight_identity_uniques(connection: Any, plan: ImportPlan, allow_existing: bool) -> None:
    emails = [row["email"].casefold() for row in plan.identities if row.get("email")]
    phones = [row["phone"] for row in plan.identities if row.get("phone")]
    expected_by_email = {row["email"].casefold(): row["id"] for row in plan.identities if row.get("email")}
    expected_by_phone = {row["phone"]: row["id"] for row in plan.identities if row.get("phone")}
    if emails:
        rows = await connection.fetch("select id, lower(email) as identity from app_users where lower(email) = any($1::text[])", emails)
        for row in rows:
            if expected_by_email.get(row["identity"]) != row["id"]:
                plan.collector.add("app_users", "target_unique_email_conflict")
                plan.report["domains"]["app_users"]["conflict_count"] += 1
    if phones:
        rows = await connection.fetch("select id, phone from app_users where phone = any($1::text[])", phones)
        for row in rows:
            if expected_by_phone.get(row["phone"]) != row["id"]:
                plan.collector.add("app_users", "target_unique_phone_conflict")
                plan.report["domains"]["app_users"]["conflict_count"] += 1


IMPORT_ORDER = (
    "communities", "app_users", "profiles", "community_memberships", "invites", "event_categories", "community_event_locations",
    "events", "event_occurrences", "event_participation_options", "event_capacity_units", "event_participation_option_capacity_units",
    "event_registrations", "event_registration_option_selections", "event_registration_capacity_reservations", "community_contacts",
    "profile_contact_visibility", "synced_contacts", "admin_feedback", "device_tokens", "prayer_activity_logs",
    "event_seating_layout_templates", "event_seating_layouts", "event_seating_tables", "event_seating_table_connections",
    "event_seating_assignments", "push_notification_jobs", "push_notification_deliveries", "event_import_sources",
    "event_import_runs", "event_import_items",
)


async def insert_rows(connection: Any, table_name: str, primary_column: str, rows: list[dict[str, Any]], plan: ImportPlan, report_name: str) -> None:
    if not rows:
        return
    existing = await existing_rows(connection, table_name, primary_column, rows)
    columns = sorted({column for row in rows for column in row})
    placeholders = ", ".join(f"${index}" for index in range(1, len(columns) + 1))
    sql = f"insert into {safe_identifier(table_name)} ({', '.join(safe_identifier(column) for column in columns)}) values ({placeholders}) on conflict ({safe_identifier(primary_column)}) do nothing returning {safe_identifier(primary_column)}"
    for row in rows:
        current = existing.get(row[primary_column])
        if current is not None:
            if rows_compatible(row, current):
                plan.report["domains"][report_name]["unchanged_count"] += 1
                continue
            plan.collector.add(report_name, "existing_target_conflict")
            plan.report["domains"][report_name]["conflict_count"] += 1
            plan.collector.require_clean("Apply preflight")
        inserted = await connection.fetchval(sql, *[row.get(column) for column in columns])
        if inserted is None:
            plan.collector.add(report_name, "concurrent_target_conflict")
            plan.report["domains"][report_name]["conflict_count"] += 1
            plan.collector.require_clean("Apply")
        plan.report["domains"][report_name]["insert_count"] += 1


async def apply_plan(connection: Any, plan: ImportPlan) -> None:
    domains_by_target = {domain.mapping.target_table: domain for domain in plan.domains if domain.status == "ready"}
    for target_table in IMPORT_ORDER:
        if target_table == "app_users":
            await insert_rows(connection, "app_users", "id", plan.identities, plan, "app_users")
            continue
        domain = domains_by_target.get(target_table)
        if domain is not None:
            await insert_rows(connection, domain.mapping.target_table, domain.primary_column, domain.rows, plan, domain.mapping.source_table)


def explicit_report_dir(path_value: str | None) -> Path | None:
    if path_value is None:
        return None
    path = Path(path_value).expanduser()
    try:
        if not path.is_dir() or path.is_symlink():
            raise MigrationError("--report-dir must be an existing real directory.")
        resolved = path.resolve()
    except OSError as exc:
        raise MigrationError("--report-dir cannot be inspected.") from exc
    try:
        resolved.relative_to(REPOSITORY_ROOT)
    except ValueError:
        return resolved
    raise MigrationError("--report-dir must be outside the repository so generated reports cannot be committed.")


def emit_report(report: dict[str, Any], report_dir: Path | None, stem: str) -> None:
    report["safe_problem_count"] = len(report.get("safe_problems", []))
    if report_dir is not None:
        filename = f"{stem}-{datetime.now().strftime('%Y%m%dT%H%M%S')}.json"
        destination = report_dir / filename
        try:
            destination.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        except OSError as exc:
            raise MigrationError("Aggregate migration report could not be written to --report-dir.") from exc
    print(json.dumps(report, ensure_ascii=False, sort_keys=True))


async def run_import(options: argparse.Namespace) -> dict[str, Any]:
    bundle = load_export(resolve_input_dir(options.input_dir))
    plan = build_import_plan(bundle)
    plan.collector.require_clean("Artifact and mapping validation")
    database_url = validate_owner_environment(options.allow_hosted_with_owner_command)
    connection = await connect_database(database_url)
    try:
        async with connection.transaction(isolation="repeatable_read", readonly=True):
            await verify_target_schema(connection, plan)
            await preflight_existing_data(connection, plan, options.allow_existing_data)
        if options.dry_run:
            plan.report["mode"] = "dry_run"
            plan.report["transaction"] = "read_only_preflight_no_writes"
            plan.report["outcome"] = "validated"
            return plan.report
        for domain_report in plan.report["domains"].values():
            domain_report["insert_count"] = 0
            domain_report["unchanged_count"] = 0
        async with connection.transaction(isolation="repeatable_read"):
            await apply_plan(connection, plan)
        plan.report["mode"] = "apply"
        plan.report["transaction"] = "single_transaction_committed"
        plan.report["outcome"] = "imported"
        return plan.report
    finally:
        await connection.close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Validate and optionally import a verified PR #324 export into API PostgreSQL.",
        epilog="No default mode writes. --help does not connect to PostgreSQL.",
    )
    parser.add_argument("--input-dir", required=True, help="Owner-controlled PR #324 export directory.")
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--dry-run", action="store_true", help="Validate artifacts and inspect the target in a read-only transaction.")
    modes.add_argument("--apply", action="store_true", help="Import in one transaction after all validation succeeds.")
    parser.add_argument("--allow-existing-data", action="store_true", help="Permit exact compatible rows already present by primary key; never overwrites rows.")
    parser.add_argument("--allow-hosted-with-owner-command", action="store_true", help="Required only after separate owner approval for a non-local target.")
    parser.add_argument("--report-dir", help="Existing owner-selected directory outside this repository for an aggregate JSON report.")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    options = parser.parse_args(argv)
    report_dir = explicit_report_dir(options.report_dir)
    try:
        report = asyncio.run(run_import(options))
        emit_report(report, report_dir, "api-postgres-import")
        return 0
    except MigrationError as exc:
        print(f"[error] {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("[error] Operation interrupted; no transaction was committed by this utility.", file=sys.stderr)
        return 1
    except Exception:
        print("[error] A filesystem or database operation failed without exposing source rows or credentials.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
