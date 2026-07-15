#!/usr/bin/env python3
"""Aggregate-only Supabase-to-API PostgreSQL shadow read comparison.

This owner-run utility deliberately has no project-settings imports and does
not load dotenv files.  It compares only approved aggregate data in two
repeatable-read, read-only PostgreSQL transactions.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlsplit


FORMAT_VERSION = "1.0.0"
ACK_ENV = "SHADOW_COMPARE_RUN_ACK"
ACKNOWLEDGEMENT = "LOCAL_OR_OWNER_APPROVED_SHADOW_COMPARE"
SOURCE_ENV = "SUPABASE_SHADOW_DATABASE_URL"
TARGET_ENV = "API_SHADOW_DATABASE_URL"
AVATAR_BUCKET = "avatars"
REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_REPORT_DIR = REPOSITORY_ROOT / ".migration-reports"
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "host.docker.internal"})


class ShadowCompareError(RuntimeError):
    """A safe-to-display shadow comparison failure."""


class DomainIncomplete(ShadowCompareError):
    """A domain cannot be compared without weakening the verification boundary."""


class SafeArgumentParser(argparse.ArgumentParser):
    """Avoid echoing owner-supplied option values, which may be sensitive paths."""

    def error(self, message: str) -> None:
        self.print_usage(sys.stderr)
        self.exit(2, "[error] Invalid command line options.\n")


@dataclass(frozen=True)
class ConnectionSettings:
    source_url: str
    target_url: str
    source_hosted: bool
    target_hosted: bool


# These are the only SQL statements issued by the comparison query layer.
# They are all static SELECT statements; values such as the avatar bucket are
# parameterized and never interpolated into SQL.
SCHEMA_SQL = """
select table_schema, table_name, column_name
from information_schema.columns
where (table_schema = 'public' and table_name = any($1::text[]))
   or (table_schema = 'storage' and table_name = 'objects')
