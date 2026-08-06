from __future__ import annotations

import base64
from contextlib import redirect_stderr, redirect_stdout
from datetime import UTC, date, datetime
from io import StringIO
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

from sqlalchemy import delete, event, func, select
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import Settings
from app.db.models.avatar import ProfileAvatar
from app.db.models.core import (
    AppUser,
    DeviceToken,
    PrayerActivityLog,
    PrivacyDestructionEvidence,
    PrivacyErasureNotificationOutbox,
    PrivacyRequest,
    Profile,
)
from app.db.session import AsyncSessionLocal, engine
from app.services.email_delivery import EmailSendResult
from app.services.privacy_erasure_restore_register import (
    MARKER_FORMAT_VERSION,
    REGISTER_KEY_MISMATCH,
    REGISTER_MARKER_INVALID,
    REGISTER_METADATA_INVALID,
    REGISTER_UNAVAILABLE,
    REGISTER_VERSION_UNSUPPORTED,
    ensure_restore_register_marker,
    privacy_erasure_subject_ref_hash,
)
from app.services.privacy_erasure_restore_replay import (
    PRIVACY_ERASURE_RESTORE_REPLAY_VERSION,
    REPLAY_DATABASE_FAILURE,
    PrivacyErasureRestoreReplayResult,
    execute_privacy_erasure_restore_replay,
)
from app.services.privacy_erasure_worker import execute_privacy_erasure_request


def _settings(**overrides) -> Settings:
    values = {
        "api_token_hash_secret": "synthetic-replay-token-hash-secret-32-bytes",
        "api_privacy_erasure_notification_key_b64": base64.b64encode(
            b"synthetic-worker-notice-key-32bx",
        ).decode("ascii"),
        "api_privacy_erasure_notification_key_id": "synthetic-replay-notice-v1",
        "api_privacy_erasure_notification_delivery_window_hours": 24,
        "api_privacy_erasure_register_prefix": "tests/privacy-erasure-register/v1",
    }
    values.update(overrides)
    return Settings(**values)


