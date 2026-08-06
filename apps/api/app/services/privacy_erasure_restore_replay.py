from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.db.models.core import AppUser, PrivacyDestructionEvidence
from app.db.session import AsyncSessionLocal
from app.services.privacy_erasure_deletion_manifest import (
    apply_privacy_erasure_deletion_manifest,
    collect_private_avatar_keys,
    delete_app_user_last,
)
from app.services.privacy_erasure_restore_register import (
    REGISTER_FORMAT_VERSION,
    REGISTER_UNAVAILABLE,
    PrivacyErasureRestoreRegisterError,
    load_restore_register,
    privacy_erasure_subject_ref_hash,
)
from app.storage.privacy_erasure_register import (
    S3PrivacyErasureRegisterStorage,
)
from app.storage.s3 import S3AvatarStorage

PRIVACY_ERASURE_RESTORE_REPLAY_VERSION = "privacy-erasure-restore-replay-v1"
REPLAY_DATABASE_FAILURE = "privacy_erasure_restore_replay_database_failed"
REPLAY_AVATAR_STORAGE_FAILURE = "privacy_erasure_restore_replay_avatar_storage_failed"
REPLAY_PARTIAL_FAILURE = "privacy_erasure_restore_replay_partial_failure"


@dataclass(frozen=True)
class PrivacyErasureRestoreReplayResult:
    mode: str
    register_version: str
    markers_scanned: int
    restored_users_scanned: int
    matched_subjects: int
    deleted_subjects: int
    already_absent_subjects: int
    failed_subjects: int
    result: str
    failure_code: str | None = None
    execution_version: str = PRIVACY_ERASURE_RESTORE_REPLAY_VERSION


class _ReplayAvatarDeletionFailed(RuntimeError):
    pass


def _now() -> datetime:
    return datetime.now(UTC)


def _failed_result(
    *,
    mode: str,
    failure_code: str,
    register_version: str = REGISTER_FORMAT_VERSION,
    markers_scanned: int = 0,
    restored_users_scanned: int = 0,
    matched_subjects: int = 0,
    deleted_subjects: int = 0,
    already_absent_subjects: int = 0,
    failed_subjects: int = 0,
) -> PrivacyErasureRestoreReplayResult:
    return PrivacyErasureRestoreReplayResult(
        mode=mode,
        register_version=register_version,
        markers_scanned=markers_scanned,
        restored_users_scanned=restored_users_scanned,
        matched_subjects=matched_subjects,
        deleted_subjects=deleted_subjects,
        already_absent_subjects=already_absent_subjects,
        failed_subjects=failed_subjects,
        result="failed",
        failure_code=failure_code,
    )


