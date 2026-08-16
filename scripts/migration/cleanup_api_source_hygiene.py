#!/usr/bin/env python3
"""Owner-run, fail-closed cleanup for the local API PostgreSQL promotion source."""

from __future__ import annotations

import argparse
import asyncio
import importlib.util
import json
import os
import sys
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlsplit

AUDIT_PATH = Path(__file__).resolve().with_name("audit_api_source_hygiene.py")
_SPEC = importlib.util.spec_from_file_location(
    "migration_api_source_hygiene_for_cleanup",
    AUDIT_PATH,
)
if _SPEC is None or _SPEC.loader is None:
    raise RuntimeError("API source hygiene audit module could not be loaded.")
AUDIT = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = AUDIT
_SPEC.loader.exec_module(AUDIT)
PROMOTE = AUDIT.PROMOTE

FORMAT_VERSION = "api-local-data-cleanup-1.0.0"
ACK_ENV = "API_LOCAL_CLEANUP_ACK"
APPLY_ACK = "OWNER_APPROVED_LOCAL_DATA_CLEANUP_APPLY"
LOCAL_HOST = "api_postgres"
LOCAL_PORT = 5432
LOCAL_DATABASE = "sredi_api"
LOCAL_USER = "sredi_api"
LOCAL_PASSWORD = "sredi_api"
LOCAL_APP_ENV = "local"

# These tables are intentionally excluded from environment promotion because they
# contain environment-bound, transient, code/token, push, invite, or privacy
# workflow state. The local source is cleaned by removing this state only after
# an owner-reviewed dry-run and verified backup/restore gate.
TRANSIENT_TABLES: tuple[str, ...] = tuple(sorted(PROMOTE.EXCLUDED_TABLES))

# Only these durable product roots may be deleted by deterministic signatures.
# There is deliberately no blanket deletion of users, events, registrations, or
# communities. Child rows may disappear only through existing database FK
# behavior when one of these directly classified roots is deleted.
SYNTHETIC_ROOT_TABLES: tuple[str, ...] = (
    "app_users",
    "communities",
    "events",
    "event_registrations",
)

# Leaked test legal documents are handled separately and last. Legal acceptances
# reference published legal documents with ON DELETE RESTRICT. A deterministic
# synthetic legal document is deletable only when no acceptance references it.
SYNTHETIC_LEGAL_DOCUMENT_TABLE = "legal_documents"
LEGAL_ACCEPTANCE_TABLE = "legal_acceptances"


class LocalCleanupError(PROMOTE.PromotionError):
    """Safe cleanup failure without database row values or secrets."""


def validate_local_environment() -> None:
    if os.environ.get("APP_ENV") != LOCAL_APP_ENV:
        raise LocalCleanupError(
            "Cleanup requires APP_ENV=local. Production or unspecified API environments "
            "are rejected before database connection."
        )


def validate_local_source_uri(pg_uri: str) -> None:
    parsed = urlsplit(PROMOTE.normalize_pg_uri(pg_uri))
    database = unquote(parsed.path.lstrip("/"))
    username = unquote(parsed.username or "")
    password = unquote(parsed.password or "")
    port = parsed.port or LOCAL_PORT
    if (
        parsed.scheme != "postgresql"
        or parsed.hostname != LOCAL_HOST
        or port != LOCAL_PORT
        or database != LOCAL_DATABASE
        or username != LOCAL_USER
        or password != LOCAL_PASSWORD
        or parsed.query
        or parsed.fragment
    ):
        raise LocalCleanupError(
            "Cleanup target must be exactly the local Docker api_postgres/sredi_api "
            "database using the fixed local development credentials. Remote, production, tunneled, and "
            "parameterized targets are rejected."
        )


def require_apply_approval(args: argparse.Namespace) -> None:
    if not args.apply:
        return
    if os.environ.get(ACK_ENV) != APPLY_ACK:
        raise LocalCleanupError(f"{ACK_ENV} must equal {APPLY_ACK} for --apply.")
    if not args.ack_dry_run_reviewed:
        raise LocalCleanupError("--apply requires --ack-dry-run-reviewed.")
    if not args.ack_backup_restored:
        raise LocalCleanupError("--apply requires --ack-backup-restored.")


def _signature_predicate(schema: Any) -> tuple[str, tuple[str, ...]]:
    columns = AUDIT.text_columns(schema)
    clauses: list[str] = []
    params: list[str] = []
    for _signature_name, pattern in AUDIT.GENERIC_SIGNATURES:
        for column in columns:
            params.append(pattern)
            clauses.append(
                f"{PROMOTE.quote_identifier(column)} ILIKE ${len(params)}"
            )
    if not clauses:
        return "FALSE", ()
    return "(" + " OR ".join(clauses) + ")", tuple(params)


