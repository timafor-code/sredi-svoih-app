#!/usr/bin/env python3
"""Aggregate-only post-import validation for the PR #324 -> API PostgreSQL migration."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from collections import Counter
from typing import Any, Iterable
from uuid import UUID

from import_to_api_postgres import (
    MigrationError,
    PreparedDomain,
    build_import_plan,
    connect_database,
    emit_report,
    explicit_report_dir,
    load_export,
    resolve_input_dir,
    safe_identifier,
    validate_owner_environment,
    verify_target_schema,
)


def target_entries(plan: Any) -> list[tuple[str, str, list[dict[str, Any]], str]]:
    entries = [("app_users", "id", plan.identities, "app_users")]
    entries.extend(
        (domain.mapping.target_table, domain.primary_column, domain.rows, domain.mapping.source_table)
        for domain in plan.domains
        if domain.status == "ready"
    )
    return entries


async def target_primary_count(connection: Any, table_name: str, primary: str, rows: list[dict[str, Any]]) -> int:
    values = [row[primary] for row in rows if isinstance(row.get(primary), UUID)]
    if not values:
        return 0
    return int(
        await connection.fetchval(
            f"select count(*) from {safe_identifier(table_name)} where {safe_identifier(primary)} = any($1::uuid[])",
            values,
        )
    )


async def duplicate_key_count(connection: Any, table_name: str, primary: str, rows: list[dict[str, Any]]) -> int:
    values = [row[primary] for row in rows if isinstance(row.get(primary), UUID)]
    if not values:
        return 0
    return int(
        await connection.fetchval(
            f"select count(*) from (select {safe_identifier(primary)} from {safe_identifier(table_name)} where {safe_identifier(primary)} = any($1::uuid[]) group by {safe_identifier(primary)} having count(*) > 1) duplicate_keys",
            values,
        )
    )


async def compare_primary_keys(connection: Any, plan: Any) -> None:
    for table_name, primary, rows, report_name in target_entries(plan):
        expected = len(rows)
        matched = await target_primary_count(connection, table_name, primary, rows)
        total = int(await connection.fetchval(f"select count(*) from {safe_identifier(table_name)}"))
        duplicates = await duplicate_key_count(connection, table_name, primary, rows)
        domain_report = plan.report["domains"][report_name]
        domain_report["target_count"] = total
        domain_report["matched_primary_key_count"] = matched
        domain_report["missing_target_count"] = expected - matched
        domain_report["duplicate_target_key_count"] = duplicates
        if expected != matched:
            plan.collector.add(report_name, "missing_target_primary_key")
        if duplicates:
            plan.collector.add(report_name, "unexpected_duplicate_target_key")


def ids(rows: Iterable[dict[str, Any]], field_name: str = "id") -> list[UUID]:
    return [row[field_name] for row in rows if isinstance(row.get(field_name), UUID)]


def domain_rows(plan: Any, source_name: str) -> list[dict[str, Any]]:
    for domain in plan.domains:
        if domain.mapping.source_table == source_name and domain.status == "ready":
            return domain.rows
    return []


async def mismatch_count(connection: Any, sql: str, values: list[UUID]) -> int:
    if not values:
        return 0
    return int(await connection.fetchval(sql, values))


async def compare_alignment(connection: Any, plan: Any) -> None:
    profiles = domain_rows(plan, "profiles")
    mismatch = await mismatch_count(
        connection,
        "select count(*) from profiles p left join app_users u on u.id = p.user_id where p.id = any($1::uuid[]) and (u.id is null or p.user_id <> p.id)",
        ids(profiles),
    )
    _record_alignment(plan, "profiles", "profile_app_user_alignment", mismatch)

    memberships = domain_rows(plan, "community_memberships")
    mismatch = await mismatch_count(
        connection,
        "select count(*) from community_memberships m left join app_users u on u.id = m.user_id left join communities c on c.id = m.community_id where m.id = any($1::uuid[]) and (u.id is null or c.id is null)",
        ids(memberships),
    )
    _record_alignment(plan, "community_memberships", "membership_app_user_alignment", mismatch)

    registrations = domain_rows(plan, "event_registrations")
    mismatch = await mismatch_count(
        connection,
        "select count(*) from event_registrations r left join app_users u on u.id = r.user_id left join events e on e.id = r.event_id left join event_occurrences o on o.id = r.occurrence_id where r.id = any($1::uuid[]) and (u.id is null or e.id is null or (r.occurrence_id is not null and o.id is null))",
        ids(registrations),
    )
    _record_alignment(plan, "event_registrations", "registration_user_event_occurrence_alignment", mismatch)

    selections = domain_rows(plan, "event_registration_option_selections")
    mismatch = await mismatch_count(
        connection,
        "select count(*) from event_registration_option_selections s left join event_registrations r on r.id = s.registration_id left join event_participation_options o on o.id = s.option_id where s.id = any($1::uuid[]) and (r.id is null or (s.option_id is not null and o.id is null))",
        ids(selections),
    )
    _record_alignment(plan, "event_registration_option_selections", "option_selection_alignment", mismatch)

    reservations = domain_rows(plan, "event_registration_capacity_reservations")
    mismatch = await mismatch_count(
        connection,
        "select count(*) from event_registration_capacity_reservations r left join event_registrations reg on reg.id = r.registration_id left join events e on e.id = r.event_id left join event_capacity_units u on u.id = r.capacity_unit_id where r.id = any($1::uuid[]) and (reg.id is null or e.id is null or u.id is null or u.event_id <> r.event_id)",
        ids(reservations),
    )
    _record_alignment(plan, "event_registration_capacity_reservations", "capacity_reservation_alignment", mismatch)

    layouts = domain_rows(plan, "event_seating_layouts")
    mismatch = await mismatch_count(
        connection,
        "select count(*) from event_seating_layouts l left join events e on e.id = l.event_id left join event_capacity_units u on u.id = l.capacity_unit_id where l.id = any($1::uuid[]) and (e.id is null or u.id is null or u.event_id <> l.event_id)",
        ids(layouts),
    )
    _record_alignment(plan, "event_seating_layouts", "seating_layout_hierarchy", mismatch)
    for source_name, table_name, parent_column, parent_table in (
        ("event_seating_tables", "event_seating_tables", "layout_id", "event_seating_layouts"),
        ("event_seating_table_connections", "event_seating_table_connections", "layout_id", "event_seating_layouts"),
        ("event_seating_assignments", "event_seating_assignments", "layout_id", "event_seating_layouts"),
    ):
        rows = domain_rows(plan, source_name)
        mismatch = await mismatch_count(
            connection,
            f"select count(*) from {safe_identifier(table_name)} child left join {safe_identifier(parent_table)} parent on parent.id = child.{safe_identifier(parent_column)} where child.id = any($1::uuid[]) and parent.id is null",
            ids(rows),
        )
        _record_alignment(plan, source_name, "seating_hierarchy_alignment", mismatch)

    for source_name, table_name, condition in (
        ("community_contacts", "community_contacts", "parent.id is null"),
        ("profile_contact_visibility", "profile_contact_visibility", "parent.id is null"),
        ("synced_contacts", "synced_contacts", "parent.id is null"),
    ):
        rows = domain_rows(plan, source_name)
        primary = "user_id" if source_name == "profile_contact_visibility" else "id"
        child_field = "user_id" if source_name != "community_contacts" else "community_id"
        parent_table = "app_users" if child_field == "user_id" else "communities"
        mismatch = await mismatch_count(
            connection,
            f"select count(*) from {safe_identifier(table_name)} child left join {safe_identifier(parent_table)} parent on parent.id = child.{safe_identifier(child_field)} where child.{safe_identifier(primary)} = any($1::uuid[]) and {condition}",
            ids(rows, primary),
        )
        _record_alignment(plan, source_name, "contact_visibility_alignment", mismatch)

    push_jobs = domain_rows(plan, "push_notification_jobs")
    mismatch = await mismatch_count(
        connection,
        "select count(*) from push_notification_jobs j left join events e on e.id = j.event_id left join app_users u on u.id = j.target_user_id where j.id = any($1::uuid[]) and ((j.event_id is not null and e.id is null) or (j.target_user_id is not null and u.id is null))",
        ids(push_jobs),
    )
    _record_alignment(plan, "push_notification_jobs", "push_job_alignment", mismatch)
    deliveries = domain_rows(plan, "push_notification_deliveries")
    mismatch = await mismatch_count(
        connection,
        "select count(*) from push_notification_deliveries d left join push_notification_jobs j on j.id = d.job_id left join app_users u on u.id = d.user_id where d.id = any($1::uuid[]) and (j.id is null or u.id is null)",
        ids(deliveries),
    )
    _record_alignment(plan, "push_notification_deliveries", "push_delivery_alignment", mismatch)


def _record_alignment(plan: Any, domain: str, key: str, mismatch: int) -> None:
    if domain not in plan.report["domains"]:
        return
    plan.report["domains"][domain][key] = {"mismatch_count": mismatch}
    if mismatch:
        plan.collector.add(domain, key)


async def compare_per_user_counts(connection: Any, plan: Any, source_name: str, target_name: str, user_field: str = "user_id") -> None:
    expected = Counter(row.get(user_field) for row in domain_rows(plan, source_name) if isinstance(row.get(user_field), UUID))
    if not expected:
        plan.report["domains"].get(source_name, {}).update({"per_user_count_mismatch_count": 0})
        return
    result = await connection.fetch(
        f"select {safe_identifier(user_field)} as owner_id, count(*) as row_count from {safe_identifier(target_name)} where {safe_identifier(user_field)} = any($1::uuid[]) group by {safe_identifier(user_field)}",
        list(expected),
    )
    actual = {row["owner_id"]: int(row["row_count"]) for row in result}
    mismatch = sum(1 for owner_id, count in expected.items() if actual.get(owner_id, 0) != count)
    plan.report["domains"][source_name]["per_user_count_mismatch_count"] = mismatch
    if mismatch:
        plan.collector.add(source_name, "per_user_count_mismatch")


async def validate_aggregate_domains(connection: Any, plan: Any) -> None:
    # These queries never read prayer content, feedback messages, raw device
    # tokens, push payloads, contact values, or avatar metadata.
    await compare_per_user_counts(connection, plan, "prayer_activity_logs", "prayer_activity_logs")
    await compare_per_user_counts(connection, plan, "device_tokens", "device_tokens")
    await compare_per_user_counts(connection, plan, "synced_contacts", "synced_contacts")
    feedback = domain_rows(plan, "admin_feedback")
    expected_feedback = Counter(row.get("community_id") for row in feedback if isinstance(row.get("community_id"), UUID))
    if expected_feedback:
        result = await connection.fetch(
            "select community_id, count(*) as row_count from admin_feedback where community_id = any($1::uuid[]) group by community_id",
            list(expected_feedback),
        )
        actual = {row["community_id"]: int(row["row_count"]) for row in result}
        mismatch = sum(1 for community_id, count in expected_feedback.items() if actual.get(community_id, 0) != count)
    else:
        mismatch = 0
    plan.report["domains"].get("admin_feedback", {}).update({"per_community_count_mismatch_count": mismatch})
    if mismatch:
        plan.collector.add("admin_feedback", "per_community_count_mismatch")
    plan.report["avatar"]["validation_status"] = "pending_storage_migration_no_object_upload_or_metadata_write_expected"


async def run_validation(options: argparse.Namespace) -> dict[str, Any]:
    bundle = load_export(resolve_input_dir(options.input_dir))
    plan = build_import_plan(bundle)
    plan.collector.require_clean("Artifact and mapping validation")
    database_url = validate_owner_environment(options.allow_hosted_with_owner_command)
    connection = await connect_database(database_url)
    try:
        async with connection.transaction(isolation="repeatable_read", readonly=True):
            await verify_target_schema(connection, plan)
            await compare_primary_keys(connection, plan)
            await compare_alignment(connection, plan)
            await validate_aggregate_domains(connection, plan)
        plan.collector.require_clean("Post-import validation")
        plan.report["mode"] = "aggregate_validation"
        plan.report["transaction"] = "read_only_validation_no_writes"
        plan.report["outcome"] = "passed"
        return plan.report
    finally:
        await connection.close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Aggregate-only validation of a verified PR #324 export against API PostgreSQL.",
        epilog="--help does not connect to PostgreSQL. Validation always uses a read-only transaction.",
    )
    parser.add_argument("--input-dir", required=True, help="Owner-controlled PR #324 export directory.")
    parser.add_argument("--allow-hosted-with-owner-command", action="store_true", help="Required only after separate owner approval for a non-local target.")
    parser.add_argument("--report-dir", help="Existing owner-selected directory outside this repository for an aggregate JSON report.")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    options = parser.parse_args(argv)
    report_dir = explicit_report_dir(options.report_dir)
    try:
        report = asyncio.run(run_validation(options))
        emit_report(report, report_dir, "api-postgres-validation")
        return 0
    except MigrationError as exc:
        print(f"[error] {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("[error] Validation interrupted; this utility does not commit database writes.", file=sys.stderr)
        return 1
    except Exception:
        print("[error] A filesystem or database validation operation failed without exposing records or credentials.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
