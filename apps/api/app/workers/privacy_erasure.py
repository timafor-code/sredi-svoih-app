from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
import hashlib
import logging
import signal
from uuid import UUID

from sqlalchemy import or_, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession

from app.core.config import Settings, get_settings
from app.core.logging import configure_logging
from app.db.models.core import AppUser, PrivacyRequest
from app.db.session import engine
from app.services.privacy_erasure import DELETION_PENDING_STATUS
from app.services.privacy_erasure_worker import (
    RETRYABLE_FAILURE_CODES,
    PrivacyErasureWorkerResult,
    execute_privacy_erasure_request,
    privacy_erasure_authorization_predicate,
)

logger = logging.getLogger(__name__)

_TRY_LOCK_SQL = text("SELECT pg_try_advisory_lock(:lock_key)")
_UNLOCK_SQL = text("SELECT pg_advisory_unlock(:lock_key)")
_CANONICAL_RECOVERY_FAILURE_CODES = frozenset(
    {"privacy_erasure_manual_review_required"},
)


def _advisory_lock_key(request_id: UUID) -> int:
    digest = hashlib.blake2b(request_id.bytes, digest_size=8).digest()
    return int.from_bytes(digest, byteorder="big", signed=True)


class PrivacyErasureRuntime:
    def __init__(
        self,
        *,
        settings: Settings | None = None,
        executor: Callable[[UUID], Awaitable[PrivacyErasureWorkerResult]] | None = None,
        connection_factory: Callable[[], AsyncConnection] = engine.connect,
    ) -> None:
        self._settings = settings or get_settings()
        self._executor = executor
        self._connection_factory = connection_factory
        self._deferred_until_restart: set[UUID] = set()

    async def run_once(self) -> int:
        if not self._settings.api_privacy_erasure_worker_enabled:
            logger.info("Privacy erasure worker disabled")
            return 0

        async with self._connection_factory() as connection:
            claims = await self._claim_batch(connection)
            if claims:
                logger.info("Privacy erasure batch claimed claim_count=%s", len(claims))
            for request_id, lock_key in claims:
                try:
                    await self._process_request(request_id)
                finally:
                    await self._release_lock(connection, request_id, lock_key)
            return len(claims)

    async def _claim_batch(
        self,
        connection: AsyncConnection,
    ) -> list[tuple[UUID, int]]:
        failure_codes = RETRYABLE_FAILURE_CODES
        if self._executor is None:
            # Canonical runtime gets one recovery path for requests that first
            # failed closed on inconsistent finalized financial evidence. A
            # custom executor keeps the historical retry contract unchanged.
            failure_codes = RETRYABLE_FAILURE_CODES | _CANONICAL_RECOVERY_FAILURE_CODES

        query = (
            select(PrivacyRequest.id)
            .join(AppUser, AppUser.id == PrivacyRequest.user_id)
            .where(
                PrivacyRequest.request_type == "deletion",
                privacy_erasure_authorization_predicate(),
                PrivacyRequest.processing_stopped_at.is_not(None),
                PrivacyRequest.cancelled_at.is_(None),
                PrivacyRequest.completed_at.is_(None),
                PrivacyRequest.destruction_evidence_id.is_(None),
                or_(
                    PrivacyRequest.failure_code.is_(None),
                    PrivacyRequest.failure_code.in_(failure_codes),
                ),
                AppUser.status == DELETION_PENDING_STATUS,
                AppUser.deletion_requested_at.is_not(None),
                AppUser.erased_at.is_(None),
            )
            .order_by(PrivacyRequest.created_at, PrivacyRequest.id)
            .limit(self._settings.api_privacy_erasure_batch_size)
            .with_for_update(of=PrivacyRequest, skip_locked=True)
        )
        if self._deferred_until_restart:
            query = query.where(
                PrivacyRequest.id.not_in(self._deferred_until_restart),
            )

        claims: list[tuple[UUID, int]] = []
        async with AsyncSession(bind=connection, expire_on_commit=False) as session:
            async with session.begin():
                request_ids = list((await session.scalars(query)).all())
                for request_id in request_ids:
                    lock_key = _advisory_lock_key(request_id)
                    acquired = await session.scalar(
                        _TRY_LOCK_SQL,
                        {"lock_key": lock_key},
                    )
                    if acquired:
                        claims.append((request_id, lock_key))
        return claims

    async def _process_request(self, request_id: UUID) -> None:
        try:
            if self._executor is None:
                result = await execute_privacy_erasure_request(
                    request_id,
                    settings=self._settings,
                )
            else:
                result = await self._executor(request_id)
        except Exception:  # noqa: BLE001 - exception details may contain PII.
            self._deferred_until_restart.add(request_id)
            logger.error(
                "Privacy erasure request deferred after unexpected failure "
                "request_id=%s retryable=false",
                request_id,
            )
            return

        logger.info(
            "Privacy erasure request processed request_id=%s result=%s "
            "failure_code=%s retryable=%s notification_result=%s",
            request_id,
            result.result,
            result.failure_code or "none",
            result.result == "retryable_failure",
            result.notification_result,
        )

    @staticmethod
    async def _release_lock(
        connection: AsyncConnection,
        request_id: UUID,
        lock_key: int,
    ) -> None:
        try:
            await connection.scalar(_UNLOCK_SQL, {"lock_key": lock_key})
        except SQLAlchemyError:
            logger.warning(
                "Privacy erasure advisory lock release failed request_id=%s",
                request_id,
            )


async def _wait_for_shutdown(
    shutdown_event: asyncio.Event,
    timeout_seconds: int,
) -> None:
    try:
        await asyncio.wait_for(shutdown_event.wait(), timeout=timeout_seconds)
    except TimeoutError:
        pass


async def run_worker(
    *,
    worker: PrivacyErasureRuntime | None = None,
    shutdown_event: asyncio.Event | None = None,
) -> None:
    settings = get_settings() if worker is None else worker._settings
    runtime = worker or PrivacyErasureRuntime(settings=settings)
    stop = shutdown_event or asyncio.Event()

    if not settings.api_privacy_erasure_worker_enabled:
        logger.info("Privacy erasure worker disabled")
        return

    logger.info(
        "Privacy erasure worker started poll_interval_seconds=%s batch_size=%s",
        settings.api_privacy_erasure_poll_interval_seconds,
        settings.api_privacy_erasure_batch_size,
    )
    try:
        while not stop.is_set():
            try:
                await runtime.run_once()
            except SQLAlchemyError:
                logger.error("Privacy erasure worker database dependency unavailable")
            except Exception:  # noqa: BLE001 - exception details may contain PII.
                logger.error("Privacy erasure worker batch failed safely")
            await _wait_for_shutdown(
                stop,
                settings.api_privacy_erasure_poll_interval_seconds,
            )
    finally:
        logger.info("Privacy erasure worker stopped")


async def _main() -> None:
    settings = get_settings()
    configure_logging(settings.log_level)
    shutdown_event = asyncio.Event()
    loop = asyncio.get_running_loop()
    for shutdown_signal in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(shutdown_signal, shutdown_event.set)
        except NotImplementedError:
            signal.signal(
                shutdown_signal,
                lambda _signum, _frame: loop.call_soon_threadsafe(
                    shutdown_event.set,
                ),
            )
    try:
        await run_worker(shutdown_event=shutdown_event)
    finally:
        await engine.dispose()


def main() -> None:
    asyncio.run(_main())


if __name__ == "__main__":
    main()
