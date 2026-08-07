from __future__ import annotations

import asyncio
import base64
from datetime import UTC, datetime, timedelta
import time
import unittest
from unittest.mock import MagicMock, patch
from uuid import UUID, uuid4

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import delete, func, inspect, select
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import Settings
from app.db.models.core import (
    AppUser,
    PrivacyDestructionEvidence,
    PrivacyErasureNotificationOutbox,
    PrivacyRequest,
)
from app.db.session import AsyncSessionLocal, engine
from app.services.email_delivery import EmailSendResult
from app.services.privacy_erasure_completion_notification import (
    DELIVERY_UNAVAILABLE,
    DELIVERY_WINDOW_EXPIRED,
    deliver_privacy_erasure_completion_notification,
)
from app.services.privacy_erasure_email_templates import (
    render_privacy_erasure_accepted_email,
    render_privacy_erasure_completed_email,
    render_privacy_erasure_completed_with_retention_email,
)
from app.services.privacy_erasure_notification_crypto import (
    NOTIFICATION_DECRYPTION_FAILED,
    NOTIFICATION_KEY_UNAVAILABLE,
    PrivacyErasureNotificationCryptoError,
    decrypt_notification_recipient,
    encrypt_notification_recipient,
    load_notification_encryption_config,
)
from app.services.privacy_erasure_worker import (
    DATABASE_FAILURE_CODE,
    NOTIFICATION_CONFIGURATION_FAILURE_CODE,
    NOTIFICATION_RECIPIENT_MISSING_FAILURE_CODE,
    execute_privacy_erasure_request,
)


def _settings(**overrides) -> Settings:
    values = {
        "api_privacy_erasure_notification_key_b64": base64.b64encode(
            b"synthetic-notification-key-32byt",
        ).decode("ascii"),
        "api_privacy_erasure_notification_key_id": "synthetic-notification-v1",
        "api_privacy_erasure_notification_delivery_window_hours": 24,
    }
    values.update(overrides)
    return Settings(**values)


class PrivacyErasureNotificationCryptoTests(unittest.TestCase):
    def test_aes_gcm_round_trip_random_nonce_and_aad_binding(self) -> None:
        config = load_notification_encryption_config(_settings())
        outbox_id = uuid4()
        request_id = uuid4()
        evidence_id = uuid4()
        recipient = "synthetic-notice@example.invalid"
        first = encrypt_notification_recipient(
            recipient,
            outbox_id=outbox_id,
            privacy_request_id=request_id,
            destruction_evidence_id=evidence_id,
            config=config,
        )
        second = encrypt_notification_recipient(
            recipient,
            outbox_id=outbox_id,
            privacy_request_id=request_id,
            destruction_evidence_id=evidence_id,
            config=config,
        )
        self.assertEqual(len(first.nonce), 12)
        self.assertNotEqual(first.nonce, second.nonce)
        self.assertNotEqual(first.ciphertext, recipient.encode("utf-8"))
        self.assertEqual(
            decrypt_notification_recipient(
                first,
                outbox_id=outbox_id,
                privacy_request_id=request_id,
                destruction_evidence_id=evidence_id,
                config=config,
            ),
            recipient,
        )
        for changed in (
            {"outbox_id": uuid4()},
            {"privacy_request_id": uuid4()},
            {"destruction_evidence_id": uuid4()},
        ):
            arguments = {
                "outbox_id": outbox_id,
                "privacy_request_id": request_id,
                "destruction_evidence_id": evidence_id,
                "config": config,
            }
            arguments.update(changed)
            with self.assertRaisesRegex(
                PrivacyErasureNotificationCryptoError,
                NOTIFICATION_DECRYPTION_FAILED,
            ):
                decrypt_notification_recipient(first, **arguments)

    def test_tampering_nonce_key_and_key_id_fail_safely(self) -> None:
        config = load_notification_encryption_config(_settings())
        outbox_id, request_id, evidence_id = uuid4(), uuid4(), uuid4()
        encrypted = encrypt_notification_recipient(
            "tamper-check@example.invalid",
            outbox_id=outbox_id,
            privacy_request_id=request_id,
            destruction_evidence_id=evidence_id,
            config=config,
        )
        mutations = (
            encrypted.__class__(
                bytes([encrypted.ciphertext[0] ^ 1]) + encrypted.ciphertext[1:],
                encrypted.nonce,
                encrypted.key_id,
            ),
            encrypted.__class__(
                encrypted.ciphertext,
                bytes([encrypted.nonce[0] ^ 1]) + encrypted.nonce[1:],
                encrypted.key_id,
            ),
            encrypted.__class__(encrypted.ciphertext, b"short", encrypted.key_id),
        )
        for mutation in mutations:
            with self.assertRaisesRegex(
                PrivacyErasureNotificationCryptoError,
                NOTIFICATION_DECRYPTION_FAILED,
            ):
                decrypt_notification_recipient(
                    mutation,
                    outbox_id=outbox_id,
                    privacy_request_id=request_id,
                    destruction_evidence_id=evidence_id,
                    config=config,
                )

        wrong_key = load_notification_encryption_config(
            _settings(
                api_privacy_erasure_notification_key_b64=base64.b64encode(
                    b"different-notification-key-32byt",
                ).decode("ascii"),
            ),
        )
        with self.assertRaisesRegex(
            PrivacyErasureNotificationCryptoError,
            NOTIFICATION_DECRYPTION_FAILED,
        ):
            decrypt_notification_recipient(
                encrypted,
                outbox_id=outbox_id,
                privacy_request_id=request_id,
                destruction_evidence_id=evidence_id,
                config=wrong_key,
            )
        with self.assertRaisesRegex(
            PrivacyErasureNotificationCryptoError,
            NOTIFICATION_KEY_UNAVAILABLE,
        ):
            decrypt_notification_recipient(
                encrypted.__class__(
                    encrypted.ciphertext,
                    encrypted.nonce,
                    "wrong-key-id",
                ),
                outbox_id=outbox_id,
                privacy_request_id=request_id,
                destruction_evidence_id=evidence_id,
                config=config,
            )

    def test_invalid_configuration_does_not_expose_key(self) -> None:
        raw_value = "not-valid-base64!"
        cases = (
            Settings(
                api_privacy_erasure_notification_key_b64=raw_value,
                api_privacy_erasure_notification_key_id="key-id",
                api_privacy_erasure_notification_delivery_window_hours=1,
            ),
            _settings(
                api_privacy_erasure_notification_key_b64=base64.b64encode(
                    b"too-short",
                ).decode("ascii"),
            ),
            _settings(api_privacy_erasure_notification_key_id=""),
            _settings(api_privacy_erasure_notification_delivery_window_hours=None),
        )
        for settings in cases:
            with self.assertRaisesRegex(
                PrivacyErasureNotificationCryptoError,
                NOTIFICATION_KEY_UNAVAILABLE,
            ) as raised:
                load_notification_encryption_config(settings)
            self.assertNotIn(raw_value, str(raised.exception))


