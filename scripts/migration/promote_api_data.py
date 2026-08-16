#!/usr/bin/env python3
"""Fail-closed owner utility for promoting durable API PostgreSQL data.

The source and target are both the repository-owned FastAPI/PostgreSQL schema.
This utility intentionally excludes environment-bound/transient state and never
touches Supabase. It does not load dotenv files or print database row values.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncIterator
from urllib.parse import urlsplit

import asyncpg


FORMAT_VERSION = "api-promotion-1.0.0"
EXPECTED_ALEMBIC_HEAD = "20260813210000"
REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATABASE_ENV = "DATABASE_URL"
ACK_ENV = "API_PROMOTION_RUN_ACK"
EXPORT_ACK = "OWNER_APPROVED_API_PROMOTION_EXPORT"
APPLY_ACK = "OWNER_APPROVED_API_PROMOTION_APPLY"
SAFE_SQL_IDENTIFIER = re.compile(r"^[a-z_][a-z0-9_]*$")
SAFE_ENV_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

# Explicit, reviewed API-owned data that is portable between environments when
# source and target are on the same Alembic head.
PROMOTED_TABLES: tuple[str, ...] = (
    "admin_event_audit_entries",
    "admin_feedback",
    "app_users",
    "communities",
    "community_contacts",
    "community_event_locations",
    "community_memberships",
    "event_capacity_units",
    "event_categories",
    "event_images",
    "event_import_items",
    "event_import_runs",
    "event_import_sources",
    "event_occurrences",
    "event_participation_option_capacity_units",
    "event_participation_options",
    "event_public_slugs",
    "event_registration_answers",
    "event_registration_capacity_reservations",
    "event_registration_form_fields",
    "event_registration_forms",
    "event_registration_option_selections",
    "event_registrations",
    "event_seating_assignments",
    "event_seating_layout_templates",
    "event_seating_layouts",
    "event_seating_table_connections",
    "event_seating_tables",
    "events",
    "legal_acceptances",
    "legal_documents",
    "prayer_activity_logs",
    "profile_avatars",
    "profile_contact_visibility",
    "profiles",
    "synced_contacts",
)

# These rows are intentionally not portable. Several contain HMACs/encryption
# bound to deployment secrets; others are in-flight delivery/runtime state.
EXCLUDED_TABLES: dict[str, str] = {
    "auth_email_verification_codes": "one-time auth code state",
    "auth_sessions": "environment-bound refresh-session state",
    "auth_set_password_codes": "one-time auth code state",
    "device_tokens": "environment/device push registration state",
    "invites": "invite code hashes are bound to API_TOKEN_HASH_SECRET",
    "password_reset_codes": "one-time auth code state",
    "privacy_access_codes": "one-time privacy access code state",
    "privacy_access_sessions": "environment-bound privacy access session state",
    "privacy_destruction_evidence": "subject hashes are bound to deployment secrets",
    "privacy_erasure_notification_outbox": "encrypted environment-bound delivery state",
    "privacy_requests": "privacy workflow state requires a separate continuity decision",
    "privacy_retained_financial_evidence": "subject hashes are bound to deployment secrets",
    "push_notification_deliveries": "environment-bound push delivery state",
    "push_notification_jobs": "environment-bound push queue state",
    "web_registration_identity_conflicts": "in-flight web registration resolution state",
    "web_registration_intents": "in-flight flow-token/idempotency state",
    "web_registration_verification_codes": "one-time web registration code state",
}

CLASSIFIED_TABLES = frozenset(PROMOTED_TABLES) | frozenset(EXCLUDED_TABLES)
SYSTEM_TABLES = frozenset({"alembic_version"})
OBJECT_METADATA_TABLES = frozenset({"profile_avatars", "event_images"})


class PromotionError(RuntimeError):
    """An error whose text is safe to show without database values or secrets."""


@dataclass(frozen=True)
class TableSchema:
    name: str
    columns: tuple[tuple[str, str], ...]
    primary_key: tuple[str, ...]
    dependencies: tuple[str, ...]


def quote_identifier(value: str) -> str:
    if not SAFE_SQL_IDENTIFIER.fullmatch(value):
        raise PromotionError("Unsafe SQL identifier in reviewed table metadata.")
    return f'"{value}"'


def normalize_database_url(value: str) -> str:
    value = value.strip()
    if value.startswith("postgresql+asyncpg://"):
        return "postgresql://" + value.removeprefix("postgresql+asyncpg://")
    if value.startswith("postgres://"):
        return "postgresql://" + value.removeprefix("postgres://")
    return value


def load_database_url(env_name: str) -> str:
    if not SAFE_ENV_NAME.fullmatch(env_name):
        raise PromotionError("Database environment variable name is invalid.")
    raw = os.environ.get(env_name, "").strip()
    if not raw:
        raise PromotionError(f"{env_name} must be supplied by the owner environment.")
    normalized = normalize_database_url(raw)
    parsed = urlsplit(normalized)
    if parsed.scheme != "postgresql" or not parsed.hostname:
        raise PromotionError(f"{env_name} is not a PostgreSQL connection URL.")
    return normalized


def require_ack(expected: str) -> None:
    if os.environ.get(ACK_ENV) != expected:
        raise PromotionError(f"{ACK_ENV} must equal {expected} for this operation.")


def path_is_inside_repository(path: Path) -> bool:
    try:
        path.resolve().relative_to(REPOSITORY_ROOT.resolve())
        return True
    except ValueError:
        return False


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


async def connect(database_url: str) -> asyncpg.Connection:
    try:
        return await asyncpg.connect(database_url)
    except Exception as exc:  # noqa: BLE001 - never leak driver details
        raise PromotionError("Database connection failed; details are intentionally redacted.") from exc


async def current_alembic_head(conn: asyncpg.Connection) -> str:
    try:
        rows = await conn.fetch("SELECT version_num FROM public.alembic_version")
    except Exception as exc:  # noqa: BLE001
        raise PromotionError("Could not read Alembic version state.") from exc
    if len(rows) != 1:
        raise PromotionError("Alembic version state must contain exactly one head row.")
    return str(rows[0]["version_num"])


async def public_tables(conn: asyncpg.Connection) -> set[str]:
    rows = await conn.fetch(
        """
        SELECT c.relname AS table_name
        FROM pg_catalog.pg_class AS c
        JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
        ORDER BY c.relname
        """
    )
    return {str(row["table_name"]) for row in rows}


async def table_schema(conn: asyncpg.Connection, table_name: str) -> TableSchema:
    quote_identifier(table_name)
    column_rows = await conn.fetch(
        """
        SELECT
            a.attname AS column_name,
            pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type
        FROM pg_catalog.pg_attribute AS a
        JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
        JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = $1
          AND a.attnum > 0
          AND NOT a.attisdropped
        ORDER BY a.attnum
        """,
        table_name,
    )
    if not column_rows:
        raise PromotionError(f"Reviewed table {table_name} is missing from the schema.")

    pk_rows = await conn.fetch(
        """
        SELECT a.attname AS column_name
        FROM pg_catalog.pg_index AS i
        JOIN pg_catalog.pg_class AS c ON c.oid = i.indrelid
        JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
        JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS key(attnum, ordinality)
          ON TRUE
        JOIN pg_catalog.pg_attribute AS a
          ON a.attrelid = c.oid AND a.attnum = key.attnum
        WHERE n.nspname = 'public'
          AND c.relname = $1
          AND i.indisprimary
        ORDER BY key.ordinality
        """,
        table_name,
    )
    if not pk_rows:
        raise PromotionError(f"Reviewed table {table_name} must have a primary key.")

    dependency_rows = await conn.fetch(
        """
        SELECT DISTINCT parent.relname AS dependency
        FROM pg_catalog.pg_constraint AS con
        JOIN pg_catalog.pg_class AS child ON child.oid = con.conrelid
        JOIN pg_catalog.pg_namespace AS child_ns ON child_ns.oid = child.relnamespace
        JOIN pg_catalog.pg_class AS parent ON parent.oid = con.confrelid
        JOIN pg_catalog.pg_namespace AS parent_ns ON parent_ns.oid = parent.relnamespace
        WHERE con.contype = 'f'
          AND child_ns.nspname = 'public'
          AND parent_ns.nspname = 'public'
          AND child.relname = $1
        ORDER BY parent.relname
        """,
        table_name,
    )
    return TableSchema(
        name=table_name,
        columns=tuple(
            (str(row["column_name"]), str(row["data_type"])) for row in column_rows
        ),
        primary_key=tuple(str(row["column_name"]) for row in pk_rows),
        dependencies=tuple(
            str(row["dependency"])
            for row in dependency_rows
            if str(row["dependency"]) != table_name
        ),
    )


async def validate_schema_classification(
    conn: asyncpg.Connection,
) -> dict[str, TableSchema]:
    head = await current_alembic_head(conn)
    if head != EXPECTED_ALEMBIC_HEAD:
        raise PromotionError(
            f"Alembic head mismatch: expected {EXPECTED_ALEMBIC_HEAD}, found {head}."
        )

    actual = await public_tables(conn)
    unknown = sorted(actual - CLASSIFIED_TABLES - SYSTEM_TABLES)
    missing = sorted(CLASSIFIED_TABLES - actual)
    if unknown:
        raise PromotionError(
            "Schema contains unclassified public table(s): " + ", ".join(unknown)
        )
    if missing:
        raise PromotionError(
            "Schema is missing reviewed public table(s): " + ", ".join(missing)
        )

    schemas: dict[str, TableSchema] = {}
    for table_name in sorted(CLASSIFIED_TABLES):
        schemas[table_name] = await table_schema(conn, table_name)
    return schemas


async def configure_stable_session(conn: asyncpg.Connection) -> None:
    await conn.execute("SET LOCAL TIME ZONE 'UTC'")
    await conn.execute("SET LOCAL DateStyle = 'ISO, YMD'")


def topological_order(
    promoted: set[str], schemas: dict[str, TableSchema]
) -> tuple[str, ...]:
    remaining = set(promoted)
    ordered: list[str] = []
    while remaining:
        ready = sorted(
            table
            for table in remaining
            if not (set(schemas[table].dependencies) & remaining)
        )
        if not ready:
            raise PromotionError("Promoted-table foreign-key graph contains a cycle.")
        ordered.extend(ready)
        remaining.difference_update(ready)
    return tuple(ordered)


async def row_json_stream(
    conn: asyncpg.Connection, schema: TableSchema
) -> AsyncIterator[str]:
    table_sql = quote_identifier(schema.name)
    order_sql = ", ".join(quote_identifier(column) for column in schema.primary_key)
    statement = await conn.prepare(
        f"SELECT row_to_json(t)::text AS row_json "
        f"FROM public.{table_sql} AS t ORDER BY {order_sql}"
    )
    async for row in statement.cursor(prefetch=500):
        yield str(row["row_json"])


async def count_table(conn: asyncpg.Connection, table_name: str) -> int:
    table_sql = quote_identifier(table_name)
    return int(await conn.fetchval(f"SELECT count(*) FROM public.{table_sql}"))


async def hash_table_from_database(
    conn: asyncpg.Connection, schema: TableSchema
) -> tuple[int, str]:
    digest = hashlib.sha256()
    row_count = 0
    async for row_json in row_json_stream(conn, schema):
        digest.update(row_json.encode("utf-8"))
        digest.update(b"\n")
        row_count += 1
    return row_count, digest.hexdigest()


async def source_live_state_guards(
    conn: asyncpg.Connection,
    *,
    ack_reissue_active_invites: bool,
    ack_excluded_privacy_history: bool,
) -> dict[str, int]:
    deletion_pending = int(
        await conn.fetchval(
            """
            SELECT count(*)
            FROM public.app_users
            WHERE status = 'deletion_pending'
               OR deletion_requested_at IS NOT NULL
            """
        )
    )
    if deletion_pending:
        raise PromotionError(
            f"Source has {deletion_pending} user(s) with an active deletion lifecycle; "
            "finish or cancel it before promotion."
        )

    pending_web = int(
        await conn.fetchval(
            """
            SELECT count(*)
            FROM public.web_registration_intents
            WHERE status = 'email_verification_required'
              AND expires_at > now()
            """
        )
    )
    if pending_web:
        raise PromotionError(
            f"Source has {pending_web} unexpired web-registration intent(s); "
            "finish or let them expire before promotion."
        )

    active_invites = int(
        await conn.fetchval(
            "SELECT count(*) FROM public.invites WHERE status = 'active'"
        )
    )
    if active_invites and not ack_reissue_active_invites:
        raise PromotionError(
            f"Source has {active_invites} active invite(s). Invite hashes are not portable; "
            "review reissue and rerun export with --ack-reissue-active-invites."
        )

    queued_push = int(
        await conn.fetchval(
            """
            SELECT count(*)
            FROM public.push_notification_jobs
            WHERE status IN ('queued', 'processing')
            """
        )
    )
    if queued_push:
        raise PromotionError(
            f"Source has {queued_push} queued/processing push job(s); "
            "resolve them before promotion."
        )

    privacy_history = 0
    for table_name in (
        "privacy_destruction_evidence",
        "privacy_erasure_notification_outbox",
        "privacy_requests",
        "privacy_retained_financial_evidence",
    ):
        privacy_history += await count_table(conn, table_name)
    if privacy_history and not ack_excluded_privacy_history:
        raise PromotionError(
            f"Source has {privacy_history} privacy workflow/evidence row(s) excluded from "
            "this environment promotion. Review continuity and rerun with "
            "--ack-excluded-privacy-history only for owner-approved test/staging promotion."
        )

    return {
        "active_invites": active_invites,
        "privacy_history_rows": privacy_history,
    }


def ensure_output_directory(path: Path, *, allow_in_repository: bool) -> None:
    if path.exists() and path.is_symlink():
        raise PromotionError("Output directory must not be a symbolic link.")
    if path_is_inside_repository(path) and not allow_in_repository:
        raise PromotionError(
            "Output directory must be outside the repository unless "
            "--allow-output-in-repository is explicitly supplied."
        )
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if any(path.iterdir()):
        raise PromotionError("Output directory must be empty.")


def manifest_table_entry(
    schema: TableSchema, *, row_count: int, checksum: str
) -> dict[str, Any]:
    return {
        "name": schema.name,
        "path": f"tables/{schema.name}.jsonl",
        "row_count": row_count,
        "sha256": checksum,
        "columns": [
            {"name": name, "type": data_type} for name, data_type in schema.columns
        ],
        "primary_key": list(schema.primary_key),
        "dependencies": list(schema.dependencies),
    }


async def export_artifact(args: argparse.Namespace) -> None:
    require_ack(EXPORT_ACK)
    output_dir = Path(args.output_dir).expanduser()
    ensure_output_directory(
        output_dir,
        allow_in_repository=args.allow_output_in_repository,
    )
    tables_dir = output_dir / "tables"
    tables_dir.mkdir(mode=0o700)

    conn = await connect(load_database_url(args.database_url_env))
    try:
        async with conn.transaction(isolation="repeatable_read", readonly=True):
            await configure_stable_session(conn)
            schemas = await validate_schema_classification(conn)
            guard_counts = await source_live_state_guards(
                conn,
                ack_reissue_active_invites=args.ack_reissue_active_invites,
                ack_excluded_privacy_history=args.ack_excluded_privacy_history,
            )
            order = topological_order(set(PROMOTED_TABLES), schemas)

            entries: list[dict[str, Any]] = []
            for table_name in order:
                schema = schemas[table_name]
                artifact_path = tables_dir / f"{table_name}.jsonl"
                digest = hashlib.sha256()
                row_count = 0
                with artifact_path.open("x", encoding="utf-8", newline="\n") as handle:
                    async for row_json in row_json_stream(conn, schema):
                        handle.write(row_json)
                        handle.write("\n")
                        digest.update(row_json.encode("utf-8"))
                        digest.update(b"\n")
                        row_count += 1
                checksum = digest.hexdigest()
                entries.append(
                    manifest_table_entry(
                        schema,
                        row_count=row_count,
                        checksum=checksum,
                    )
                )
                print(f"exported table={table_name} rows={row_count} sha256={checksum}")

            excluded_counts = {
                table_name: await count_table(conn, table_name)
                for table_name in sorted(EXCLUDED_TABLES)
            }

        object_rows = {
            table_name: next(
                int(entry["row_count"])
                for entry in entries
                if entry["name"] == table_name
            )
            for table_name in sorted(OBJECT_METADATA_TABLES)
        }
        manifest = {
            "format_version": FORMAT_VERSION,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "alembic_head": EXPECTED_ALEMBIC_HEAD,
            "tables": entries,
            "excluded_tables": [
                {
                    "name": table_name,
                    "reason": EXCLUDED_TABLES[table_name],
                    "source_row_count": excluded_counts[table_name],
                }
                for table_name in sorted(EXCLUDED_TABLES)
            ],
            "source_guards": guard_counts,
            "object_storage": {
                "metadata_rows": object_rows,
                "requires_object_copy": any(object_rows.values()),
                "object_keys_must_be_preserved": True,
            },
        }
        manifest_path = output_dir / "manifest.json"
        manifest_path.write_text(
            json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

        checksum_lines = [f"{sha256_file(manifest_path)}  manifest.json"]
        checksum_lines.extend(
            f"{entry['sha256']}  {entry['path']}" for entry in entries
        )
        (output_dir / "checksums.sha256").write_text(
            "\n".join(checksum_lines) + "\n",
            encoding="utf-8",
        )
        print(
            f"export_complete tables={len(entries)} output={output_dir} "
            f"object_storage_required={str(any(object_rows.values())).lower()}"
        )
    finally:
        await conn.close()


def validate_jsonl(entry: dict[str, Any], artifact_path: Path) -> None:
    column_entries = entry.get("columns")
    if not isinstance(column_entries, list):
        raise PromotionError(f"Column metadata invalid for table {entry.get('name')}.")
    columns = [
        column.get("name") for column in column_entries if isinstance(column, dict)
    ]
    if not columns or len(columns) != len(column_entries):
        raise PromotionError(f"Column metadata invalid for table {entry.get('name')}.")
    column_set = set(columns)
    primary_key = entry.get("primary_key")
    if (
        not isinstance(primary_key, list)
        or not primary_key
        or not set(primary_key) <= column_set
    ):
        raise PromotionError(f"Primary-key metadata invalid for table {entry.get('name')}.")

    seen_keys: set[str] = set()
    row_count = 0
    with artifact_path.open("r", encoding="utf-8") as handle:
        for row_number, line in enumerate(handle, start=1):
            try:
                row = json.loads(line)
            except Exception as exc:  # noqa: BLE001
                raise PromotionError(
                    f"Invalid JSONL in table {entry.get('name')} row {row_number}."
                ) from exc
            if not isinstance(row, dict) or set(row) != column_set:
                raise PromotionError(
                    f"Column mismatch in table {entry.get('name')} row {row_number}."
                )
            key = json.dumps(
                [row[column] for column in primary_key],
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            )
            if key in seen_keys:
                raise PromotionError(f"Duplicate primary key in table {entry.get('name')}.")
            seen_keys.add(key)
            row_count += 1
    if row_count != int(entry.get("row_count", -1)):
        raise PromotionError(f"Row-count mismatch for table {entry.get('name')}.")


def load_manifest(input_dir: Path) -> dict[str, Any]:
    if not input_dir.is_dir() or input_dir.is_symlink():
        raise PromotionError("Input directory is missing or unsafe.")

    for path in input_dir.rglob("*"):
        if path.is_symlink():
            raise PromotionError("Promotion artifact must not contain symbolic links.")

    manifest_path = input_dir / "manifest.json"
    checksums_path = input_dir / "checksums.sha256"
    tables_dir = input_dir / "tables"
    if not manifest_path.is_file() or not checksums_path.is_file() or not tables_dir.is_dir():
        raise PromotionError("Promotion artifact layout is incomplete.")

    actual_dirs = {
        str(path.relative_to(input_dir)).replace("\\", "/")
        for path in input_dir.rglob("*")
        if path.is_dir()
    }
    if actual_dirs != {"tables"}:
        raise PromotionError("Promotion artifact contains an undeclared directory.")

    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        raise PromotionError("manifest.json is invalid.") from exc
    if manifest.get("format_version") != FORMAT_VERSION:
        raise PromotionError("Promotion artifact format version is unsupported.")
    if manifest.get("alembic_head") != EXPECTED_ALEMBIC_HEAD:
        raise PromotionError("Promotion artifact Alembic head is unsupported.")

    entries = manifest.get("tables")
    if not isinstance(entries, list):
        raise PromotionError("Promotion manifest table list is invalid.")
    declared = {entry.get("name") for entry in entries if isinstance(entry, dict)}
    if declared != set(PROMOTED_TABLES) or len(entries) != len(PROMOTED_TABLES):
        raise PromotionError("Promotion manifest table allowlist does not match this release.")

    excluded = manifest.get("excluded_tables")
    if not isinstance(excluded, list):
        raise PromotionError("Promotion manifest excluded-table list is invalid.")
    excluded_declared = {
        entry.get("name") for entry in excluded if isinstance(entry, dict)
    }
    if (
        excluded_declared != set(EXCLUDED_TABLES)
        or len(excluded) != len(EXCLUDED_TABLES)
    ):
        raise PromotionError("Promotion manifest excluded-table set does not match this release.")

    expected_files = {"manifest.json", "checksums.sha256"}
    checksum_expected: dict[str, str] = {}
    for entry in entries:
        table_name = str(entry["name"])
        relative_path = str(entry.get("path", ""))
        expected_path = f"tables/{table_name}.jsonl"
        if relative_path != expected_path:
            raise PromotionError(f"Artifact path mismatch for table {table_name}.")
        expected_files.add(expected_path)
        artifact_path = input_dir / relative_path
        if not artifact_path.is_file() or artifact_path.is_symlink():
            raise PromotionError(f"Artifact file missing or unsafe for table {table_name}.")
        actual_hash = sha256_file(artifact_path)
        if actual_hash != entry.get("sha256"):
            raise PromotionError(f"Checksum mismatch for table {table_name}.")
        checksum_expected[relative_path] = actual_hash
        validate_jsonl(entry, artifact_path)

    actual_files = {
        str(path.relative_to(input_dir)).replace("\\", "/")
        for path in input_dir.rglob("*")
        if path.is_file()
    }
    if actual_files != expected_files:
        raise PromotionError("Promotion artifact contains missing or undeclared files.")

    checksum_expected["manifest.json"] = sha256_file(manifest_path)
    parsed_index: dict[str, str] = {}
    for line in checksums_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        parts = line.split(None, 1)
        if len(parts) != 2:
            raise PromotionError("checksums.sha256 contains an invalid line.")
        digest, relative_path = parts
        relative_path = relative_path.strip().removeprefix("*")
        if relative_path in parsed_index:
            raise PromotionError("checksums.sha256 contains a duplicate path.")
        parsed_index[relative_path] = digest
    if parsed_index != checksum_expected:
        raise PromotionError("checksums.sha256 does not match declared artifacts.")
    return manifest


def manifest_schemas(manifest: dict[str, Any]) -> dict[str, TableSchema]:
    result: dict[str, TableSchema] = {}
    for entry in manifest["tables"]:
        result[str(entry["name"])] = TableSchema(
            name=str(entry["name"]),
            columns=tuple(
                (str(column["name"]), str(column["type"]))
                for column in entry["columns"]
            ),
            primary_key=tuple(str(value) for value in entry["primary_key"]),
            dependencies=tuple(str(value) for value in entry["dependencies"]),
        )
    return result


async def validate_target_schema(
    conn: asyncpg.Connection, manifest: dict[str, Any]
) -> dict[str, TableSchema]:
    target_schemas = await validate_schema_classification(conn)
    artifact_schemas = manifest_schemas(manifest)
    for table_name in PROMOTED_TABLES:
        target = target_schemas[table_name]
        artifact = artifact_schemas[table_name]
        if (
            target.columns != artifact.columns
            or target.primary_key != artifact.primary_key
            or target.dependencies != artifact.dependencies
        ):
            raise PromotionError(f"Target schema mismatch for table {table_name}.")
    return target_schemas


async def require_empty_target(conn: asyncpg.Connection) -> None:
    nonempty: list[tuple[str, int]] = []
    for table_name in sorted(CLASSIFIED_TABLES):
        count = await count_table(conn, table_name)
        if count:
            nonempty.append((table_name, count))
    if nonempty:
        summary = ", ".join(f"{name}={count}" for name, count in nonempty)
        raise PromotionError(
            "Target database is not empty for promotion-managed tables: " + summary
        )


def object_storage_required(manifest: dict[str, Any]) -> bool:
    value = manifest.get("object_storage", {})
    return bool(isinstance(value, dict) and value.get("requires_object_copy"))


def require_object_storage_ack(manifest: dict[str, Any], acknowledged: bool) -> None:
    if object_storage_required(manifest) and not acknowledged:
        raise PromotionError(
            "Artifact contains avatar/event-image metadata. Copy and verify objects "
            "with identical object keys first, then rerun with --ack-object-storage-ready."
        )


async def preflight_target(args: argparse.Namespace) -> None:
    input_dir = Path(args.input_dir).expanduser().resolve()
    manifest = load_manifest(input_dir)
    require_object_storage_ack(manifest, args.ack_object_storage_ready)

    conn = await connect(load_database_url(args.database_url_env))
    try:
        async with conn.transaction(isolation="repeatable_read", readonly=True):
            await configure_stable_session(conn)
            await validate_target_schema(conn, manifest)
            await require_empty_target(conn)
        print(
            f"preflight_ok tables={len(PROMOTED_TABLES)} "
            f"object_storage_required={str(object_storage_required(manifest)).lower()}"
        )
    finally:
        await conn.close()


async def insert_table(
    conn: asyncpg.Connection,
    schema: TableSchema,
    artifact_path: Path,
) -> int:
    table_sql = quote_identifier(schema.name)
    insert_sql = (
        f"INSERT INTO public.{table_sql} "
        f"SELECT * FROM json_populate_record(NULL::public.{table_sql}, $1::json)"
    )
    inserted = 0
    with artifact_path.open("r", encoding="utf-8") as handle:
        for line in handle:
            try:
                await conn.execute(insert_sql, line)
            except Exception as exc:  # noqa: BLE001
                raise PromotionError(
                    f"Insert failed for table {schema.name}; transaction will roll back."
                ) from exc
            inserted += 1
    return inserted


async def verify_database_matches_artifact(
    conn: asyncpg.Connection,
    manifest: dict[str, Any],
    schemas: dict[str, TableSchema],
) -> None:
    entries = {str(entry["name"]): entry for entry in manifest["tables"]}
    for table_name in topological_order(set(PROMOTED_TABLES), schemas):
        count, checksum = await hash_table_from_database(conn, schemas[table_name])
        expected_count = int(entries[table_name]["row_count"])
        expected_checksum = str(entries[table_name]["sha256"])
        if count != expected_count or checksum != expected_checksum:
            raise PromotionError(f"Target verification mismatch for table {table_name}.")
    for table_name in sorted(EXCLUDED_TABLES):
        if await count_table(conn, table_name):
            raise PromotionError(f"Excluded target table {table_name} is not empty.")


async def apply_target(args: argparse.Namespace) -> None:
    require_ack(APPLY_ACK)
    input_dir = Path(args.input_dir).expanduser().resolve()
    manifest = load_manifest(input_dir)
    require_object_storage_ack(manifest, args.ack_object_storage_ready)

    if os.environ.get("APP_ENV", "").strip().lower() == "production":
        if not args.allow_production_target_with_owner_command:
            raise PromotionError(
                "Production apply requires --allow-production-target-with-owner-command."
            )

    conn = await connect(load_database_url(args.database_url_env))
    try:
        async with conn.transaction(isolation="serializable"):
            await configure_stable_session(conn)
            schemas = await validate_target_schema(conn, manifest)
            await require_empty_target(conn)

            entries = {str(entry["name"]): entry for entry in manifest["tables"]}
            order = topological_order(set(PROMOTED_TABLES), schemas)
            for table_name in order:
                inserted = await insert_table(
                    conn,
                    schemas[table_name],
                    input_dir / str(entries[table_name]["path"]),
                )
                if inserted != int(entries[table_name]["row_count"]):
                    raise PromotionError(f"Insert count mismatch for table {table_name}.")
                print(f"applied table={table_name} rows={inserted}")

            await verify_database_matches_artifact(conn, manifest, schemas)
        print(f"apply_complete tables={len(PROMOTED_TABLES)}")
    finally:
        await conn.close()


async def validate_target(args: argparse.Namespace) -> None:
    input_dir = Path(args.input_dir).expanduser().resolve()
    manifest = load_manifest(input_dir)

    conn = await connect(load_database_url(args.database_url_env))
    try:
        async with conn.transaction(isolation="repeatable_read", readonly=True):
            await configure_stable_session(conn)
            schemas = await validate_target_schema(conn, manifest)
            await verify_database_matches_artifact(conn, manifest, schemas)
        print(f"validation_ok tables={len(PROMOTED_TABLES)}")
    finally:
        await conn.close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Owner-run fail-closed promotion of durable data between identical "
            "Sredi Svoih API PostgreSQL schemas."
        )
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    export_parser = subparsers.add_parser("export", help="Export durable API data.")
    export_parser.add_argument("--output-dir", required=True)
    export_parser.add_argument(
        "--database-url-env",
        default=DEFAULT_DATABASE_ENV,
        help="Environment variable containing the PostgreSQL URL.",
    )
    export_parser.add_argument("--allow-output-in-repository", action="store_true")
    export_parser.add_argument("--ack-reissue-active-invites", action="store_true")
    export_parser.add_argument("--ack-excluded-privacy-history", action="store_true")

    for name, help_text in (
        ("preflight", "Validate artifact and an empty target without writes."),
        ("apply", "Atomically insert the artifact into an empty target."),
        ("validate", "Read-only exact count/checksum validation after apply."),
    ):
        child = subparsers.add_parser(name, help=help_text)
        child.add_argument("--input-dir", required=True)
        child.add_argument(
            "--database-url-env",
            default=DEFAULT_DATABASE_ENV,
            help="Environment variable containing the PostgreSQL URL.",
        )
        if name in {"preflight", "apply"}:
            child.add_argument("--ack-object-storage-ready", action="store_true")
        if name == "apply":
            child.add_argument(
                "--allow-production-target-with-owner-command",
                action="store_true",
            )

    return parser


async def async_main(args: argparse.Namespace) -> None:
    if args.command == "export":
        await export_artifact(args)
    elif args.command == "preflight":
        await preflight_target(args)
    elif args.command == "apply":
        await apply_target(args)
    elif args.command == "validate":
        await validate_target(args)
    else:  # pragma: no cover - argparse prevents this
        raise PromotionError("Unsupported command.")


def main() -> int:
    os.umask(0o077)
    args = build_parser().parse_args()
    try:
        asyncio.run(async_main(args))
        return 0
    except PromotionError as exc:
        print(f"promotion_error: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("promotion_error: interrupted by owner", file=sys.stderr)
        return 130
    except Exception:  # noqa: BLE001 - never leak DB/row details
        print(
            "promotion_error: unexpected failure; details intentionally redacted",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
