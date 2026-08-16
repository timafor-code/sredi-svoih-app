#!/usr/bin/env python3
"""Read-only, aggregate-only hygiene audit for API PostgreSQL promotion sources."""

from __future__ import annotations

import argparse
import asyncio
import importlib.util
import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

PROMOTE_PATH = Path(__file__).resolve().with_name("promote_api_data.py")

_SPEC = importlib.util.spec_from_file_location(
    "migration_api_promotion_for_hygiene",
    PROMOTE_PATH,
)
if _SPEC is None or _SPEC.loader is None:
    raise RuntimeError("API promotion module could not be loaded.")
PROMOTE = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = PROMOTE
_SPEC.loader.exec_module(PROMOTE)

FORMAT_VERSION = "api-source-hygiene-1.0.0"
AUDITED_PROMOTED_TABLES: tuple[str, ...] = PROMOTE.PROMOTED_TABLES
PRIVACY_HISTORY_TABLES: tuple[str, ...] = (
    "privacy_destruction_evidence",
    "privacy_erasure_notification_outbox",
    "privacy_requests",
    "privacy_retained_financial_evidence",
)

GENERIC_SIGNATURES: tuple[tuple[str, str], ...] = (
    ("reserved_invalid_domain", "%@example.invalid%"),
    ("synthetic_label_prefix", "Synthetic %"),
    ("synthetic_token", "%synthetic-%"),
)

KNOWN_PRIVACY_REQUEST_MESSAGES: tuple[tuple[str, str], ...] = (
    ("privacy_fixture_own_request", "Synthetic own request"),
    ("privacy_fixture_ordinary_request", "Synthetic ordinary request"),
)

_TEXT_TYPE_PREFIXES = (
    "text",
    "character varying",
    "character",
    "citext",
)


@dataclass(frozen=True)
class TableAudit:
    table: str
    row_count: int
    direct_synthetic_rows: int
    unclassified_rows: int
    signature_hits: dict[str, int]


@dataclass(frozen=True)
class LiveStateAudit:
    active_deletion_lifecycle_users: int
    pending_web_registration_intents: int
    active_invites: int
    queued_or_processing_push_jobs: int


class HygieneAuditError(PROMOTE.PromotionError):
    """Safe hygiene-audit failure without row values or secrets."""


def is_text_type(data_type: str) -> bool:
    normalized = data_type.strip().lower()
    return any(normalized.startswith(prefix) for prefix in _TEXT_TYPE_PREFIXES)


def text_columns(schema: Any) -> tuple[str, ...]:
    return tuple(name for name, data_type in schema.columns if is_text_type(data_type))


def _count_query_for_ilike(
    table_name: str,
    columns: tuple[str, ...],
    pattern: str,
) -> tuple[str, tuple[str, ...]]:
    table_sql = PROMOTE.quote_identifier(table_name)
    if not columns:
        return "SELECT 0::bigint", ()
    clauses = []
    params: list[str] = []
    for column in columns:
        params.append(pattern)
        clauses.append(
            f"{PROMOTE.quote_identifier(column)} ILIKE ${len(params)}"
        )
    predicate = " OR ".join(clauses)
    return (
        f"SELECT count(*) FROM public.{table_sql} WHERE ({predicate})",
        tuple(params),
    )


def _count_query_for_exact(
    table_name: str,
    column: str,
    value: str,
) -> tuple[str, tuple[str, ...]]:
    table_sql = PROMOTE.quote_identifier(table_name)
    column_sql = PROMOTE.quote_identifier(column)
    return (
        f"SELECT count(*) FROM public.{table_sql} WHERE {column_sql} = $1",
        (value,),
    )


def _combined_direct_query(
    table_name: str,
    columns: tuple[str, ...],
    *,
    include_privacy_messages: bool,
) -> tuple[str, tuple[str, ...]]:
    table_sql = PROMOTE.quote_identifier(table_name)
    clauses: list[str] = []
    params: list[str] = []

    for _name, pattern in GENERIC_SIGNATURES:
        for column in columns:
            params.append(pattern)
            clauses.append(
                f"{PROMOTE.quote_identifier(column)} ILIKE ${len(params)}"
            )

    if include_privacy_messages and "message" in columns:
        for _name, value in KNOWN_PRIVACY_REQUEST_MESSAGES:
            params.append(value)
            clauses.append(
                f"{PROMOTE.quote_identifier('message')} = ${len(params)}"
            )

    if not clauses:
        return "SELECT 0::bigint", ()
    return (
        f"SELECT count(*) FROM public.{table_sql} WHERE ({' OR '.join(clauses)})",
        tuple(params),
    )


async def _fetch_count(conn: Any, query: str, params: tuple[str, ...] = ()) -> int:
    if not query.lstrip().upper().startswith("SELECT "):
        raise HygieneAuditError("Hygiene audit attempted a non-read-only statement.")
    value = await conn.fetchval(query, *params)
    if value is None:
        raise HygieneAuditError("Hygiene audit count query returned no scalar result.")
    return int(value)


