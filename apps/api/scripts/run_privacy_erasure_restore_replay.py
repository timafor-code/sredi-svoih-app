from __future__ import annotations

import argparse
import asyncio
import json
import sys
from collections.abc import Sequence
from dataclasses import asdict

from app.services.privacy_erasure_restore_replay import (
    execute_privacy_erasure_restore_replay,
)


class _UsageError(ValueError):
    pass


class _ArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        raise _UsageError(message)


def _parser() -> argparse.ArgumentParser:
    parser = _ArgumentParser(
        description=(
            "Replay the private PII-free erasure register against a restored "
            "PostgreSQL database. The default is dry-run."
        ),
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="apply matched erasures; omit for aggregate-only dry-run",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    try:
        arguments = _parser().parse_args(argv)
    except _UsageError:
        print("Invalid privacy-erasure restore-replay CLI arguments", file=sys.stderr)
        return 64

    try:
        result = asyncio.run(
            execute_privacy_erasure_restore_replay(apply=arguments.apply),
        )
    except Exception:  # noqa: BLE001 - details must not escape owner CLI output.
        payload = {
            "already_absent_subjects": 0,
            "deleted_subjects": 0,
            "failed_subjects": 0,
            "failure_code": "privacy_erasure_restore_replay_unavailable",
            "markers_scanned": 0,
            "matched_subjects": 0,
            "mode": "apply" if arguments.apply else "dry_run",
            "register_version": "unknown",
            "restored_users_scanned": 0,
            "result": "failed",
        }
        print(json.dumps(payload, sort_keys=True))
        return 1

    payload = asdict(result)
    if payload["failure_code"] is None:
        del payload["failure_code"]
    print(json.dumps(payload, sort_keys=True))
    return 0 if result.result in {"completed", "dry_run_complete"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
