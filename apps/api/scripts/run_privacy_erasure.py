from __future__ import annotations

import argparse
import asyncio
import json
import sys
from collections.abc import Sequence
from uuid import UUID

from app.services.privacy_erasure_completion_notification import (
    NOTIFICATION_SKIPPED_NO_RECIPIENT,
)
from app.services.privacy_erasure_worker import execute_privacy_erasure_request


class _UsageError(ValueError):
    pass


class _ArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        raise _UsageError(message)


def _uuid(value: str) -> UUID:
    try:
        return UUID(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("request id must be a UUID") from exc


def _parser() -> argparse.ArgumentParser:
    parser = _ArgumentParser(
        description="Execute one confirmed privacy-erasure request.",
    )
    parser.add_argument("--request-id", required=True, type=_uuid)
    return parser


def _exit_code(result: str, notification_result: str) -> int:
    if notification_result == "retryable_failure":
        return 1
    if notification_result == "expired":
        return 2
    if result in {"completed", "already_completed"} and notification_result in {
        "sent",
        "already_sent",
        "legacy_notification_unavailable",
        NOTIFICATION_SKIPPED_NO_RECIPIENT,
    }:
        return 0
    if result == "retryable_failure":
        return 1
    return 2


def main(argv: Sequence[str] | None = None) -> int:
    try:
        arguments = _parser().parse_args(argv)
    except _UsageError:
        print("Invalid privacy-erasure CLI arguments", file=sys.stderr)
        return 64

    result = asyncio.run(execute_privacy_erasure_request(arguments.request_id))
    payload: dict[str, str] = {
        "request_id": str(result.request_id),
        "result": result.result,
        "execution_version": result.execution_version,
        "notification_result": result.notification_result,
    }
    if result.destruction_evidence_id is not None:
        payload["destruction_evidence_id"] = str(result.destruction_evidence_id)
    if result.failure_code is not None:
        payload["failure_code"] = result.failure_code
    if result.notification_failure_code is not None:
        payload["notification_failure_code"] = result.notification_failure_code
    print(json.dumps(payload, sort_keys=True))
    return _exit_code(result.result, result.notification_result)


if __name__ == "__main__":
    raise SystemExit(main())