def _root_count_query(schema: Any) -> tuple[str, tuple[str, ...]]:
    predicate, params = _signature_predicate(schema)
    return (
        f"SELECT count(*) FROM public.{PROMOTE.quote_identifier(schema.name)} "
        f"WHERE {predicate}",
        params,
    )


def _root_delete_query(schema: Any) -> tuple[str, tuple[str, ...]]:
    predicate, params = _signature_predicate(schema)
    return (
        f"DELETE FROM public.{PROMOTE.quote_identifier(schema.name)} "
        f"WHERE {predicate}",
        params,
    )


def _legal_document_reference_clause(*, referenced: bool) -> str:
    exists = "EXISTS" if referenced else "NOT EXISTS"
    legal_documents = PROMOTE.quote_identifier(SYNTHETIC_LEGAL_DOCUMENT_TABLE)
    legal_acceptances = PROMOTE.quote_identifier(LEGAL_ACCEPTANCE_TABLE)
    return (
        f"{exists} (SELECT 1 FROM public.{legal_acceptances} AS la "
        f"WHERE la.legal_document_id = public.{legal_documents}.id)"
    )


def _legal_document_count_query(
    schema: Any,
    *,
    protected: bool,
) -> tuple[str, tuple[str, ...]]:
    if schema.name != SYNTHETIC_LEGAL_DOCUMENT_TABLE:
        raise LocalCleanupError("Legal-document query received an unexpected table.")
    predicate, params = _signature_predicate(schema)
    reference_clause = _legal_document_reference_clause(referenced=protected)
    return (
        f"SELECT count(*) FROM public.{PROMOTE.quote_identifier(schema.name)} "
        f"WHERE {predicate} AND {reference_clause}",
        params,
    )


def _legal_document_delete_query(schema: Any) -> tuple[str, tuple[str, ...]]:
    if schema.name != SYNTHETIC_LEGAL_DOCUMENT_TABLE:
        raise LocalCleanupError("Legal-document delete received an unexpected table.")
    predicate, params = _signature_predicate(schema)
    reference_clause = _legal_document_reference_clause(referenced=False)
    return (
        f"DELETE FROM public.{PROMOTE.quote_identifier(schema.name)} "
        f"WHERE {predicate} AND {reference_clause}",
        params,
    )


def _parse_command_count(command_tag: str, expected_command: str) -> int:
    parts = command_tag.strip().split()
    if len(parts) != 2 or parts[0].upper() != expected_command.upper():
        raise LocalCleanupError("Database returned an unexpected cleanup command result.")
    try:
        return int(parts[1])
    except ValueError as exc:
        raise LocalCleanupError("Database returned an invalid cleanup row count.") from exc


async def _fetch_count(conn: Any, query: str, params: tuple[str, ...] = ()) -> int:
    if not query.lstrip().upper().startswith("SELECT "):
        raise LocalCleanupError("Cleanup count attempted a non-SELECT statement.")
    value = await conn.fetchval(query, *params)
    if value is None:
        raise LocalCleanupError("Cleanup count query returned no scalar result.")
    return int(value)


def _synthetic_candidate_tables() -> tuple[str, ...]:
    return SYNTHETIC_ROOT_TABLES + (SYNTHETIC_LEGAL_DOCUMENT_TABLE,)