class PrivacyErasureNotificationMigrationTests(unittest.TestCase):
    def test_migration_head_schema_and_safe_downgrade_guard(self) -> None:
        script = ScriptDirectory.from_config(Config("alembic.ini"))
        expected_head = script.get_current_head()
        self.assertIsNotNone(expected_head)
        revision = script.get_revision("20260806200000")
        self.assertEqual(revision.down_revision, "20260806190000")

        migration_op = MagicMock()
        migration_op.get_bind.return_value.scalar.return_value = 2
        hidden_marker = uuid4()
        with patch.object(revision.module, "op", migration_op):
            with self.assertRaisesRegex(
                RuntimeError,
                "aggregate row count: 2",
            ) as raised:
                revision.module.downgrade()
        self.assertNotIn(str(hidden_marker), str(raised.exception))
        migration_op.drop_table.assert_not_called()

        migration_op.reset_mock()
        migration_op.get_bind.return_value.scalar.return_value = 0
        with patch.object(revision.module, "op", migration_op):
            revision.module.downgrade()
        migration_op.drop_table.assert_called_once_with(
            "privacy_erasure_notification_outbox",
        )


class PrivacyErasureNotificationTemplateTests(unittest.TestCase):
    def test_plain_text_russian_transactional_templates_are_data_minimal(self) -> None:
        templates = (
            render_privacy_erasure_accepted_email(),
            render_privacy_erasure_completed_email(),
            render_privacy_erasure_completed_with_retention_email(),
        )
        forbidden = (
            "<html",
            "http://",
            "https://",
            "request_id",
            "evidence_id",
            "payment",
            "prayer",
            "categories_deleted",
            "подпиш",
        )
        for rendered in templates:
            combined = f"{rendered.subject}\n{rendered.text_body}".lower()
            self.assertTrue(any("а" <= character <= "я" for character in combined))
            for value in forbidden:
                self.assertNotIn(value, combined)
        self.assertIn("не подтверждает", templates[0].text_body.lower())
        self.assertIn("выполнен", templates[1].text_body.lower())
        self.assertNotIn("до ", templates[2].text_body.lower())