async def audit_table(conn: Any, schema: Any) -> TableAudit:
    columns = text_columns(schema)
    row_count = await PROMOTE.count_table(conn, schema.name)
    signature_hits: dict[str, int] = {}

    for signature_name, pattern in GENERIC_SIGNATURES:
        query, params = _count_query_for_ilike(schema.name, columns, pattern)
        signature_hits[signature_name] = await _fetch_count(conn, query, params)

    if schema.name == "privacy_requests" and "message" in columns:
        for signature_name, value in KNOWN_PRIVACY_REQUEST_MESSAGES:
            query, params = _count_query_for_exact(
                schema.name,
                "message",
                value,
            )
            signature_hits[signature_name] = await _fetch_count(conn, query, params)

    query, params = _combined_direct_query(
        schema.name,
        columns,
        include_privacy_messages=schema.name == "privacy_requests",
    )
    direct_synthetic_rows = await _fetch_count(conn, query, params)
    return TableAudit(
        table=schema.name,
        row_count=row_count,
        direct_synthetic_rows=direct_synthetic_rows,
        unclassified_rows=max(row_count - direct_synthetic_rows, 0),
        signature_hits=signature_hits,
    )


async def audit_live_state(conn: Any) -> LiveStateAudit:
    active_deletion = await _fetch_count(
        conn,
        """
        SELECT count(*)
        FROM public.app_users
        WHERE status = 'deletion_pending'
           OR deletion_requested_at IS NOT NULL
        """,
    )
    pending_web = await _fetch_count(
        conn,
        """
        SELECT count(*)
        FROM public.web_registration_intents
        WHERE status = 'email_verification_required'
          AND expires_at > now()
        """,
    )
    active_invites = await _fetch_count(
        conn,
        "SELECT count(*) FROM public.invites WHERE status = 'active'",
    )
    queued_push = await _fetch_count(
        conn,
        """
        SELECT count(*)
        FROM public.push_notification_jobs
        WHERE status IN ('queued', 'processing')
        """,
    )
    return LiveStateAudit(
        active_deletion_lifecycle_users=active_deletion,
        pending_web_registration_intents=pending_web,
        active_invites=active_invites,
        queued_or_processing_push_jobs=queued_push,
    )


def build_report(
    promoted: list[TableAudit],
    privacy_history: list[TableAudit],
    live_state: LiveStateAudit,
) -> dict[str, Any]:
    promoted_rows = sum(item.row_count for item in promoted)
    promoted_direct = sum(item.direct_synthetic_rows for item in promoted)
    privacy_rows = sum(item.row_count for item in privacy_history)
    privacy_direct = sum(item.direct_synthetic_rows for item in privacy_history)

    live_state_total = sum(asdict(live_state).values())
    review_required = bool(promoted_direct or privacy_rows or live_state_total)

    return {
        "format_version": FORMAT_VERSION,
        "alembic_head": PROMOTE.EXPECTED_ALEMBIC_HEAD,
        "verdict": (
            "review_required"
            if review_required
            else "no_direct_hygiene_blockers_detected"
        ),
        "cleanup_performed": False,
        "automatic_cleanup_allowed": False,
        "promoted_summary": {
            "table_count": len(promoted),
            "row_count": promoted_rows,
            "direct_synthetic_rows": promoted_direct,
        },
        "privacy_history_summary": {
            "table_count": len(privacy_history),
            "row_count": privacy_rows,
            "direct_synthetic_rows": privacy_direct,
        },
        "live_state": asdict(live_state),
        "promoted_tables": [asdict(item) for item in promoted],
        "privacy_history_tables": [asdict(item) for item in privacy_history],
        "notes": [
            "Counts only; no database row values are emitted.",
            "direct_synthetic_rows use deterministic test/dev sentinels only.",
            "unclassified_rows may be real data or indirectly related synthetic data and are never automatic cleanup candidates.",
            "A separate owner-approved cleanup procedure is required before any destructive change.",
        ],
    }


async def run_audit(pg_uri: str) -> dict[str, Any]:
    conn = await PROMOTE.connect(pg_uri)
    try:
        async with conn.transaction(isolation="repeatable_read", readonly=True):
            await PROMOTE.configure_stable_session(conn)
            schemas = await PROMOTE.validate_schema_classification(conn)

            promoted = [
                await audit_table(conn, schemas[table_name])
                for table_name in AUDITED_PROMOTED_TABLES
            ]
            privacy_history = [
                await audit_table(conn, schemas[table_name])
                for table_name in PRIVACY_HISTORY_TABLES
            ]
            live_state = await audit_live_state(conn)
            return build_report(promoted, privacy_history, live_state)
    finally:
        await conn.close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Read-only aggregate hygiene audit for an API PostgreSQL promotion source."
        ),
    )
    parser.add_argument(
        "--pg-env",
        default=PROMOTE.DEFAULT_PG_ENV,
        help="Owner environment variable containing the PostgreSQL URI.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print the aggregate report as JSON.",
    )
    return parser


def _print_safe_summary(report: dict[str, Any]) -> None:
    promoted = report["promoted_summary"]
    privacy = report["privacy_history_summary"]
    live = report["live_state"]
    print(
        "hygiene_audit "
        f"verdict={report['verdict']} "
        f"promoted_tables={promoted['table_count']} "
        f"promoted_rows={promoted['row_count']} "
        f"direct_synthetic_rows={promoted['direct_synthetic_rows']} "
        f"privacy_history_rows={privacy['row_count']} "
        f"active_deletion_users={live['active_deletion_lifecycle_users']}"
    )


async def _async_main(args: argparse.Namespace) -> int:
    pg_uri = PROMOTE.load_pg_uri(args.pg_env)
    report = await run_audit(pg_uri)
    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        _print_safe_summary(report)
    return 2 if report["verdict"] == "review_required" else 0


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return asyncio.run(_async_main(args))
    except PROMOTE.PromotionError as exc:
        print(f"hygiene_audit_error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