"""

SQL: dict[str, str] = {
    "events_total": "select count(*)::bigint from public.events",
    "events_by_community": "select community_id, count(*)::bigint as row_count from public.events group by community_id",
    "events_by_status": "select status, count(*)::bigint as row_count from public.events group by status",
    "events_by_visibility": "select visibility, count(*)::bigint as row_count from public.events group by visibility",
    "events_by_kind": "select event_kind, count(*)::bigint as row_count from public.events group by event_kind",
    "occurrences_metrics": """
        select count(*)::bigint as total_count,
               count(*) filter (where registration_opens_at is not null or registration_closes_at is not null)::bigint as with_window_count,
               count(*) filter (where registration_opens_at is null and registration_closes_at is null)::bigint as without_window_count
        from public.event_occurrences
    """,
    "occurrences_by_event": "select event_id, count(*)::bigint as row_count from public.event_occurrences group by event_id",
    "occurrences_by_status": "select status, count(*)::bigint as row_count from public.event_occurrences group by status",
    "registrations_metrics": """
        select count(*)::bigint as total_count,
               coalesce(sum(seats_count), 0)::bigint as seats_count,
               (select count(distinct registration_id)::bigint from public.event_registration_option_selections) as with_option_selection_count,
               (select count(distinct registration_id)::bigint from public.event_registration_capacity_reservations) as with_capacity_reservation_count
        from public.event_registrations
    """,
    "registrations_by_status": "select status, count(*)::bigint as row_count from public.event_registrations group by status",
    "registrations_by_event_occurrence": """
        select event_id, occurrence_id, count(*)::bigint as row_count
        from public.event_registrations
        group by event_id, occurrence_id
    """,
    "memberships_metrics": """
        select count(*)::bigint as total_count,
               count(*) filter (where status = 'active')::bigint as active_membership_count
        from public.community_memberships
    """,
    "memberships_by_community": "select community_id, count(*)::bigint as row_count from public.community_memberships group by community_id",
    "memberships_by_role": "select role, count(*)::bigint as row_count from public.community_memberships group by role",
    "memberships_by_status": "select status, count(*)::bigint as row_count from public.community_memberships group by status",
    "capacity_buckets": """
        with bucket_keys as (
            select unit.event_id, occurrence.id as occurrence_id, unit.id as capacity_unit_id
            from public.event_capacity_units as unit
            left join public.event_occurrences as occurrence on occurrence.event_id = unit.event_id
            union
            select event_id, occurrence_id, capacity_unit_id
            from public.event_registration_capacity_reservations
        ), reservation_counts as (
            select event_id, occurrence_id, capacity_unit_id,
                   count(*)::bigint as reservation_count,
                   coalesce(sum(seats_count), 0)::bigint as occupied_seats,
                   count(distinct registration_id)::bigint as represented_registration_count
            from public.event_registration_capacity_reservations
            group by event_id, occurrence_id, capacity_unit_id
        )
        select bucket.event_id, bucket.occurrence_id, bucket.capacity_unit_id,
               coalesce(unit.capacity, 0)::bigint as configured_capacity,
               coalesce(reservation.reservation_count, 0)::bigint as reservation_count,
               coalesce(reservation.occupied_seats, 0)::bigint as occupied_seats,
               coalesce(reservation.represented_registration_count, 0)::bigint as represented_registration_count
        from bucket_keys as bucket
        left join public.event_capacity_units as unit
          on unit.id = bucket.capacity_unit_id and unit.event_id = bucket.event_id
        left join reservation_counts as reservation
          on reservation.event_id = bucket.event_id
         and reservation.capacity_unit_id = bucket.capacity_unit_id
         and reservation.occurrence_id is not distinct from bucket.occurrence_id
    """,
    "seating_templates_total": "select count(*)::bigint from public.event_seating_layout_templates",
    "seating_layouts_total": "select count(*)::bigint from public.event_seating_layouts",
    "seating_tables_total": "select count(*)::bigint from public.event_seating_tables",
    "seating_connections_total": "select count(*)::bigint from public.event_seating_table_connections",
    "seating_assignments_total": "select count(*)::bigint from public.event_seating_assignments",
    "seating_layouts_by_slot": """
        select event_id, occurrence_id, capacity_unit_id, count(*)::bigint as row_count
        from public.event_seating_layouts
        group by event_id, occurrence_id, capacity_unit_id
    """,
    "seating_tables_by_slot": """
        select layout.event_id, layout.occurrence_id, layout.capacity_unit_id, count(*)::bigint as row_count
        from public.event_seating_tables as item
        join public.event_seating_layouts as layout on layout.id = item.layout_id
        group by layout.event_id, layout.occurrence_id, layout.capacity_unit_id
    """,
    "seating_connections_by_slot": """
        select layout.event_id, layout.occurrence_id, layout.capacity_unit_id, count(*)::bigint as row_count
        from public.event_seating_table_connections as item
        join public.event_seating_layouts as layout on layout.id = item.layout_id
        group by layout.event_id, layout.occurrence_id, layout.capacity_unit_id
    """,
    "seating_assignments_by_slot": """
        select layout.event_id, layout.occurrence_id, layout.capacity_unit_id, count(*)::bigint as row_count
        from public.event_seating_assignments as item
        join public.event_seating_layouts as layout on layout.id = item.layout_id
        group by layout.event_id, layout.occurrence_id, layout.capacity_unit_id
    """,
    "prayer_metrics": "select count(*)::bigint as total_count, count(distinct user_id)::bigint as user_count from public.prayer_activity_logs",
    "prayer_by_user": "select user_id, count(*)::bigint as row_count from public.prayer_activity_logs group by user_id",
    "contacts_community_total": "select count(*)::bigint from public.community_contacts",
    "contacts_by_community": "select community_id, count(*)::bigint as row_count from public.community_contacts group by community_id",
    "visibility_metrics": """
        select count(*)::bigint as total_count,
               count(*) filter (where show_in_community_directory)::bigint as directory_true_count,
               count(*) filter (where share_phone)::bigint as phone_true_count,
               count(*) filter (where share_email)::bigint as email_true_count,
               count(*) filter (where share_birth_date)::bigint as birth_date_true_count,
               count(*) filter (where share_hebrew_birth_date)::bigint as hebrew_birth_date_true_count,
               count(*) filter (where share_city)::bigint as city_true_count,
               count(*) filter (where share_hebrew_name)::bigint as hebrew_name_true_count,
               count(*) filter (where birthday_reminders_enabled)::bigint as birthday_reminders_true_count
        from public.profile_contact_visibility
    """,
    "synced_contacts_metrics": "select count(*)::bigint as total_count from public.synced_contacts",
    "synced_contacts_by_user": "select user_id, count(*)::bigint as row_count from public.synced_contacts group by user_id",
    "source_avatar_metrics": """
        select count(*)::bigint as object_count,
               count(profile.id)::bigint as linked_public_profile_count
        from storage.objects as object_row
        left join public.profiles as profile
          on profile.id::text = split_part(object_row.name, '/', 1)
        where object_row.bucket_id = $1
    """,
    "target_avatar_metrics": """
        select (select count(*)::bigint from public.profile_avatars) as avatar_row_count,
               (select count(*) filter (where status = 'pending')::bigint from public.profile_avatars) as pending_count,
               (select count(*) filter (where status = 'active')::bigint from public.profile_avatars) as active_count,
               (select count(*) filter (where status = 'deleted')::bigint from public.profile_avatars) as deleted_count,
               (select count(*) filter (where avatar_id is not null)::bigint from public.profiles) as profile_avatar_count
    """,
    "device_tokens_total": "select count(*)::bigint from public.device_tokens",
    "device_tokens_by_active": "select is_active, count(*)::bigint as row_count from public.device_tokens group by is_active",
    "device_tokens_by_environment": "select environment, count(*)::bigint as row_count from public.device_tokens group by environment",
    "device_tokens_by_platform": "select platform, count(*)::bigint as row_count from public.device_tokens group by platform",
    "device_tokens_by_provider": "select push_provider, count(*)::bigint as row_count from public.device_tokens group by push_provider",
    "push_jobs_total": "select count(*)::bigint from public.push_notification_jobs",
    "push_jobs_by_status": "select status, count(*)::bigint as row_count from public.push_notification_jobs group by status",
    "push_jobs_by_kind": "select notification_kind, count(*)::bigint as row_count from public.push_notification_jobs group by notification_kind",
    "push_jobs_by_audience": "select audience, count(*)::bigint as row_count from public.push_notification_jobs group by audience",
}

PUBLIC_TABLES = (
    "events",
    "event_occurrences",
    "event_registrations",
    "event_registration_option_selections",
    "event_registration_capacity_reservations",
    "event_capacity_units",
    "community_memberships",
    "event_seating_layout_templates",
    "event_seating_layouts",
    "event_seating_tables",
    "event_seating_table_connections",
    "event_seating_assignments",
    "prayer_activity_logs",
    "community_contacts",
    "profile_contact_visibility",
    "synced_contacts",
    "profiles",
    "profile_avatars",
    "device_tokens",
    "push_notification_jobs",
)


def _parse_postgres_url(value: str, env_name: str) -> Any:
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError as exc:
        raise ShadowCompareError(f"{env_name} must be a valid PostgreSQL URL.") from exc
    if parsed.scheme not in {"postgres", "postgresql", "postgresql+asyncpg"} or not parsed.hostname:
        raise ShadowCompareError(f"{env_name} must be a PostgreSQL URL.")
    if not parsed.path or parsed.path == "/":
        raise ShadowCompareError(f"{env_name} must name an explicit database.")
    if port is not None and not 1 <= port <= 65535:
        raise ShadowCompareError(f"{env_name} must be a valid PostgreSQL URL.")
    return parsed


def is_hosted_connection(database_url: str) -> bool:
    parsed = _parse_postgres_url(database_url, "Database URL")
    hostname = parsed.hostname.lower()
    return hostname not in LOCAL_HOSTS and not hostname.endswith(".local")


def _database_identity(database_url: str, env_name: str) -> tuple[str, str, int, str]:
    parsed = _parse_postgres_url(database_url, env_name)
    scheme = "postgresql" if parsed.scheme in {"postgres", "postgresql+asyncpg"} else parsed.scheme
    return (scheme, parsed.hostname.lower(), parsed.port or 5432, parsed.path.rstrip("/"))


def validate_owner_environment(allow_hosted_source: bool, allow_hosted_target: bool) -> ConnectionSettings:
    if os.environ.get(ACK_ENV) != ACKNOWLEDGEMENT:
        raise ShadowCompareError(f"{ACK_ENV} must exactly equal {ACKNOWLEDGEMENT}.")
    source_url = os.environ.get(SOURCE_ENV)
    target_url = os.environ.get(TARGET_ENV)
    if not source_url:
        raise ShadowCompareError(f"{SOURCE_ENV} is required; this utility has no default database URL.")
    if not target_url:
        raise ShadowCompareError(f"{TARGET_ENV} is required; this utility has no default database URL.")
    source_identity = _database_identity(source_url, SOURCE_ENV)
    target_identity = _database_identity(target_url, TARGET_ENV)
    if source_identity == target_identity:
        raise ShadowCompareError("Source and target connection URLs must not identify the same database endpoint.")
    source_hosted = is_hosted_connection(source_url)
    target_hosted = is_hosted_connection(target_url)
    if source_hosted and not allow_hosted_source:
        raise ShadowCompareError("Hosted source requires --allow-hosted-source-with-owner-command.")
    if target_hosted and not allow_hosted_target:
        raise ShadowCompareError("Hosted target requires --allow-hosted-target-with-owner-command.")
    return ConnectionSettings(source_url, target_url, source_hosted, target_hosted)


def asyncpg_url(database_url: str) -> str:
    if database_url.startswith("postgresql+asyncpg://"):
        return "postgresql://" + database_url[len("postgresql+asyncpg://") :]
    if database_url.startswith("postgres://"):
        return "postgresql://" + database_url[len("postgres://") :]
    return database_url


async def connect_database(database_url: str, label: str) -> Any:
    try:
        import asyncpg
    except ImportError as exc:
        raise ShadowCompareError("asyncpg is required by the API Python environment to connect to PostgreSQL.") from exc
    try:
        return await asyncpg.connect(
            asyncpg_url(database_url),
            server_settings={"application_name": "sredi-svoih-shadow-read-compare"},
        )
    except Exception as exc:
        raise ShadowCompareError(f"{label.capitalize()} database connection failed without exposing connection details.") from exc


async def load_schema(connection: Any) -> dict[tuple[str, str], set[str]]:
    try:
        rows = await connection.fetch(SCHEMA_SQL, list(PUBLIC_TABLES))
    except Exception as exc:
        raise ShadowCompareError("Database schema inspection failed without exposing connection details.") from exc
    schema: dict[tuple[str, str], set[str]] = {}
    for row in rows:
        key = (str(row["table_schema"]), str(row["table_name"]))
        schema.setdefault(key, set()).add(str(row["column_name"]))
    return schema


def _has_columns(schema: dict[tuple[str, str], set[str]], table: str, columns: Iterable[str], *, namespace: str = "public") -> bool:
    return set(columns).issubset(schema.get((namespace, table), set()))


def require_public_schema(source: dict[tuple[str, str], set[str]], target: dict[tuple[str, str], set[str]], requirements: dict[str, tuple[str, ...]]) -> None:
    for table, columns in requirements.items():
        if not _has_columns(source, table, columns) or not _has_columns(target, table, columns):
            raise DomainIncomplete("required_schema_unavailable")


async def read_total(connection: Any, statement: str) -> int:
    return int((await connection.fetchval(SQL[statement])) or 0)


async def read_metrics(connection: Any, statement: str, fields: Iterable[str], *values: Any) -> dict[str, int]:
    row = await connection.fetchrow(SQL[statement], *values)
    if row is None:
        raise DomainIncomplete("aggregate_query_unavailable")
    return {field: int(row[field] or 0) for field in fields}


async def read_groups(connection: Any, statement: str, keys: Iterable[str]) -> dict[tuple[Any, ...], int]:
    rows = await connection.fetch(SQL[statement])
    return {tuple(row[key] for key in keys): int(row["row_count"] or 0) for row in rows}


def count_differences(source: dict[tuple[Any, ...], int], target: dict[tuple[Any, ...], int]) -> int:
    return sum(1 for key in source.keys() | target.keys() if source.get(key, 0) != target.get(key, 0))


def numeric_difference(source: int, target: int) -> int:
    return int(source != target)


def completed_domain(source: dict[str, int], target: dict[str, int], comparisons: dict[str, int]) -> dict[str, Any]:
    return {
        "status": "matched" if not any(comparisons.values()) else "mismatched",
        "source": source,
        "target": target,
        "comparison": comparisons,
    }


def incomplete_domain(reason: str) -> dict[str, Any]:
    return {"status": "incomplete", "reason": reason}


async def compare_events(source: Any, target: Any, source_schema: dict[tuple[str, str], set[str]], target_schema: dict[tuple[str, str], set[str]]) -> dict[str, Any]:
    require_public_schema(source_schema, target_schema, {"events": ("id", "community_id", "status", "visibility")})
    source_total, target_total = await asyncio.gather(read_total(source, "events_total"), read_total(target, "events_total"))
    source_community, target_community = await asyncio.gather(read_groups(source, "events_by_community", ("community_id",)), read_groups(target, "events_by_community", ("community_id",)))
    source_status, target_status = await asyncio.gather(read_groups(source, "events_by_status", ("status",)), read_groups(target, "events_by_status", ("status",)))
    source_visibility, target_visibility = await asyncio.gather(read_groups(source, "events_by_visibility", ("visibility",)), read_groups(target, "events_by_visibility", ("visibility",)))
    comparisons = {
        "totalCountMismatchCount": numeric_difference(source_total, target_total),
        "communityCountMismatchCount": count_differences(source_community, target_community),
        "statusCountMismatchCount": count_differences(source_status, target_status),
        "visibilityCountMismatchCount": count_differences(source_visibility, target_visibility),
    }
    if _has_columns(source_schema, "events", ("event_kind",)) and _has_columns(target_schema, "events", ("event_kind",)):
        source_kind, target_kind = await asyncio.gather(read_groups(source, "events_by_kind", ("event_kind",)), read_groups(target, "events_by_kind", ("event_kind",)))
        comparisons["eventKindCountMismatchCount"] = count_differences(source_kind, target_kind)
    return completed_domain({"totalCount": source_total}, {"totalCount": target_total}, comparisons)


async def compare_occurrences(source: Any, target: Any, source_schema: dict[tuple[str, str], set[str]], target_schema: dict[tuple[str, str], set[str]]) -> dict[str, Any]:
    require_public_schema(source_schema, target_schema, {"event_occurrences": ("id", "event_id", "status", "registration_opens_at", "registration_closes_at")})
    fields = ("total_count", "with_window_count", "without_window_count")
    source_metrics, target_metrics = await asyncio.gather(read_metrics(source, "occurrences_metrics", fields), read_metrics(target, "occurrences_metrics", fields))
    source_event, target_event = await asyncio.gather(read_groups(source, "occurrences_by_event", ("event_id",)), read_groups(target, "occurrences_by_event", ("event_id",)))
    source_status, target_status = await asyncio.gather(read_groups(source, "occurrences_by_status", ("status",)), read_groups(target, "occurrences_by_status", ("status",)))
    comparisons = {
        "totalCountMismatchCount": numeric_difference(source_metrics["total_count"], target_metrics["total_count"]),
        "withRegistrationWindowMismatchCount": numeric_difference(source_metrics["with_window_count"], target_metrics["with_window_count"]),
        "withoutRegistrationWindowMismatchCount": numeric_difference(source_metrics["without_window_count"], target_metrics["without_window_count"]),
        "eventCountMismatchCount": count_differences(source_event, target_event),
        "statusCountMismatchCount": count_differences(source_status, target_status),
    }
    return completed_domain(
        {"totalCount": source_metrics["total_count"], "withRegistrationWindowCount": source_metrics["with_window_count"], "withoutRegistrationWindowCount": source_metrics["without_window_count"]},
        {"totalCount": target_metrics["total_count"], "withRegistrationWindowCount": target_metrics["with_window_count"], "withoutRegistrationWindowCount": target_metrics["without_window_count"]},
        comparisons,
    )


async def compare_registrations(source: Any, target: Any, source_schema: dict[tuple[str, str], set[str]], target_schema: dict[tuple[str, str], set[str]]) -> dict[str, Any]:
    require_public_schema(source_schema, target_schema, {
        "event_registrations": ("id", "event_id", "occurrence_id", "status", "seats_count"),
        "event_registration_option_selections": ("registration_id",),
        "event_registration_capacity_reservations": ("registration_id",),
    })
    fields = ("total_count", "seats_count", "with_option_selection_count", "with_capacity_reservation_count")
    source_metrics, target_metrics = await asyncio.gather(read_metrics(source, "registrations_metrics", fields), read_metrics(target, "registrations_metrics", fields))
    source_status, target_status = await asyncio.gather(read_groups(source, "registrations_by_status", ("status",)), read_groups(target, "registrations_by_status", ("status",)))
    source_event_occurrence, target_event_occurrence = await asyncio.gather(read_groups(source, "registrations_by_event_occurrence", ("event_id", "occurrence_id")), read_groups(target, "registrations_by_event_occurrence", ("event_id", "occurrence_id")))
    comparisons = {
        "totalCountMismatchCount": numeric_difference(source_metrics["total_count"], target_metrics["total_count"]),
        "statusCountMismatchCount": count_differences(source_status, target_status),
        "eventOccurrenceCountMismatchCount": count_differences(source_event_occurrence, target_event_occurrence),
        "seatsCountMismatchCount": numeric_difference(source_metrics["seats_count"], target_metrics["seats_count"]),
        "optionSelectionRegistrationMismatchCount": numeric_difference(source_metrics["with_option_selection_count"], target_metrics["with_option_selection_count"]),
        "capacityReservationRegistrationMismatchCount": numeric_difference(source_metrics["with_capacity_reservation_count"], target_metrics["with_capacity_reservation_count"]),
    }
    return completed_domain(
        {"totalCount": source_metrics["total_count"], "seatsCount": source_metrics["seats_count"], "registrationsWithOptionSelections": source_metrics["with_option_selection_count"], "registrationsWithCapacityReservations": source_metrics["with_capacity_reservation_count"]},
        {"totalCount": target_metrics["total_count"], "seatsCount": target_metrics["seats_count"], "registrationsWithOptionSelections": target_metrics["with_option_selection_count"], "registrationsWithCapacityReservations": target_metrics["with_capacity_reservation_count"]},
        comparisons,
    )


async def compare_memberships(source: Any, target: Any, source_schema: dict[tuple[str, str], set[str]], target_schema: dict[tuple[str, str], set[str]]) -> dict[str, Any]:
    require_public_schema(source_schema, target_schema, {"community_memberships": ("id", "community_id", "role", "status")})
    fields = ("total_count", "active_membership_count")
    source_metrics, target_metrics = await asyncio.gather(read_metrics(source, "memberships_metrics", fields), read_metrics(target, "memberships_metrics", fields))
    source_community, target_community = await asyncio.gather(read_groups(source, "memberships_by_community", ("community_id",)), read_groups(target, "memberships_by_community", ("community_id",)))
    source_role, target_role = await asyncio.gather(read_groups(source, "memberships_by_role", ("role",)), read_groups(target, "memberships_by_role", ("role",)))
    source_status, target_status = await asyncio.gather(read_groups(source, "memberships_by_status", ("status",)), read_groups(target, "memberships_by_status", ("status",)))
    comparisons = {
        "totalCountMismatchCount": numeric_difference(source_metrics["total_count"], target_metrics["total_count"]),
        "communityCountMismatchCount": count_differences(source_community, target_community),
        "roleCountMismatchCount": count_differences(source_role, target_role),
        "statusCountMismatchCount": count_differences(source_status, target_status),
        "activeMembershipMismatchCount": numeric_difference(source_metrics["active_membership_count"], target_metrics["active_membership_count"]),
    }
    return completed_domain(
        {"totalCount": source_metrics["total_count"], "activeMembershipCount": source_metrics["active_membership_count"]},
        {"totalCount": target_metrics["total_count"], "activeMembershipCount": target_metrics["active_membership_count"]},
        comparisons,
    )


async def read_capacity_buckets(connection: Any) -> dict[tuple[Any, Any, Any], tuple[int, int, int, int]]:
    rows = await connection.fetch(SQL["capacity_buckets"])
    return {
        (row["event_id"], row["occurrence_id"], row["capacity_unit_id"]): (
            int(row["configured_capacity"] or 0),
            int(row["reservation_count"] or 0),
            int(row["occupied_seats"] or 0),
            int(row["represented_registration_count"] or 0),
        )
        for row in rows
    }


def compare_capacity_bucket_sets(source: dict[tuple[Any, Any, Any], tuple[int, int, int, int]], target: dict[tuple[Any, Any, Any], tuple[int, int, int, int]]) -> dict[str, int]:
    source_keys = source.keys()
    target_keys = target.keys()
    shared = source_keys & target_keys
    return {
        "matchedBucketCount": sum(1 for key in shared if source[key] == target[key]),
        "missingSourceBucketCount": len(target_keys - source_keys),
        "missingTargetBucketCount": len(source_keys - target_keys),
        "mismatchedBucketCount": sum(1 for key in shared if source[key] != target[key]),
    }


def capacity_totals(buckets: dict[tuple[Any, Any, Any], tuple[int, int, int, int]]) -> dict[str, int]:
    return {
        "totalBucketCount": len(buckets),
        "configuredCapacity": sum(value[0] for value in buckets.values()),
        "occupiedSeats": sum(value[2] for value in buckets.values()),
        "reservationCount": sum(value[1] for value in buckets.values()),
    }


async def compare_capacity_buckets(source: Any, target: Any, source_schema: dict[tuple[str, str], set[str]], target_schema: dict[tuple[str, str], set[str]]) -> dict[str, Any]:
    require_public_schema(source_schema, target_schema, {
        "event_capacity_units": ("id", "event_id", "capacity"),
        "event_occurrences": ("id", "event_id"),
        "event_registration_capacity_reservations": ("registration_id", "event_id", "occurrence_id", "capacity_unit_id", "seats_count"),
    })
    source_buckets, target_buckets = await asyncio.gather(read_capacity_buckets(source), read_capacity_buckets(target))
    comparison = compare_capacity_bucket_sets(source_buckets, target_buckets)
    return completed_domain(capacity_totals(source_buckets), capacity_totals(target_buckets), comparison)


async def compare_seating(source: Any, target: Any, source_schema: dict[tuple[str, str], set[str]], target_schema: dict[tuple[str, str], set[str]]) -> dict[str, Any]:
    require_public_schema(source_schema, target_schema, {
        "event_seating_layout_templates": ("id",),
        "event_seating_layouts": ("id", "event_id", "occurrence_id", "capacity_unit_id"),
        "event_seating_tables": ("id", "layout_id"),
        "event_seating_table_connections": ("id", "layout_id"),
        "event_seating_assignments": ("id", "layout_id"),
    })
    totals = ("seating_templates_total", "seating_layouts_total", "seating_tables_total", "seating_connections_total", "seating_assignments_total")
    source_values, target_values = await asyncio.gather(asyncio.gather(*(read_total(source, item) for item in totals)), asyncio.gather(*(read_total(target, item) for item in totals)))
    source_groups, target_groups = await asyncio.gather(
        asyncio.gather(*(read_groups(source, item, ("event_id", "occurrence_id", "capacity_unit_id")) for item in ("seating_layouts_by_slot", "seating_tables_by_slot", "seating_connections_by_slot", "seating_assignments_by_slot"))),
        asyncio.gather(*(read_groups(target, item, ("event_id", "occurrence_id", "capacity_unit_id")) for item in ("seating_layouts_by_slot", "seating_tables_by_slot", "seating_connections_by_slot", "seating_assignments_by_slot"))),
    )
    names = ("layoutTemplateCount", "layoutCount", "tableCount", "connectionCount", "assignmentCount")
    source_metrics = dict(zip(names, source_values, strict=True))
    target_metrics = dict(zip(names, target_values, strict=True))
    comparisons = {f"{name}MismatchCount": numeric_difference(source_metrics[name], target_metrics[name]) for name in names}
    comparisons.update({
        "layoutGroupMismatchCount": count_differences(source_groups[0], target_groups[0]),
        "tableGroupMismatchCount": count_differences(source_groups[1], target_groups[1]),
        "connectionGroupMismatchCount": count_differences(source_groups[2], target_groups[2]),
        "assignmentGroupMismatchCount": count_differences(source_groups[3], target_groups[3]),
    })
    return completed_domain(source_metrics, target_metrics, comparisons)


async def compare_prayer_tracker(source: Any, target: Any, source_schema: dict[tuple[str, str], set[str]], target_schema: dict[tuple[str, str], set[str]]) -> dict[str, Any]:
    require_public_schema(source_schema, target_schema, {"prayer_activity_logs": ("id", "user_id")})
    fields = ("total_count", "user_count")
    source_metrics, target_metrics = await asyncio.gather(read_metrics(source, "prayer_metrics", fields), read_metrics(target, "prayer_metrics", fields))
    source_users, target_users = await asyncio.gather(read_groups(source, "prayer_by_user", ("user_id",)), read_groups(target, "prayer_by_user", ("user_id",)))
    return completed_domain(
        {"totalCount": source_metrics["total_count"], "usersWithActivityCount": source_metrics["user_count"]},
        {"totalCount": target_metrics["total_count"], "usersWithActivityCount": target_metrics["user_count"]},
        {"totalCountMismatchCount": numeric_difference(source_metrics["total_count"], target_metrics["total_count"]), "usersWithActivityMismatchCount": numeric_difference(source_metrics["user_count"], target_metrics["user_count"]), "perUserCountMismatchCount": count_differences(source_users, target_users)},
    )


async def compare_contacts(source: Any, target: Any, source_schema: dict[tuple[str, str], set[str]], target_schema: dict[tuple[str, str], set[str]]) -> dict[str, Any]:
    visibility_columns = ("user_id", "show_in_community_directory", "share_phone", "share_email", "share_birth_date", "share_hebrew_birth_date", "share_city", "share_hebrew_name", "birthday_reminders_enabled")
    require_public_schema(source_schema, target_schema, {
        "community_contacts": ("id", "community_id"),
        "profile_contact_visibility": visibility_columns,
        "synced_contacts": ("id", "user_id"),
    })
    visibility_fields = ("total_count", "directory_true_count", "phone_true_count", "email_true_count", "birth_date_true_count", "hebrew_birth_date_true_count", "city_true_count", "hebrew_name_true_count", "birthday_reminders_true_count")
    source_community_total, target_community_total, source_visibility, target_visibility, source_synced, target_synced = await asyncio.gather(
        read_total(source, "contacts_community_total"), read_total(target, "contacts_community_total"),
        read_metrics(source, "visibility_metrics", visibility_fields), read_metrics(target, "visibility_metrics", visibility_fields),
        read_metrics(source, "synced_contacts_metrics", ("total_count",)), read_metrics(target, "synced_contacts_metrics", ("total_count",)),
    )
    source_community, target_community, source_synced_users, target_synced_users = await asyncio.gather(
        read_groups(source, "contacts_by_community", ("community_id",)), read_groups(target, "contacts_by_community", ("community_id",)),
        read_groups(source, "synced_contacts_by_user", ("user_id",)), read_groups(target, "synced_contacts_by_user", ("user_id",)),
    )
    boolean_mismatches = sum(numeric_difference(source_visibility[field], target_visibility[field]) for field in visibility_fields[1:])
    return completed_domain(
        {"communityContactCount": source_community_total, "visibilityRowCount": source_visibility["total_count"], "syncedContactCount": source_synced["total_count"]},
        {"communityContactCount": target_community_total, "visibilityRowCount": target_visibility["total_count"], "syncedContactCount": target_synced["total_count"]},
        {
            "communityContactTotalMismatchCount": numeric_difference(source_community_total, target_community_total),
            "communityCountMismatchCount": count_differences(source_community, target_community),
            "visibilityRowMismatchCount": numeric_difference(source_visibility["total_count"], target_visibility["total_count"]),
            "visibilityBooleanStateMismatchCount": boolean_mismatches,
            "syncedContactTotalMismatchCount": numeric_difference(source_synced["total_count"], target_synced["total_count"]),
            "syncedContactPerUserMismatchCount": count_differences(source_synced_users, target_synced_users),
        },
    )


async def compare_avatars(source: Any, target: Any, source_schema: dict[tuple[str, str], set[str]], target_schema: dict[tuple[str, str], set[str]]) -> dict[str, Any]:
    source_ready = _has_columns(source_schema, "objects", ("bucket_id", "name"), namespace="storage") and _has_columns(source_schema, "profiles", ("id",))
    target_ready = _has_columns(target_schema, "profile_avatars", ("id", "status")) and _has_columns(target_schema, "profiles", ("id", "avatar_id"))
    if not source_ready or not target_ready:
        raise DomainIncomplete("required_schema_unavailable")
    fields = ("object_count", "linked_public_profile_count")
    source_metrics, target_metrics = await asyncio.gather(read_metrics(source, "source_avatar_metrics", fields, AVATAR_BUCKET), read_metrics(target, "target_avatar_metrics", ("avatar_row_count", "pending_count", "active_count", "deleted_count", "profile_avatar_count")))
    source_report = {"avatarObjectCount": source_metrics["object_count"], "linkedPublicProfileObjectCount": source_metrics["linked_public_profile_count"]}
    target_report = {"profileAvatarRowCount": target_metrics["avatar_row_count"], "pendingCount": target_metrics["pending_count"], "activeCount": target_metrics["active_count"], "deletedCount": target_metrics["deleted_count"], "profilesWithAvatarCount": target_metrics["profile_avatar_count"]}
    if source_metrics["object_count"]:
        return {"status": "pending_storage_migration", "source": source_report, "target": target_report, "comparison": {"pendingStorageMigrationCount": source_metrics["object_count"]}}
    comparisons = {"targetAvatarStateMismatchCount": int(any(target_metrics.values()))}
    result = completed_domain(source_report, target_report, comparisons)
    result["status"] = "match" if result["status"] == "matched" else "mismatch"
    return result


async def compare_device_tokens(source: Any, target: Any, source_schema: dict[tuple[str, str], set[str]], target_schema: dict[tuple[str, str], set[str]]) -> dict[str, Any]:
    require_public_schema(source_schema, target_schema, {"device_tokens": ("id", "is_active", "environment", "platform", "push_provider")})
    source_total, target_total = await asyncio.gather(read_total(source, "device_tokens_total"), read_total(target, "device_tokens_total"))
    source_active, target_active, source_environment, target_environment, source_platform, target_platform, source_provider, target_provider = await asyncio.gather(
        read_groups(source, "device_tokens_by_active", ("is_active",)), read_groups(target, "device_tokens_by_active", ("is_active",)),
        read_groups(source, "device_tokens_by_environment", ("environment",)), read_groups(target, "device_tokens_by_environment", ("environment",)),
        read_groups(source, "device_tokens_by_platform", ("platform",)), read_groups(target, "device_tokens_by_platform", ("platform",)),
        read_groups(source, "device_tokens_by_provider", ("push_provider",)), read_groups(target, "device_tokens_by_provider", ("push_provider",)),
    )
    return completed_domain(
        {"totalCount": source_total}, {"totalCount": target_total},
        {"totalCountMismatchCount": numeric_difference(source_total, target_total), "activeStateMismatchCount": count_differences(source_active, target_active), "environmentCountMismatchCount": count_differences(source_environment, target_environment), "platformCountMismatchCount": count_differences(source_platform, target_platform), "providerCountMismatchCount": count_differences(source_provider, target_provider)},
    )


async def compare_push_jobs(source: Any, target: Any, source_schema: dict[tuple[str, str], set[str]], target_schema: dict[tuple[str, str], set[str]]) -> dict[str, Any]:
    require_public_schema(source_schema, target_schema, {"push_notification_jobs": ("id", "status", "notification_kind", "audience")})
    source_total, target_total = await asyncio.gather(read_total(source, "push_jobs_total"), read_total(target, "push_jobs_total"))
    source_status, target_status, source_kind, target_kind, source_audience, target_audience = await asyncio.gather(
        read_groups(source, "push_jobs_by_status", ("status",)), read_groups(target, "push_jobs_by_status", ("status",)),
        read_groups(source, "push_jobs_by_kind", ("notification_kind",)), read_groups(target, "push_jobs_by_kind", ("notification_kind",)),
        read_groups(source, "push_jobs_by_audience", ("audience",)), read_groups(target, "push_jobs_by_audience", ("audience",)),
    )
    return completed_domain(
        {"totalCount": source_total}, {"totalCount": target_total},
        {"totalCountMismatchCount": numeric_difference(source_total, target_total), "statusCountMismatchCount": count_differences(source_status, target_status), "notificationKindMismatchCount": count_differences(source_kind, target_kind), "audienceMismatchCount": count_differences(source_audience, target_audience)},
    )


async def safe_domain(callback: Any, source: Any, target: Any, source_schema: dict[tuple[str, str], set[str]], target_schema: dict[tuple[str, str], set[str]]) -> dict[str, Any]:
    try:
        return await callback(source, target, source_schema, target_schema)
    except DomainIncomplete as exc:
        return incomplete_domain(str(exc))
    except Exception:
        return incomplete_domain("aggregate_query_unavailable")


def make_report(domains: dict[str, dict[str, Any]]) -> dict[str, Any]:
    matched = sum(1 for domain in domains.values() if domain["status"] in {"matched", "match"})
    mismatched = sum(1 for domain in domains.values() if domain["status"] in {"mismatched", "mismatch"})
    incomplete = sum(1 for domain in domains.values() if domain["status"] in {"incomplete", "pending_storage_migration"})
    outcome = "incomplete" if incomplete else "mismatched" if mismatched else "matched"
    return {
        "formatVersion": FORMAT_VERSION,
        "mode": "shadow_read_compare",
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "transaction": "source_and_target_repeatable_read_read_only",
        "outcome": outcome,
        "domains": domains,
        "summary": {"matchedDomains": matched, "mismatchedDomains": mismatched, "incompleteDomains": incomplete},
    }


_FORBIDDEN_REPORT_PATTERNS = (
    re.compile(r"(?i)(?:postgres(?:ql)?(?:\+[a-z0-9_]+)?|https?)://"),
    re.compile(r"(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b"),
    re.compile(r"(?i)\b[^\s@]+@[^\s@]+\.[^\s@]+\b"),
    re.compile(r"(?i)(?:exponentpushtoken|(?<!\d)\+[1-9][0-9]{7,14}\b)"),
)


def assert_safe_report(report: dict[str, Any]) -> None:
    serialized = json.dumps(report, ensure_ascii=False, sort_keys=True)
    if any(pattern.search(serialized) for pattern in _FORBIDDEN_REPORT_PATTERNS):
        raise ShadowCompareError("Generated report failed privacy validation.")


def _has_symlink_component(path: Path) -> bool:
    current = Path(path.anchor)
    parts = path.parts[1:] if path.anchor else path.parts
    for part in parts:
        current /= part
        if current.is_symlink():
            return True
    return False


def prepare_report_path(report_dir_value: str | None, timestamp: datetime | None = None) -> Path:
    report_dir = Path(report_dir_value).expanduser() if report_dir_value else DEFAULT_REPORT_DIR
    try:
        if _has_symlink_component(report_dir):
            raise ShadowCompareError("Report directory must not be a symbolic link.")
        report_dir.mkdir(parents=True, exist_ok=True)
        if report_dir.is_symlink() or not report_dir.is_dir():
            raise ShadowCompareError("Report directory must be a real directory, not a symbolic link.")
    except OSError as exc:
        raise ShadowCompareError("Report directory could not be prepared safely.") from exc
    moment = timestamp or datetime.now(timezone.utc)
    filename = f"shadow-read-compare-{moment.astimezone(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
    destination = report_dir / filename
    if destination.is_symlink():
        raise ShadowCompareError("Report file must not be a symbolic link.")
    if destination.exists():
        raise ShadowCompareError("Report file already exists and will not be overwritten.")
    return destination


def write_report(report: dict[str, Any], report_dir_value: str | None) -> Path:
    assert_safe_report(report)
    destination = prepare_report_path(report_dir_value)
    try:
        with destination.open("x", encoding="utf-8") as output:
            json.dump(report, output, ensure_ascii=False, indent=2, sort_keys=True)
            output.write("\n")
    except FileExistsError as exc:
        raise ShadowCompareError("Report file already exists and will not be overwritten.") from exc
    except OSError as exc:
        raise ShadowCompareError("Aggregate report could not be written safely.") from exc
    return destination


async def run_shadow_comparison(options: argparse.Namespace) -> dict[str, Any]:
    settings = validate_owner_environment(options.allow_hosted_source_with_owner_command, options.allow_hosted_target_with_owner_command)
    source = await connect_database(settings.source_url, "source")
    try:
        target = await connect_database(settings.target_url, "target")
    except Exception:
        await source.close()
        raise
    try:
        async with source.transaction(isolation="repeatable_read", readonly=True):
            async with target.transaction(isolation="repeatable_read", readonly=True):
                source_schema, target_schema = await asyncio.gather(load_schema(source), load_schema(target))
                domain_callbacks = (
                    ("events", compare_events),
                    ("occurrences", compare_occurrences),
                    ("registrations", compare_registrations),
                    ("memberships", compare_memberships),
                    ("capacityBuckets", compare_capacity_buckets),
                    ("seating", compare_seating),
                    ("prayerTracker", compare_prayer_tracker),
                    ("contacts", compare_contacts),
                    ("avatars", compare_avatars),
                    ("deviceTokens", compare_device_tokens),
                    ("pushJobs", compare_push_jobs),
                )
                domains = {
                    name: await safe_domain(callback, source, target, source_schema, target_schema)
                    for name, callback in domain_callbacks
                }
        return make_report(domains)
    finally:
        await target.close()
        await source.close()


def build_parser() -> argparse.ArgumentParser:
    parser = SafeArgumentParser(
        description="Compare live Supabase and API PostgreSQL aggregate state without database writes.",
        epilog="--help does not require credentials or connect to PostgreSQL. Reports contain aggregate counts only.",
    )
    parser.add_argument("--allow-hosted-source-with-owner-command", action="store_true", help="Explicit owner approval boundary for a non-local Supabase source.")
    parser.add_argument("--allow-hosted-target-with-owner-command", action="store_true", help="Explicit owner approval boundary for a non-local API target.")
    parser.add_argument("--report-dir", help="Owner-controlled directory for one aggregate JSON report; defaults to .migration-reports.")
    return parser


def main(argv: list[str] | None = None) -> int:
    options = build_parser().parse_args(argv)
    try:
        print("[shadow] Comparing aggregate-only domains in read-only repeatable-read transactions.")
        report = asyncio.run(run_shadow_comparison(options))
        write_report(report, options.report_dir)
        summary = report["summary"]
        print(f"[summary] outcome={report['outcome']} matched={summary['matchedDomains']} mismatched={summary['mismatchedDomains']} incomplete={summary['incompleteDomains']}")
        print("[report] Aggregate JSON report created.")
        return 0 if report["outcome"] == "matched" else 1
    except ShadowCompareError as exc:
        print(f"[error] {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("[error] Shadow comparison interrupted; this utility does not write to databases.", file=sys.stderr)
        return 1
    except Exception:
        print("[error] A filesystem or database operation failed without exposing credentials or source rows.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