async def execute_privacy_erasure_restore_replay(
    *,
    apply: bool = False,
    session_factory: Any = AsyncSessionLocal,
    register_storage_factory: Callable[[], Any] | None = None,
    avatar_storage_factory: Callable[[], Any] | None = None,
    settings: Settings | None = None,
    now_provider: Callable[[], datetime] = _now,
    before_identity_delete: Callable[[AsyncSession], Awaitable[None]] | None = None,
) -> PrivacyErasureRestoreReplayResult:
    mode = "apply" if apply else "dry_run"
    resolved_settings = settings or get_settings()
    register_storage = (
        register_storage_factory()
        if register_storage_factory is not None
        else S3PrivacyErasureRegisterStorage(resolved_settings)
    )
    try:
        snapshot = await load_restore_register(
            register_storage,
            settings=resolved_settings,
        )
    except PrivacyErasureRestoreRegisterError as exc:
        return _failed_result(mode=mode, failure_code=exc.failure_code)
    except Exception:  # noqa: BLE001 - provider details must not escape.
        return _failed_result(mode=mode, failure_code=REGISTER_UNAVAILABLE)

    marker_hashes = snapshot.subject_ref_hashes
    try:
        async with session_factory() as session:
            restored_user_ids = list((await session.scalars(select(AppUser.id))).all())
    except Exception:  # noqa: BLE001 - database details must not escape.
        return _failed_result(
            mode=mode,
            failure_code=REPLAY_DATABASE_FAILURE,
            register_version=snapshot.metadata.format_version,
            markers_scanned=len(marker_hashes),
        )

    matches: list[tuple[UUID, str]] = []
    for user_id in restored_user_ids:
        subject_ref_hash = privacy_erasure_subject_ref_hash(
            user_id,
            resolved_settings,
        )
        if subject_ref_hash in marker_hashes:
            matches.append((user_id, subject_ref_hash))

    already_absent = len(marker_hashes) - len(matches)
    if not apply:
        return PrivacyErasureRestoreReplayResult(
            mode=mode,
            register_version=snapshot.metadata.format_version,
            markers_scanned=len(marker_hashes),
            restored_users_scanned=len(restored_user_ids),
            matched_subjects=len(matches),
            deleted_subjects=0,
            already_absent_subjects=already_absent,
            failed_subjects=0,
            result="dry_run_complete",
        )

    avatar_storage = (
        avatar_storage_factory()
        if avatar_storage_factory is not None
        else S3AvatarStorage(resolved_settings)
    )
    deleted_subjects = 0
    failed_subjects = 0
    concurrently_absent_subjects = 0
    failure_code: str | None = None
    for user_id, subject_ref_hash in matches:
        try:
            async with session_factory() as session:
                async with session.begin():
                    user = await session.scalar(
                        select(AppUser)
                        .where(AppUser.id == user_id)
                        .with_for_update(),
                    )
                    if user is None:
                        already_absent += 1
                        concurrently_absent_subjects += 1
                        continue
                    avatar_keys = await collect_private_avatar_keys(session, user.id)
                    try:
                        for object_key in avatar_keys:
                            await avatar_storage.delete_avatar(object_key=object_key)
                    except Exception:
                        raise _ReplayAvatarDeletionFailed() from None

                    completed_at = now_provider()
                    manifest = await apply_privacy_erasure_deletion_manifest(
                        session,
                        user=user,
                        avatar_keys=avatar_keys,
                    )
                    session.add(
                        PrivacyDestructionEvidence(
                            subject_ref_hash=subject_ref_hash,
                            execution_version=PRIVACY_ERASURE_RESTORE_REPLAY_VERSION,
                            result_status="completed",
                            completed_at=completed_at,
                            categories_deleted=manifest.categories_deleted,
                            categories_retained=[],
                            retention_until=None,
                            created_at=completed_at,
                        ),
                    )
                    await session.flush()
                    if before_identity_delete is not None:
                        await before_identity_delete(session)
                    await delete_app_user_last(session, user.id)
            deleted_subjects += 1
        except _ReplayAvatarDeletionFailed:
            failed_subjects = (
                len(matches) - deleted_subjects - concurrently_absent_subjects
            )
            failure_code = REPLAY_AVATAR_STORAGE_FAILURE
            break
        except Exception:  # noqa: BLE001 - database details must not escape.
            failed_subjects = (
                len(matches) - deleted_subjects - concurrently_absent_subjects
            )
            failure_code = REPLAY_DATABASE_FAILURE
            break

    if failed_subjects:
        if deleted_subjects:
            failure_code = REPLAY_PARTIAL_FAILURE
        return _failed_result(
            mode=mode,
            failure_code=failure_code or REPLAY_PARTIAL_FAILURE,
            register_version=snapshot.metadata.format_version,
            markers_scanned=len(marker_hashes),
            restored_users_scanned=len(restored_user_ids),
            matched_subjects=len(matches),
            deleted_subjects=deleted_subjects,
            already_absent_subjects=already_absent,
            failed_subjects=failed_subjects,
        )

    return PrivacyErasureRestoreReplayResult(
        mode=mode,
        register_version=snapshot.metadata.format_version,
        markers_scanned=len(marker_hashes),
        restored_users_scanned=len(restored_user_ids),
        matched_subjects=len(matches),
        deleted_subjects=deleted_subjects,
        already_absent_subjects=already_absent,
        failed_subjects=0,
        result="completed",
    )