class PrivacyErasureCompletionNotificationDatabaseTests(
    unittest.IsolatedAsyncioTestCase,
):
    async def asyncSetUp(self) -> None:
        await engine.dispose()
        self.now = datetime.now(UTC).replace(microsecond=0)
        self.settings = _settings()
        self.request_ids: set[UUID] = set()
        self.evidence_ids: set[UUID] = set()
        self.user_ids: set[UUID] = set()

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
                    if self.evidence_ids:
                        await session.execute(
                            delete(PrivacyDestructionEvidence).where(
                                PrivacyDestructionEvidence.id.in_(self.evidence_ids),
                            ),
                        )
                    if self.user_ids:
                        await session.execute(
                            delete(AppUser).where(AppUser.id.in_(self.user_ids)),
                        )
        finally:
            await engine.dispose()

    async def _add_completed_outbox(
        self,
        *,
        notification_kind: str = "completed",
        expires_at: datetime | None = None,
        created_at: datetime | None = None,
    ) -> tuple[UUID, UUID, UUID, str]:
        request_id, evidence_id, outbox_id = uuid4(), uuid4(), uuid4()
        recipient = f"notice-{request_id.hex[:12]}@example.invalid"
        self.request_ids.add(request_id)
        self.evidence_ids.add(evidence_id)
        created = created_at or self.now
        config = load_notification_encryption_config(self.settings)
        encrypted = encrypt_notification_recipient(
            recipient,
            outbox_id=outbox_id,
            privacy_request_id=request_id,
            destruction_evidence_id=evidence_id,
            config=config,
        )
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    PrivacyDestructionEvidence(
                        id=evidence_id,
                        subject_ref_hash=f"synthetic-{evidence_id.hex}",
                        execution_version="privacy-erasure-worker-v2",
                        result_status=notification_kind,
                        completed_at=self.now,
                        categories_deleted=["account"],
                        categories_retained=[]
                        if notification_kind == "completed"
                        else ["registration"],
                        created_at=self.now,
                    ),
                )
                await session.flush()
                session.add(
                    PrivacyRequest(
                        id=request_id,
                        request_type="deletion",
                        status="resolved",
                        identity_verified_at=self.now - timedelta(hours=3),
                        processing_stopped_at=self.now - timedelta(hours=2),
                        execution_started_at=self.now - timedelta(hours=1),
                        completed_at=self.now,
                        pre_deletion_user_status="active",
                        destruction_evidence_id=evidence_id,
                        created_at=self.now - timedelta(hours=4),
                        updated_at=self.now,
                    ),
                )
                await session.flush()
                session.add(
                    PrivacyErasureNotificationOutbox(
                        id=outbox_id,
                        privacy_request_id=request_id,
                        destruction_evidence_id=evidence_id,
                        notification_kind=notification_kind,
                        status="pending",
                        recipient_ciphertext=encrypted.ciphertext,
                        recipient_nonce=encrypted.nonce,
                        encryption_key_id=encrypted.key_id,
                        attempt_count=0,
                        expires_at=expires_at or self.now + timedelta(hours=4),
                        created_at=created,
                        updated_at=created,
                    ),
                )
        return request_id, evidence_id, outbox_id, recipient

    async def _add_pending_subject(self, *, email: str | None) -> tuple[UUID, UUID]:
        user_id, request_id = uuid4(), uuid4()
        self.user_ids.add(user_id)
        self.request_ids.add(request_id)
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    AppUser(
                        id=user_id,
                        email=email,
                        account_origin="migration",
                        claim_state="claimed",
                        status="deletion_pending",
                        deletion_requested_at=self.now,
                    ),
                )
                await session.flush()
                session.add(
                    PrivacyRequest(
                        id=request_id,
                        user_id=user_id,
                        request_type="deletion",
                        status="open",
                        identity_verified_at=self.now,
                        processing_stopped_at=self.now,
                        pre_deletion_user_status="active",
                        created_at=self.now,
                        updated_at=self.now,
                    ),
                )
        return user_id, request_id

    async def test_database_metadata_has_minimal_encrypted_outbox(self) -> None:
        async with engine.connect() as connection:
            metadata = await connection.run_sync(self._read_outbox_metadata)
        self.assertEqual(
            set(metadata["columns"]),
            {
                "id",
                "privacy_request_id",
                "destruction_evidence_id",
                "notification_kind",
                "status",
                "recipient_ciphertext",
                "recipient_nonce",
                "encryption_key_id",
                "attempt_count",
                "last_attempt_at",
                "sent_at",
                "expires_at",
                "failure_code",
                "created_at",
                "updated_at",
            },
        )
        self.assertEqual(metadata["request_ondelete"], "CASCADE")
        self.assertEqual(metadata["evidence_ondelete"], "RESTRICT")
        self.assertTrue(
            {"privacy_request_id", "destruction_evidence_id"}.issubset(
                metadata["unique_columns"],
            ),
        )

    @staticmethod
    def _read_outbox_metadata(sync_connection) -> dict[str, object]:
        inspector = inspect(sync_connection)
        columns = inspector.get_columns("privacy_erasure_notification_outbox")
        foreign_keys = inspector.get_foreign_keys(
            "privacy_erasure_notification_outbox",
        )
        unique_constraints = inspector.get_unique_constraints(
            "privacy_erasure_notification_outbox",
        )
        foreign_key_actions = {
            item["constrained_columns"][0]: item.get("options", {}).get("ondelete")
            for item in foreign_keys
        }
        return {
            "columns": [item["name"] for item in columns],
            "request_ondelete": foreign_key_actions["privacy_request_id"],
            "evidence_ondelete": foreign_key_actions["destruction_evidence_id"],
            "unique_columns": {
                column
                for item in unique_constraints
                for column in item["column_names"]
            },
        }

    async def test_success_retry_expiry_and_legacy_states(self) -> None:
        request_id, _, outbox_id, recipient = await self._add_completed_outbox()
        deliveries: list[str] = []

        def fail_sender(**kwargs):
            deliveries.append(kwargs["to_address"])
            raise RuntimeError("synthetic provider detail")

        failed = await deliver_privacy_erasure_completion_notification(
            request_id,
            settings=self.settings,
            email_sender=fail_sender,
            now_provider=lambda: self.now,
        )
        self.assertEqual(failed.result, "retryable_failure")
        self.assertEqual(failed.failure_code, DELIVERY_UNAVAILABLE)
        self.assertEqual(deliveries, [recipient])
        async with AsyncSessionLocal() as session:
            row = await session.get(PrivacyErasureNotificationOutbox, outbox_id)
            self.assertEqual(row.status, "failed")
            self.assertEqual(row.attempt_count, 1)
            self.assertIsNotNone(row.recipient_ciphertext)
            self.assertNotIn("synthetic provider detail", row.failure_code)

        def success_sender(**kwargs):
            deliveries.append(kwargs["to_address"])
            return EmailSendResult(sent=True, disabled=False)

        sent = await deliver_privacy_erasure_completion_notification(
            request_id,
            settings=self.settings,
            email_sender=success_sender,
            now_provider=lambda: self.now + timedelta(minutes=1),
        )
        self.assertEqual(sent.result, "sent")
        already = await deliver_privacy_erasure_completion_notification(
            request_id,
            settings=self.settings,
            email_sender=lambda **_kwargs: (_ for _ in ()).throw(
                AssertionError("SMTP must not be called after sent"),
            ),
            now_provider=lambda: self.now + timedelta(minutes=2),
        )
        self.assertEqual(already.result, "already_sent")
        async with AsyncSessionLocal() as session:
            row = await session.get(PrivacyErasureNotificationOutbox, outbox_id)
            self.assertEqual(row.attempt_count, 2)
            self.assertIsNone(row.recipient_ciphertext)
            self.assertIsNone(row.recipient_nonce)

        expired_request, _, expired_outbox, _ = await self._add_completed_outbox(
            created_at=self.now - timedelta(hours=2),
            expires_at=self.now - timedelta(hours=1),
        )
        expired = await deliver_privacy_erasure_completion_notification(
            expired_request,
            settings=self.settings,
            email_sender=lambda **_kwargs: (_ for _ in ()).throw(
                AssertionError("SMTP must not be called after expiry"),
            ),
            now_provider=lambda: self.now,
        )
        self.assertEqual(expired.result, "expired")
        self.assertEqual(expired.failure_code, DELIVERY_WINDOW_EXPIRED)
        async with AsyncSessionLocal() as session:
            row = await session.get(PrivacyErasureNotificationOutbox, expired_outbox)
            self.assertEqual(row.status, "expired")
            self.assertIsNone(row.recipient_ciphertext)
            self.assertIsNone(row.recipient_nonce)

        legacy_id, evidence_id, _, _ = await self._add_completed_outbox()
        async with AsyncSessionLocal() as session:
            async with session.begin():
                await session.execute(
                    delete(PrivacyErasureNotificationOutbox).where(
                        PrivacyErasureNotificationOutbox.privacy_request_id
                        == legacy_id,
                    ),
                )
        legacy = await deliver_privacy_erasure_completion_notification(
            legacy_id,
            settings=self.settings,
        )
        self.assertEqual(legacy.result, "legacy_notification_unavailable")
        self.evidence_ids.add(evidence_id)

    async def test_concurrent_delivery_serializes_to_one_smtp_call(self) -> None:
        request_id, _, outbox_id, _ = await self._add_completed_outbox()
        call_count = 0

        def sender(**_kwargs):
            nonlocal call_count
            call_count += 1
            time.sleep(0.05)
            return EmailSendResult(sent=True, disabled=False)

        results = await asyncio.gather(
            deliver_privacy_erasure_completion_notification(
                request_id,
                settings=self.settings,
                email_sender=sender,
                now_provider=lambda: self.now,
            ),
            deliver_privacy_erasure_completion_notification(
                request_id,
                settings=self.settings,
                email_sender=sender,
                now_provider=lambda: self.now,
            ),
        )
        self.assertEqual({item.result for item in results}, {"sent", "already_sent"})
        self.assertEqual(call_count, 1)
        async with AsyncSessionLocal() as session:
            row = await session.get(PrivacyErasureNotificationOutbox, outbox_id)
            self.assertEqual(row.attempt_count, 1)

    async def test_worker_preflight_and_atomic_rollback_fail_closed(self) -> None:
        user_id, request_id = await self._add_pending_subject(
            email="preflight@example.invalid",
        )
        missing_config = await execute_privacy_erasure_request(
            request_id,
            settings=Settings(),
            storage_factory=lambda: (_ for _ in ()).throw(
                AssertionError("storage must not be called"),
            ),
        )
        self.assertEqual(missing_config.result, "retryable_failure")
        self.assertEqual(
            missing_config.failure_code,
            NOTIFICATION_CONFIGURATION_FAILURE_CODE,
        )
        async with AsyncSessionLocal() as session:
            request = await session.get(PrivacyRequest, request_id)
            self.assertIsNone(request.execution_started_at)
            self.assertIsNotNone(await session.get(AppUser, user_id))

        missing_user, missing_request = await self._add_pending_subject(email=None)
        missing_recipient = await execute_privacy_erasure_request(
            missing_request,
            settings=self.settings,
            storage_factory=lambda: (_ for _ in ()).throw(
                AssertionError("storage must not be called"),
            ),
        )
        self.assertEqual(missing_recipient.result, "not_eligible")
        self.assertEqual(
            missing_recipient.failure_code,
            NOTIFICATION_RECIPIENT_MISSING_FAILURE_CODE,
        )
        async with AsyncSessionLocal() as session:
            request = await session.get(PrivacyRequest, missing_request)
            self.assertIsNone(request.execution_started_at)
            self.assertIsNotNone(await session.get(AppUser, missing_user))

        async def fail_before_commit(_session) -> None:
            raise SQLAlchemyError("synthetic post-outbox failure")

        class MemoryRegister:
            def __init__(self) -> None:
                self.objects: dict[str, bytes] = {}

            async def get_object(self, key: str) -> bytes | None:
                return self.objects.get(key)

            async def put_object_if_absent(self, key: str, body: bytes) -> bool:
                if key in self.objects:
                    return False
                self.objects[key] = body
                return True

            async def list_object_keys(self, prefix: str) -> list[str]:
                return sorted(key for key in self.objects if key.startswith(prefix))

        register = MemoryRegister()

        failed = await execute_privacy_erasure_request(
            request_id,
            settings=self.settings,
            register_storage_factory=lambda: register,
            before_commit=fail_before_commit,
            notification_email_sender=lambda **_kwargs: EmailSendResult(
                sent=True,
                disabled=False,
            ),
        )
        self.assertEqual(failed.result, "retryable_failure")
        self.assertEqual(failed.failure_code, DATABASE_FAILURE_CODE)
        async with AsyncSessionLocal() as session:
            request = await session.get(PrivacyRequest, request_id)
            outbox_count = await session.scalar(
                select(func.count())
                .select_from(PrivacyErasureNotificationOutbox)
                .where(
                    PrivacyErasureNotificationOutbox.privacy_request_id
                    == request_id,
                ),
            )
            self.assertIsNotNone(await session.get(AppUser, user_id))
            self.assertIsNone(request.completed_at)
            self.assertIsNone(request.destruction_evidence_id)
            self.assertEqual(outbox_count, 0)

        completed = await execute_privacy_erasure_request(
            request_id,
            settings=self.settings,
            register_storage_factory=lambda: register,
            notification_email_sender=lambda **_kwargs: EmailSendResult(
                sent=True,
                disabled=False,
            ),
        )
        self.assertEqual(completed.result, "completed")
        self.assertEqual(completed.notification_result, "sent")
        self.evidence_ids.add(completed.destruction_evidence_id)


if __name__ == "__main__":
    unittest.main()