async def _count_root_candidates(conn: Any, schemas: dict[str, Any]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for table_name in SYNTHETIC_ROOT_TABLES:
        query, params = _root_count_query(schemas[table_name])
        counts[table_name] = await _fetch_count(conn, query, params)

    legal_schema = schemas[SYNTHETIC_LEGAL_DOCUMENT_TABLE]
    query, params = _legal_document_count_query(legal_schema, protected=False)
    counts[SYNTHETIC_LEGAL_DOCUMENT_TABLE] = await _fetch_count(conn, query, params)
    return counts


async def _count_protected_synthetic_legal_documents(
    conn: Any,
    schemas: dict[str, Any],
) -> int:
    query, params = _legal_document_count_query(
        schemas[SYNTHETIC_LEGAL_DOCUMENT_TABLE],
        protected=True,
    )
    return await _fetch_count(conn, query, params)


async def _table_counts(
    conn: Any,
    table_names: tuple[str, ...],
) -> dict[str, int]:
    return {
        table_name: await PROMOTE.count_table(conn, table_name)
        for table_name in table_names
    }


async def _hygiene_summary(conn: Any, schemas: dict[str, Any]) -> dict[str, Any]:
    promoted = [
        await AUDIT.audit_table(conn, schemas[table_name])
        for table_name in AUDIT.AUDITED_PROMOTED_TABLES
    ]
    privacy_history = [
        await AUDIT.audit_table(conn, schemas[table_name])
        for table_name in AUDIT.PRIVACY_HISTORY_TABLES
    ]
    live_state = await AUDIT.audit_live_state(conn)
    report = AUDIT.build_report(promoted, privacy_history, live_state)
    return {
        "verdict": report["verdict"],
        "promoted_summary": report["promoted_summary"],
        "privacy_history_summary": report["privacy_history_summary"],
        "live_state": report["live_state"],
    }


async def _snapshot(conn: Any, schemas: dict[str, Any]) -> dict[str, Any]:
    promoted_table_counts = await _table_counts(
        conn,
        tuple(sorted(AUDIT.AUDITED_PROMOTED_TABLES)),
    )
    transient_table_counts = await _table_counts(conn, TRANSIENT_TABLES)
    root_candidates = await _count_root_candidates(conn, schemas)
    protected_legal_documents = await _count_protected_synthetic_legal_documents(
        conn,
        schemas,
    )
    return {
        "promoted_table_counts": promoted_table_counts,
        "transient_table_counts": transient_table_counts,
        "synthetic_root_candidates": root_candidates,
        "protected_synthetic_legal_documents": protected_legal_documents,
        "hygiene": await _hygiene_summary(conn, schemas),
    }


def _assert_no_active_deletion_lifecycle(snapshot: dict[str, Any]) -> None:
    active = int(
        snapshot["hygiene"]["live_state"].get(
            "active_deletion_lifecycle_users",
            0,
        )
    )
    if active:
        raise LocalCleanupError(
            f"Cleanup blocked: {active} user(s) still have an active deletion lifecycle. "
            "Run the canonical privacy-erasure worker to completion before cleanup."
        )


async def _delete_all_from_table(conn: Any, table_name: str) -> int:
    command = await conn.execute(
        f"DELETE FROM public.{PROMOTE.quote_identifier(table_name)}"
    )
    return _parse_command_count(command, "DELETE")


async def _delete_root_candidates(conn: Any, schema: Any) -> int:
    query, params = _root_delete_query(schema)
    command = await conn.execute(query, *params)
    return _parse_command_count(command, "DELETE")


async def _delete_unreferenced_legal_document_candidates(
    conn: Any,
    schema: Any,
) -> int:
    query, params = _legal_document_delete_query(schema)
    command = await conn.execute(query, *params)
    return _parse_command_count(command, "DELETE")


async def _execute_cleanup(
    conn: Any,
    schemas: dict[str, Any],
) -> dict[str, dict[str, int]]:
    transient_order = tuple(
        reversed(PROMOTE.topological_order(set(TRANSIENT_TABLES), schemas))
    )
    root_order = tuple(
        reversed(PROMOTE.topological_order(set(SYNTHETIC_ROOT_TABLES), schemas))
    )

    transient_deleted: dict[str, int] = {}
    for table_name in transient_order:
        transient_deleted[table_name] = await _delete_all_from_table(conn, table_name)

    roots_deleted: dict[str, int] = {}
    for table_name in root_order:
        roots_deleted[table_name] = await _delete_root_candidates(
            conn,
            schemas[table_name],
        )

    # Delete only deterministic synthetic legal documents that are no longer
    # referenced. Surviving legal_acceptances protect their document via the
    # existing ON DELETE RESTRICT contract and are never rewritten or deleted
    # merely to make source cleanup succeed.
    roots_deleted[SYNTHETIC_LEGAL_DOCUMENT_TABLE] = (
        await _delete_unreferenced_legal_document_candidates(
            conn,
            schemas[SYNTHETIC_LEGAL_DOCUMENT_TABLE],
        )
    )

    return {
        "transient_rows_deleted": dict(sorted(transient_deleted.items())),
        "synthetic_roots_deleted": dict(sorted(roots_deleted.items())),
    }


def _assert_targeted_cleanup_complete(after: dict[str, Any]) -> None:
    transient_remaining = sum(after["transient_table_counts"].values())
    roots_remaining = sum(after["synthetic_root_candidates"].values())
    if transient_remaining:
        raise LocalCleanupError(
            "Targeted transient cleanup left rows behind; transaction will be rolled back."
        )
    if roots_remaining:
        raise LocalCleanupError(
            "Targeted deterministic synthetic roots or unreferenced legal documents remain; "
            "transaction will be rolled back."
        )


def _apply_blocked(after: dict[str, Any]) -> bool:
    return int(after.get("protected_synthetic_legal_documents", 0)) > 0


def _assert_apply_not_blocked(after: dict[str, Any]) -> None:
    protected = int(after.get("protected_synthetic_legal_documents", 0))
    if protected:
        raise LocalCleanupError(
            f"Cleanup apply blocked: {protected} deterministic synthetic legal document(s) "
            "remain protected by legal acceptances. Resolve their classification separately; "
            "no cleanup changes were committed."
        )


def _build_report(
    *,
    apply: bool,
    before: dict[str, Any],
    after: dict[str, Any],
    deleted: dict[str, dict[str, int]],
) -> dict[str, Any]:
    protected = int(after.get("protected_synthetic_legal_documents", 0))
    return {
        "format_version": FORMAT_VERSION,
        "alembic_head": PROMOTE.EXPECTED_ALEMBIC_HEAD,
        "target": "local_docker_api_postgres/sredi_api",
        "mode": "apply" if apply else "dry_run_rollback",
        "cleanup_performed": apply,
        "simulation_performed": not apply,
        "apply_blocked": protected > 0,
        "protected_synthetic_legal_documents": protected,
        "before": before,
        "planned_or_applied_deletes": deleted,
        "after_simulated_or_committed": after,
        "notes": [
            "Aggregate counts only; no database row values or identifiers are emitted.",
            "Dry-run executes the exact cleanup inside one transaction and rolls it back.",
            "Cleanup refuses to run while any app user has an active deletion lifecycle.",
            "Apply requires owner-reviewed dry-run, verified backup restore, and explicit acknowledgement.",
            "All environment-bound/transient promotion-excluded tables are cleared only after the lifecycle guard passes.",
            "Durable deletion is limited to deterministic signature matches in reviewed root tables.",
            "Only unreferenced deterministic synthetic legal documents are cleanup candidates.",
            "Referenced deterministic synthetic legal documents are reported as protected and block apply.",
            "Legal acceptances are never deleted or rewritten merely to make cleanup succeed.",
            "A separate read-only hygiene audit must be rerun and owner-approved after apply.",
        ],
    }


async def run_cleanup(pg_uri: str, *, apply: bool) -> dict[str, Any]:
    validate_local_environment()
    validate_local_source_uri(pg_uri)
    conn = await PROMOTE.connect(pg_uri)
    tx = conn.transaction(isolation="serializable")
    await tx.start()
    try:
        await PROMOTE.configure_stable_session(conn)
        schemas = await PROMOTE.validate_schema_classification(conn)
        before = await _snapshot(conn, schemas)
        _assert_no_active_deletion_lifecycle(before)
        deleted = await _execute_cleanup(conn, schemas)
        after = await _snapshot(conn, schemas)
        _assert_targeted_cleanup_complete(after)
        report = _build_report(
            apply=apply,
            before=before,
            after=after,
            deleted=deleted,
        )
        if apply:
            _assert_apply_not_blocked(after)
            await tx.commit()
        else:
            await tx.rollback()
        return report
    except Exception:
        try:
            await tx.rollback()
        except Exception:  # noqa: BLE001
            pass
        raise
    finally:
        await conn.close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Dry-run-first cleanup for the exact local Docker sredi_api promotion source."
        ),
    )
    parser.add_argument(
        "--pg-env",
        default=PROMOTE.DEFAULT_PG_ENV,
        help="Owner environment variable containing the local PostgreSQL URI.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Commit cleanup instead of rolling the transaction back.",
    )
    parser.add_argument(
        "--ack-dry-run-reviewed",
        action="store_true",
        help="Required with --apply after the owner reviews the exact dry-run report.",
    )
    parser.add_argument(
        "--ack-backup-restored",
        action="store_true",
        help="Required with --apply after a fresh source backup was restored successfully.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print the aggregate report as JSON.",
    )
    return parser


def _print_safe_summary(report: dict[str, Any]) -> None:
    before = report["before"]["hygiene"]
    after = report["after_simulated_or_committed"]["hygiene"]
    deleted = report["planned_or_applied_deletes"]
    print(
        "local_data_cleanup "
        f"mode={report['mode']} "
        f"before_verdict={before['verdict']} "
        f"after_verdict={after['verdict']} "
        f"transient_deleted={sum(deleted['transient_rows_deleted'].values())} "
        f"synthetic_roots_deleted={sum(deleted['synthetic_roots_deleted'].values())} "
        f"protected_synthetic_legal_documents={report['protected_synthetic_legal_documents']} "
        f"apply_blocked={str(report['apply_blocked']).lower()}"
    )


async def _async_main(args: argparse.Namespace) -> int:
    require_apply_approval(args)
    pg_uri = PROMOTE.load_pg_uri(args.pg_env)
    report = await run_cleanup(pg_uri, apply=args.apply)
    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        _print_safe_summary(report)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return asyncio.run(_async_main(args))
    except PROMOTE.PromotionError as exc:
        print(f"local_data_cleanup_error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