def _load_cli_module():
    path = (
        Path(__file__).resolve().parents[1]
        / "scripts"
        / "run_privacy_erasure_restore_replay.py"
    )
    spec = importlib.util.spec_from_file_location(
        "run_privacy_erasure_restore_replay",
        path,
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("restore replay CLI module could not be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


run_privacy_erasure_restore_replay = _load_cli_module()


class _MemoryRegisterStorage:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.fail_reads = False
        self.fail_writes = False
        self.fail_lists = False

    async def get_object(self, key: str) -> bytes | None:
        if self.fail_reads:
            raise RuntimeError("synthetic provider credential and endpoint details")
        return self.objects.get(key)

    async def put_object_if_absent(self, key: str, body: bytes) -> bool:
        if self.fail_writes:
            raise RuntimeError("synthetic provider credential and endpoint details")
        if key in self.objects:
            return False
        self.objects[key] = body
        return True

    async def list_object_keys(self, prefix: str) -> list[str]:
        if self.fail_lists:
            raise RuntimeError("synthetic provider credential and endpoint details")
        return sorted(key for key in self.objects if key.startswith(prefix))


class _MemoryAvatarStorage:
    def __init__(self) -> None:
        self.deleted: list[str] = []
        self.fail = False

    async def delete_avatar(self, *, object_key: str) -> None:
        self.deleted.append(object_key)
        if self.fail:
            raise RuntimeError("synthetic avatar provider detail")


class PrivacyErasureRestoreRegisterSafetyTests(unittest.IsolatedAsyncioTestCase):
    async def _assert_preflight_failure(
        self,
        storage: _MemoryRegisterStorage,
        expected_code: str,
        *,
        settings: Settings | None = None,
    ) -> None:
        entered_database = False

        def forbidden_session_factory():
            nonlocal entered_database
            entered_database = True
            raise AssertionError("database must not be entered after invalid preflight")

        result = await execute_privacy_erasure_restore_replay(
            settings=settings or _settings(),
            register_storage_factory=lambda: storage,
            session_factory=forbidden_session_factory,
        )
        self.assertEqual(result.result, "failed")
        self.assertEqual(result.failure_code, expected_code)
        self.assertFalse(entered_database)

    async def test_marker_write_is_idempotent_and_contains_no_raw_uuid(self) -> None:
        storage = _MemoryRegisterStorage()
        settings = _settings()
        user_id = uuid4()
        subject_hash = privacy_erasure_subject_ref_hash(user_id, settings)
        await ensure_restore_register_marker(
            storage,
            settings=settings,
            subject_ref_hash=subject_hash,
        )
        first = dict(storage.objects)
        await ensure_restore_register_marker(
            storage,
            settings=settings,
            subject_ref_hash=subject_hash,
        )
        self.assertEqual(storage.objects, first)
        serialized = b"".join(storage.objects.values()).decode("utf-8")
        self.assertNotIn(str(user_id), serialized)
        self.assertNotIn("email", serialized.lower())
        self.assertNotIn("phone", serialized.lower())

    async def test_invalid_metadata_version_key_and_storage_abort_before_database(self) -> None:
        cases: list[tuple[_MemoryRegisterStorage, str, Settings | None]] = []

        malformed = _MemoryRegisterStorage()
        malformed.objects["tests/privacy-erasure-register/v1/metadata.json"] = b"{}"
        cases.append((malformed, REGISTER_METADATA_INVALID, None))

        unsupported = _MemoryRegisterStorage()
        unsupported.objects["tests/privacy-erasure-register/v1/metadata.json"] = json.dumps(
            {
                "format_version": "privacy-erasure-register-v999",
                "hash_key_fingerprint": "hmac-sha256-v1:" + "0" * 64,
                "marker_format_version": MARKER_FORMAT_VERSION,
                "subject_hash_version": "hmac-sha256-v1",
            },
        ).encode("utf-8")
        cases.append((unsupported, REGISTER_VERSION_UNSUPPORTED, None))

        mismatch = _MemoryRegisterStorage()
        other_settings = _settings(api_token_hash_secret="different-replay-secret")
        other_hash = privacy_erasure_subject_ref_hash(uuid4(), other_settings)
        await ensure_restore_register_marker(
            mismatch,
            settings=other_settings,
            subject_ref_hash=other_hash,
        )
        cases.append((mismatch, REGISTER_KEY_MISMATCH, None))

        unavailable = _MemoryRegisterStorage()
        unavailable.fail_reads = True
        cases.append((unavailable, REGISTER_UNAVAILABLE, None))

        for storage, code, settings in cases:
            await self._assert_preflight_failure(storage, code, settings=settings)

    async def test_malformed_or_incompatibly_keyed_marker_aborts_before_database(self) -> None:
        for mutation in ("malformed", "wrong_key"):
            storage = _MemoryRegisterStorage()
            settings = _settings()
            subject_hash = privacy_erasure_subject_ref_hash(uuid4(), settings)
            await ensure_restore_register_marker(
                storage,
                settings=settings,
                subject_ref_hash=subject_hash,
            )
            marker_key = next(key for key in storage.objects if "/markers/" in key)
            if mutation == "malformed":
                storage.objects[marker_key] = b'{"subject_ref_hash":"provider-error"}'
            else:
                body = storage.objects.pop(marker_key)
                storage.objects[
                    "tests/privacy-erasure-register/v1/markers/00/" + "0" * 64 + ".json"
                ] = body
            await self._assert_preflight_failure(storage, REGISTER_MARKER_INVALID)


class PrivacyErasureRestoreReplayDatabaseTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        await engine.dispose()
        self.now = datetime.now(UTC).replace(microsecond=0)
        self.settings = _settings()
        self.register = _MemoryRegisterStorage()
        self.avatar_storage = _MemoryAvatarStorage()
        self.user_ids: set[UUID] = set()
        self.request_ids: set[UUID] = set()
        self.evidence_hashes: set[str] = set()

    async def asyncTearDown(self) -> None:
        try:
            async with AsyncSessionLocal() as session:
                async with session.begin():
                    if self.request_ids:
                        await session.execute(
                            delete(PrivacyRequest).where(
                                PrivacyRequest.id.in_(self.request_ids),
                            ),
                        )
                    if self.evidence_hashes:
                        await session.execute(
                            delete(PrivacyDestructionEvidence).where(
                                PrivacyDestructionEvidence.subject_ref_hash.in_(
                                    self.evidence_hashes,
                                ),
                            ),
                        )
                    if self.user_ids:
                        await session.execute(
                            delete(AppUser).where(AppUser.id.in_(self.user_ids)),
                        )
        finally:
            await engine.dispose()

    async def _ordinary_erasure_then_restore(self) -> tuple[UUID, UUID, UUID, str]:
        user_id, other_user_id, request_id = uuid4(), uuid4(), uuid4()
        self.user_ids.update((user_id, other_user_id))
        self.request_ids.add(request_id)
        subject_hash = privacy_erasure_subject_ref_hash(user_id, self.settings)
        self.evidence_hashes.add(subject_hash)
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add_all(
                    [
                        AppUser(
                            id=user_id,
                            email="synthetic-erased@example.invalid",
                            phone="+79990000001",
                            password_hash="synthetic-password-hash",
                            account_origin="password_signup",
                            claim_state="claimed",
                            status="deletion_pending",
                            deletion_requested_at=self.now,
                        ),
                        AppUser(
                            id=other_user_id,
                            email="synthetic-unrelated@example.invalid",
                            account_origin="migration",
                            claim_state="claimed",
                            status="active",
                        ),
                    ],
                )
                await session.flush()
                session.add(
                    PrivacyRequest(
                        id=request_id,
                        user_id=user_id,
                        request_type="deletion",
                        message="synthetic request content",
                        status="open",
                        identity_verified_at=self.now,
                        processing_stopped_at=self.now,
                        pre_deletion_user_status="active",
                        created_at=self.now,
                        updated_at=self.now,
                    ),
                )

        erased = await execute_privacy_erasure_request(
            request_id,
            settings=self.settings,
            register_storage_factory=lambda: self.register,
            storage_factory=lambda: self.avatar_storage,
            notification_email_sender=lambda **_kwargs: EmailSendResult(
                sent=True,
                disabled=False,
            ),
            now_provider=lambda: self.now,
        )
        self.assertEqual(erased.result, "completed", repr(erased))
        self.assertEqual(erased.notification_result, "sent")

        replay_request_id = uuid4()
        avatar_id = uuid4()
        avatar_key = f"synthetic/private/avatar/{uuid4().hex}"
        self.request_ids.add(replay_request_id)
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    AppUser(
                        id=user_id,
                        email="synthetic-erased@example.invalid",
                        phone="+79990000001",
                        password_hash="synthetic-password-hash",
                        account_origin="password_signup",
                        claim_state="claimed",
                        status="active",
                    ),
                )
                await session.flush()
                session.add_all(
                    [
                        Profile(
                            user_id=user_id,
                            full_name="Synthetic Restored Subject",
                            email="synthetic-erased@example.invalid",
                            phone="+79990000001",
                            avatar_id=avatar_id,
                        ),
                        ProfileAvatar(
                            id=avatar_id,
                            user_id=user_id,
                            object_key=avatar_key,
                            content_type="image/png",
                            status="active",
                        ),
                        DeviceToken(
                            user_id=user_id,
                            expo_push_token=f"ExponentPushToken[{uuid4().hex}]",
                        ),
                        PrayerActivityLog(
                            user_id=user_id,
                            activity_type="mincha",
                            activity_date=date.today(),
                            completed_at=self.now,
                            city="Synthetic City",
                        ),
                        PrivacyRequest(
                            id=replay_request_id,
                            user_id=user_id,
                            request_type="correction",
                            message="synthetic restored request text",
                            resolution_note="synthetic restored resolution text",
                            status="reviewed",
                            created_at=self.now,
                            updated_at=self.now,
                        ),
                    ],
                )
        return user_id, other_user_id, replay_request_id, avatar_key

    async def test_restore_simulation_dry_run_apply_and_idempotent_absence(self) -> None:
        user_id, other_user_id, replay_request_id, avatar_key = (
            await self._ordinary_erasure_then_restore()
        )
        async with AsyncSessionLocal() as session:
            request_count_before = await session.scalar(
                select(func.count()).select_from(PrivacyRequest),
            )
            outbox_count_before = await session.scalar(
                select(func.count()).select_from(PrivacyErasureNotificationOutbox),
            )

        dry_run = await execute_privacy_erasure_restore_replay(
            settings=self.settings,
            register_storage_factory=lambda: self.register,
        )
        self.assertEqual(dry_run.result, "dry_run_complete")
        self.assertEqual(dry_run.matched_subjects, 1)
        self.assertEqual(dry_run.deleted_subjects, 0)
        async with AsyncSessionLocal() as session:
            self.assertIsNotNone(await session.get(AppUser, user_id))
            self.assertIsNotNone(await session.get(Profile, await session.scalar(
                select(Profile.id).where(Profile.user_id == user_id),
            )))

        statements: list[str] = []

        def capture_statement(_conn, _cursor, statement, _parameters, _context, _many):
            statements.append(statement.lower())

        event.listen(engine.sync_engine, "before_cursor_execute", capture_statement)
        try:
            applied = await execute_privacy_erasure_restore_replay(
                apply=True,
                settings=self.settings,
                register_storage_factory=lambda: self.register,
                avatar_storage_factory=lambda: self.avatar_storage,
                now_provider=lambda: self.now,
            )
        finally:
            event.remove(engine.sync_engine, "before_cursor_execute", capture_statement)

        self.assertEqual(applied.result, "completed")
        self.assertEqual(applied.deleted_subjects, 1)
        self.assertEqual(self.avatar_storage.deleted, [avatar_key])
        prayer_statements = [
            statement for statement in statements if "prayer_activity_logs" in statement
        ]
        self.assertTrue(prayer_statements)
        self.assertTrue(all(statement.lstrip().startswith("delete") for statement in prayer_statements))
        self.assertFalse(any("returning" in statement for statement in prayer_statements))
        delete_statements = [
            statement for statement in statements if statement.lstrip().startswith("delete")
        ]
        self.assertIn("app_users", delete_statements[-1])

        async with AsyncSessionLocal() as session:
            replay_request = await session.get(PrivacyRequest, replay_request_id)
            evidence = await session.scalar(
                select(PrivacyDestructionEvidence).where(
                    PrivacyDestructionEvidence.subject_ref_hash
                    == privacy_erasure_subject_ref_hash(user_id, self.settings),
                    PrivacyDestructionEvidence.execution_version
                    == PRIVACY_ERASURE_RESTORE_REPLAY_VERSION,
                ),
            )
            request_count_after = await session.scalar(
                select(func.count()).select_from(PrivacyRequest),
            )
            outbox_count_after = await session.scalar(
                select(func.count()).select_from(PrivacyErasureNotificationOutbox),
            )
            self.assertIsNone(await session.get(AppUser, user_id))
            self.assertIsNotNone(await session.get(AppUser, other_user_id))
        self.assertIsNone(replay_request.user_id)
        self.assertIsNone(replay_request.message)
        self.assertIsNone(replay_request.resolution_note)
        self.assertIsNotNone(evidence)
        self.assertNotIn(str(user_id), json.dumps(evidence.categories_deleted))
        self.assertNotIn(str(user_id), evidence.subject_ref_hash)
        self.assertEqual(evidence.categories_retained, [])
        self.assertEqual(request_count_after, request_count_before)
        self.assertEqual(outbox_count_after, outbox_count_before)

        repeated = await execute_privacy_erasure_restore_replay(
            apply=True,
            settings=self.settings,
            register_storage_factory=lambda: self.register,
            avatar_storage_factory=lambda: self.avatar_storage,
        )
        self.assertEqual(repeated.result, "completed")
        self.assertEqual(repeated.matched_subjects, 0)
        self.assertEqual(repeated.deleted_subjects, 0)
        self.assertEqual(repeated.already_absent_subjects, 1)

    async def test_database_failure_does_not_claim_success(self) -> None:
        await self._ordinary_erasure_then_restore()

        async def fail_before_identity(_session) -> None:
            raise SQLAlchemyError("synthetic database provider details")

        result = await execute_privacy_erasure_restore_replay(
            apply=True,
            settings=self.settings,
            register_storage_factory=lambda: self.register,
            avatar_storage_factory=lambda: self.avatar_storage,
            before_identity_delete=fail_before_identity,
        )
        self.assertEqual(result.result, "failed")
        self.assertEqual(result.failure_code, REPLAY_DATABASE_FAILURE)
        self.assertEqual(result.failed_subjects, 1)
        self.assertEqual(result.deleted_subjects, 0)


class PrivacyErasureRestoreReplayCliTests(unittest.TestCase):
    def test_cli_defaults_to_dry_run_and_emits_aggregate_safe_json(self) -> None:
        safe_result = PrivacyErasureRestoreReplayResult(
            mode="dry_run",
            register_version="privacy-erasure-register-v1",
            markers_scanned=3,
            restored_users_scanned=10,
            matched_subjects=1,
            deleted_subjects=0,
            already_absent_subjects=2,
            failed_subjects=0,
            result="dry_run_complete",
        )
        stdout = StringIO()
        with patch.object(
            run_privacy_erasure_restore_replay,
            "execute_privacy_erasure_restore_replay",
            new=AsyncMock(return_value=safe_result),
        ) as execute, redirect_stdout(stdout):
            exit_code = run_privacy_erasure_restore_replay.main([])
        self.assertEqual(exit_code, 0)
        execute.assert_awaited_once_with(apply=False)
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["mode"], "dry_run")
        self.assertNotIn("user", payload)
        self.assertNotIn("subject_ref_hash", payload)
        self.assertNotIn("object_key", payload)

    def test_cli_apply_and_failures_use_nonzero_without_provider_details(self) -> None:
        failed = PrivacyErasureRestoreReplayResult(
            mode="apply",
            register_version="privacy-erasure-register-v1",
            markers_scanned=1,
            restored_users_scanned=1,
            matched_subjects=1,
            deleted_subjects=0,
            already_absent_subjects=0,
            failed_subjects=1,
            result="failed",
            failure_code=REPLAY_DATABASE_FAILURE,
        )
        stdout, stderr = StringIO(), StringIO()
        with patch.object(
            run_privacy_erasure_restore_replay,
            "execute_privacy_erasure_restore_replay",
            new=AsyncMock(return_value=failed),
        ) as execute, redirect_stdout(stdout), redirect_stderr(stderr):
            exit_code = run_privacy_erasure_restore_replay.main(["--apply"])
        self.assertEqual(exit_code, 1)
        execute.assert_awaited_once_with(apply=True)
        output = stdout.getvalue() + stderr.getvalue()
        self.assertNotIn("synthetic", output)
        self.assertNotIn("traceback", output.lower())
        self.assertNotIn("uuid", output.lower())


if __name__ == "__main__":
    unittest.main()
