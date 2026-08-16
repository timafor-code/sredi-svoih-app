#!/usr/bin/env python3
"""Owner-reviewed local cleanup runner preserving referenced legal evidence."""

from __future__ import annotations

import argparse
import asyncio
import importlib.util
import json
import os
import sys
from pathlib import Path
from typing import Any

CLEANUP_PATH = Path(__file__).resolve().with_name("cleanup_api_source_hygiene.py")
_SPEC = importlib.util.spec_from_file_location(
    "migration_api_source_cleanup_reviewed_base",
    CLEANUP_PATH,
)
if _SPEC is None or _SPEC.loader is None:
    raise RuntimeError("API source cleanup module could not be loaded.")
CLEANUP = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = CLEANUP
_SPEC.loader.exec_module(CLEANUP)
PROMOTE = CLEANUP.PROMOTE

REVIEW_ACK_ENV = "API_LOCAL_REFERENCED_LEGAL_EVIDENCE_ACK"
REVIEW_ACK = "OWNER_REVIEWED_ONE_REFERENCED_LEGAL_DOCUMENT"
EXPECTED_PROTECTED_LEGAL_DOCUMENTS = 1


class ReviewedCleanupError(CLEANUP.LocalCleanupError):
    """Safe failure for the owner-reviewed legal-evidence cleanup path."""


def require_review_approval(args: argparse.Namespace) -> None:
    if not args.apply:
        return
    if os.environ.get(REVIEW_ACK_ENV) != REVIEW_ACK:
        raise ReviewedCleanupError(
            f"{REVIEW_ACK_ENV} must equal {REVIEW_ACK} for reviewed apply."
        )


def _assert_exact_reviewed_legal_evidence(after: dict[str, Any]) -> int:
    protected = int(after.get("protected_synthetic_legal_documents", 0))
    if protected != EXPECTED_PROTECTED_LEGAL_DOCUMENTS:
        raise ReviewedCleanupError(
            "Reviewed legal-evidence count changed: expected exactly "
            f"{EXPECTED_PROTECTED_LEGAL_DOCUMENTS}, found {protected}. "
            "Transaction will be rolled back before commit."
        )
    return protected


def _build_reviewed_report(
    *,
    apply: bool,
    before: dict[str, Any],
    after: dict[str, Any],
    deleted: dict[str, dict[str, int]],
    protected: int,
) -> dict[str, Any]:
    report = CLEANUP._build_report(
        apply=apply,
        before=before,
        after=after,
        deleted=deleted,
    )
    report["apply_blocked"] = False
    report["reviewed_legal_evidence_override"] = True
    report["preserved_referenced_legal_documents"] = protected
    report["notes"] = [
        note
        for note in report["notes"]
        if "block apply" not in note.lower()
    ]
    report["notes"].extend(
        [
            "Owner classified exactly one referenced synthetic-marked legal document as durable legal evidence.",
            "That referenced legal document and all legal_acceptances remain untouched and are promoted as durable data.",
            "This reviewed runner fails closed if the protected-document aggregate is not exactly one before commit.",
        ]
    )
    return report


async def run_reviewed_cleanup(pg_uri: str, *, apply: bool) -> dict[str, Any]:
    CLEANUP.validate_local_environment()
    CLEANUP.validate_local_source_uri(pg_uri)
    conn = await PROMOTE.connect(pg_uri)
    tx = conn.transaction(isolation="serializable")
    await tx.start()
    try:
        await PROMOTE.configure_stable_session(conn)
        schemas = await PROMOTE.validate_schema_classification(conn)
        before = await CLEANUP._snapshot(conn, schemas)
        CLEANUP._assert_no_active_deletion_lifecycle(before)
        deleted = await CLEANUP._execute_cleanup(conn, schemas)
        after = await CLEANUP._snapshot(conn, schemas)
        CLEANUP._assert_targeted_cleanup_complete(after)
        protected = _assert_exact_reviewed_legal_evidence(after)
        report = _build_reviewed_report(
            apply=apply,
            before=before,
            after=after,
            deleted=deleted,
            protected=protected,
        )
        if apply:
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
    return CLEANUP.build_parser()


async def _async_main(args: argparse.Namespace) -> int:
    CLEANUP.require_apply_approval(args)
    require_review_approval(args)
    pg_uri = PROMOTE.load_pg_uri(args.pg_env)
    report = await run_reviewed_cleanup(pg_uri, apply=args.apply)
    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        CLEANUP._print_safe_summary(report)
        print(
            "reviewed_legal_evidence "
            f"preserved={report['preserved_referenced_legal_documents']}"
        )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return asyncio.run(_async_main(args))
    except PROMOTE.PromotionError as exc:
        print(f"reviewed_local_data_cleanup_error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
