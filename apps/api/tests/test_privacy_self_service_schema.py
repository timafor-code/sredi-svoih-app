from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import httpx
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import delete, inspect, select, text
from sqlalchemy.exc import IntegrityError

from app.core.tokens import create_access_token
from app.db.models.auth import PrivacyAccessCode, PrivacyAccessSession
from app.db.models.core import (
    AppUser,
    Community,
    CommunityMembership,
    PrivacyDestructionEvidence,
    PrivacyRequest,
)
from app.db.session import AsyncSessionLocal, engine
from app.main import app


class PrivacySelfServiceSchemaTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.user_ids: list[UUID] = []
        self.community_ids: list[UUID] = []
        self.request_ids: list[UUID] = []
        self.evidence_ids: list[UUID] = []

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
                    if self.community_ids:
                        await session.execute(
                            delete(Community).where(
                                Community.id.in_(self.community_ids),
                            ),
                        )
                    if self.user_ids:
                        await session.execute(
                            delete(AppUser).where(AppUser.id.in_(self.user_ids)),
                        )
        finally:
            await engine.dispose()

    async def _add_user(self) -> UUID:
        user_id = uuid4()
        self.user_ids.append(user_id)
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    AppUser(
                        id=user_id,
                        account_origin="migration",
                        claim_state="legacy_external",
                        status="active",
                    ),
                )
        return user_id

    async def _assert_rejected(self, session, row) -> None:
        with self.assertRaises(IntegrityError):
            async with session.begin_nested():
                session.add(row)
                await session.flush()

    async def test_alembic_head_and_database_metadata_include_foundation(self) -> None:
        script = ScriptDirectory.from_config(Config("alembic.ini"))
        expected_head = script.get_current_head()
        self.assertIsNotNone(expected_head)
        self.assertEqual(
            script.get_revision("20260806200000").down_revision,
            "20260806190000",
        )
        self.assertEqual(
            script.get_revision("20260806190000").down_revision,
            "20260806180000",
        )
        self.assertEqual(
            script.get_revision("20260806180000").down_revision,
            "20260806170000",
        )
        self.assertEqual(
            script.get_revision("20260806170000").down_revision,
            "20260806160000",
        )
        self.assertEqual(
            script.get_revision("20260806160000").down_revision,
            "20260806120000",
        )

        async with engine.connect() as connection:
            metadata = await connection.run_sync(self._read_database_metadata)

        self.assertTrue(
            {
                "privacy_access_codes",
                "privacy_access_sessions",
                "privacy_destruction_evidence",
                "privacy_requests",
            }.issubset(metadata["tables"]),
        )
        self.assertTrue(
            {
                "identity_verified_at",
                "processing_stopped_at",
                "execution_started_at",
                "completed_at",
                "due_at",
                "failure_code",
                "destruction_evidence_id",
            }.issubset(metadata["privacy_request_columns"]),
        )
        self.assertTrue(metadata["privacy_request_user_nullable"])
        self.assertEqual(metadata["privacy_request_user_ondelete"], "SET NULL")
        self.assertEqual(
            metadata["privacy_request_evidence_ondelete"],
            "SET NULL",
        )

    @staticmethod
    def _read_database_metadata(sync_connection) -> dict[str, object]:
        inspector = inspect(sync_connection)
        request_columns = inspector.get_columns("privacy_requests")
        request_foreign_keys = inspector.get_foreign_keys("privacy_requests")

        def _foreign_key_ondelete(column_name: str) -> str | None:
            foreign_key = next(
                item
                for item in request_foreign_keys
                if item["constrained_columns"] == [column_name]
            )
            return foreign_key.get("options", {}).get("ondelete")

        return {
            "tables": set(inspector.get_table_names()),
            "privacy_request_columns": {
                column["name"] for column in request_columns
            },
            "privacy_request_user_nullable": next(
                column["nullable"]
                for column in request_columns
                if column["name"] == "user_id"
            ),
            "privacy_request_user_ondelete": _foreign_key_ondelete("user_id"),
            "privacy_request_evidence_ondelete": _foreign_key_ondelete(
                "destruction_evidence_id",
            ),
        }

    async def test_access_codes_are_hash_only_unique_and_constrained(self) -> None:
        user_id = await self._add_user()
        now = datetime.now(UTC).replace(microsecond=0)
        self.assertEqual(
            set(inspect(PrivacyAccessCode).columns.keys()),
            {
                "id",
                "user_id",
                "code_hash",
                "expires_at",
                "consumed_at",
                "attempt_count",
                "created_at",
                "updated_at",
            },
        )
        self.assertFalse(
            {"code", "email", "phone", "token"}
            & set(inspect(PrivacyAccessCode).columns.keys()),
        )

        async with AsyncSessionLocal() as session:
            async with session.begin():
                valid = PrivacyAccessCode(
                    user_id=user_id,
                    code_hash=f"privacy-code-hash-{uuid4().hex}",
                    expires_at=now + timedelta(minutes=10),
                    created_at=now,
                    updated_at=now,
                )
                session.add(valid)
                await session.flush()
                await session.refresh(valid)
                self.assertEqual(valid.attempt_count, 0)

                await self._assert_rejected(
                    session,
                    PrivacyAccessCode(
                        user_id=user_id,
                        code_hash=valid.code_hash,
                        expires_at=now + timedelta(minutes=10),
                        created_at=now,
                        updated_at=now,
                    ),
                )
                await self._assert_rejected(
                    session,
                    PrivacyAccessCode(
                        user_id=user_id,
                        code_hash=" ",
                        expires_at=now + timedelta(minutes=10),
                        created_at=now,
                        updated_at=now,
                    ),
                )
                await self._assert_rejected(
                    session,
                    PrivacyAccessCode(
                        user_id=user_id,
                        code_hash=f"expired-code-hash-{uuid4().hex}",
                        expires_at=now,
                        created_at=now,
                        updated_at=now,
                    ),
                )
                await self._assert_rejected(
                    session,
                    PrivacyAccessCode(
                        user_id=user_id,
                        code_hash=f"attempt-code-hash-{uuid4().hex}",
                        expires_at=now + timedelta(minutes=10),
                        attempt_count=-1,
                        created_at=now,
                        updated_at=now,
                    ),
                )
                await self._assert_rejected(
                    session,
                    PrivacyAccessCode(
                        user_id=user_id,
                        code_hash=f"consumed-code-hash-{uuid4().hex}",
                        expires_at=now + timedelta(minutes=10),
                        consumed_at=now - timedelta(seconds=1),
                        created_at=now,
                        updated_at=now,
                    ),
                )

    async def test_privacy_sessions_are_fixed_scope_hash_only_and_constrained(self) -> None:
        user_id = await self._add_user()
        now = datetime.now(UTC).replace(microsecond=0)
        session_columns = set(inspect(PrivacyAccessSession).columns.keys())
        self.assertEqual(
            session_columns,
            {
                "id",
                "user_id",
                "token_hash",
                "scope",
                "expires_at",
                "revoked_at",
                "last_used_at",
                "created_at",
            },
        )
        self.assertFalse(
            {"token", "refresh_token", "email", "phone"} & session_columns,
        )

        async with AsyncSessionLocal() as session:
            async with session.begin():
                valid = PrivacyAccessSession(
                    user_id=user_id,
                    token_hash=f"privacy-session-hash-{uuid4().hex}",
                    scope="privacy_self_service",
                    expires_at=now + timedelta(minutes=10),
                    created_at=now,
                )
                session.add(valid)
                await session.flush()

                await self._assert_rejected(
                    session,
                    PrivacyAccessSession(
                        user_id=user_id,
                        token_hash=valid.token_hash,
                        scope="privacy_self_service",
                        expires_at=now + timedelta(minutes=10),
                        created_at=now,
                    ),
                )
                await self._assert_rejected(
                    session,
                    PrivacyAccessSession(
                        user_id=user_id,
                        token_hash=" ",
                        scope="privacy_self_service",
                        expires_at=now + timedelta(minutes=10),
                        created_at=now,
                    ),
                )
                await self._assert_rejected(
                    session,
                    PrivacyAccessSession(
                        user_id=user_id,
                        token_hash=f"wrong-scope-hash-{uuid4().hex}",
                        scope="account",
                        expires_at=now + timedelta(minutes=10),
                        created_at=now,
                    ),
                )
                await self._assert_rejected(
                    session,
                    PrivacyAccessSession(
                        user_id=user_id,
                        token_hash=f"expired-session-hash-{uuid4().hex}",
                        scope="privacy_self_service",
                        expires_at=now,
                        created_at=now,
                    ),
                )
                await self._assert_rejected(
                    session,
                    PrivacyAccessSession(
                        user_id=user_id,
                        token_hash=f"revoked-session-hash-{uuid4().hex}",
                        scope="privacy_self_service",
                        expires_at=now + timedelta(minutes=10),
                        revoked_at=now - timedelta(seconds=1),
                        created_at=now,
                    ),
                )

    async def test_privacy_request_lifecycle_ordering_constraints(self) -> None:
        user_id = await self._add_user()
        now = datetime.now(UTC).replace(microsecond=0)
        request_columns = set(inspect(PrivacyRequest).columns.keys())
        self.assertTrue(
            {
                "identity_verified_at",
                "processing_stopped_at",
                "execution_started_at",
                "completed_at",
                "due_at",
                "failure_code",
                "destruction_evidence_id",
            }.issubset(request_columns),
        )

        async with AsyncSessionLocal() as session:
            async with session.begin():
                valid_id = uuid4()
                self.request_ids.append(valid_id)
                valid = PrivacyRequest(
                    id=valid_id,
                    user_id=user_id,
                    request_type="deletion",
                    status="open",
                    pre_deletion_user_status="active",
                    identity_verified_at=now + timedelta(seconds=1),
                    processing_stopped_at=now + timedelta(seconds=2),
                    execution_started_at=now + timedelta(seconds=3),
                    completed_at=now + timedelta(seconds=4),
                    due_at=now + timedelta(days=1),
                    created_at=now,
                    updated_at=now,
                )
                session.add(valid)
                await session.flush()

                invalid_rows = [
                    PrivacyRequest(
                        user_id=user_id,
                        request_type="deletion",
                        due_at=now - timedelta(seconds=1),
                        created_at=now,
                        updated_at=now,
                    ),
                    PrivacyRequest(
                        user_id=user_id,
                        request_type="deletion",
                        processing_stopped_at=now + timedelta(seconds=1),
                        created_at=now,
                        updated_at=now,
                    ),
                    PrivacyRequest(
                        user_id=user_id,
                        request_type="deletion",
                        execution_started_at=now + timedelta(seconds=2),
                        created_at=now,
                        updated_at=now,
                    ),
                    PrivacyRequest(
                        user_id=user_id,
                        request_type="deletion",
                        completed_at=now + timedelta(seconds=3),
                        created_at=now,
                        updated_at=now,
                    ),
                    PrivacyRequest(
                        user_id=user_id,
                        request_type="deletion",
                        failure_code=" ",
                        created_at=now,
                        updated_at=now,
                    ),
                    PrivacyRequest(
                        user_id=user_id,
                        request_type="deletion",
                        pre_deletion_user_status="active",
                        identity_verified_at=now + timedelta(seconds=1),
                        processing_stopped_at=now + timedelta(seconds=2),
                        execution_started_at=now + timedelta(seconds=3),
                        completed_at=now + timedelta(seconds=4),
                        failure_code="execution_failed",
                        created_at=now,
                        updated_at=now,
                    ),
                ]
                for row in invalid_rows:
                    await self._assert_rejected(session, row)

    async def test_evidence_is_pii_free_allowlisted_and_uses_json_defaults(self) -> None:
        evidence_columns = set(inspect(PrivacyDestructionEvidence).columns.keys())
        self.assertEqual(
            evidence_columns,
            {
                "id",
                "subject_ref_hash",
                "execution_version",
                "result_status",
                "completed_at",
                "categories_deleted",
                "categories_retained",
                "retention_until",
                "created_at",
            },
        )
        self.assertFalse(
            {"user_id", "email", "phone", "name", "address", "message"}
            & evidence_columns,
        )
        now = datetime.now(UTC).replace(microsecond=0)

        async with AsyncSessionLocal() as session:
            async with session.begin():
                valid_id = uuid4()
                self.evidence_ids.append(valid_id)
                valid = PrivacyDestructionEvidence(
                    id=valid_id,
                    subject_ref_hash=f"subject-ref-hash-{uuid4().hex}",
                    execution_version="privacy-erasure-v1",
                    result_status="completed",
                    completed_at=now,
                    created_at=now,
                )
                session.add(valid)
                await session.flush()
                await session.refresh(valid)
                self.assertEqual(valid.categories_deleted, [])
                self.assertEqual(valid.categories_retained, [])

                allowlist_id = uuid4()
                self.evidence_ids.append(allowlist_id)
                allowed_categories = [
                    "account",
                    "profile",
                    "contact",
                    "membership",
                    "registration",
                    "credential",
                    "session",
                    "device",
                    "synced_contact",
                    "avatar",
                    "privacy_request_content",
                    "prayer_activity",
                    "legal_acceptance",
                    "feedback",
                    "web_registration_intent",
                ]
                session.add(
                    PrivacyDestructionEvidence(
                        id=allowlist_id,
                        subject_ref_hash=f"allowlist-hash-{uuid4().hex}",
                        execution_version="privacy-erasure-worker-v1",
                        result_status="completed",
                        completed_at=now,
                        categories_deleted=allowed_categories,
                        categories_retained=allowed_categories,
                        created_at=now,
                    ),
                )
                await session.flush()

                await self._assert_rejected(
                    session,
                    PrivacyDestructionEvidence(
                        subject_ref_hash=f"bad-status-hash-{uuid4().hex}",
                        execution_version="privacy-erasure-v1",
                        result_status="failed",
                        completed_at=now,
                        created_at=now,
                    ),
                )
                await self._assert_rejected(
                    session,
                    PrivacyDestructionEvidence(
                        subject_ref_hash=" ",
                        execution_version="privacy-erasure-v1",
                        result_status="completed",
                        completed_at=now,
                        created_at=now,
                    ),
                )
                await self._assert_rejected(
                    session,
                    PrivacyDestructionEvidence(
                        subject_ref_hash=f"bad-category-hash-{uuid4().hex}",
                        execution_version="privacy-erasure-v1",
                        result_status="completed",
                        completed_at=now,
                        categories_deleted=["raw_contact_value"],
                        created_at=now,
                    ),
                )

    async def test_user_deletion_orphans_request_but_preserves_evidence(self) -> None:
        user_id = await self._add_user()
        now = datetime.now(UTC).replace(microsecond=0)
        evidence_id = uuid4()
        request_id = uuid4()
        self.evidence_ids.append(evidence_id)
        self.request_ids.append(request_id)
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    PrivacyDestructionEvidence(
                        id=evidence_id,
                        subject_ref_hash=f"deletion-subject-hash-{uuid4().hex}",
                        execution_version="privacy-erasure-v1",
                        result_status="completed",
                        completed_at=now + timedelta(seconds=4),
                        categories_deleted=["account", "profile"],
                        created_at=now + timedelta(seconds=4),
                    ),
                )
                session.add(
                    PrivacyRequest(
                        id=request_id,
                        user_id=user_id,
                        request_type="deletion",
                        pre_deletion_user_status="active",
                        identity_verified_at=now + timedelta(seconds=1),
                        processing_stopped_at=now + timedelta(seconds=2),
                        execution_started_at=now + timedelta(seconds=3),
                        completed_at=now + timedelta(seconds=4),
                        destruction_evidence_id=evidence_id,
                        created_at=now,
                        updated_at=now + timedelta(seconds=4),
                    ),
                )

        async with AsyncSessionLocal() as session:
            async with session.begin():
                await session.execute(delete(AppUser).where(AppUser.id == user_id))

        async with AsyncSessionLocal() as session:
            privacy_request = await session.get(PrivacyRequest, request_id)
            evidence = await session.get(PrivacyDestructionEvidence, evidence_id)
        self.assertIsNotNone(privacy_request)
        self.assertIsNone(privacy_request.user_id)
        self.assertIsNotNone(evidence)
        self.assertEqual(privacy_request.destruction_evidence_id, evidence_id)

    async def test_existing_authenticated_and_admin_endpoints_still_work(self) -> None:
        community_id = uuid4()
        subject_id = uuid4()
        admin_id = uuid4()
        self.community_ids.append(community_id)
        self.user_ids.extend([subject_id, admin_id])
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add_all(
                    [
                        Community(
                            id=community_id,
                            name="Privacy regression community",
                            city="Moscow",
                            slug=f"privacy-{community_id.hex[:20]}",
                        ),
                        AppUser(
                            id=subject_id,
                            account_origin="migration",
                            claim_state="legacy_external",
                            status="active",
                        ),
                        AppUser(
                            id=admin_id,
                            account_origin="migration",
                            claim_state="legacy_external",
                            status="active",
                        ),
                        CommunityMembership(
                            community_id=community_id,
                            user_id=subject_id,
                            role="member",
                            status="active",
                        ),
                        CommunityMembership(
                            community_id=community_id,
                            user_id=admin_id,
                            role="admin",
                            status="active",
                        ),
                    ],
                )

        subject_headers = {
            "Authorization": f"Bearer {create_access_token(subject_id)}",
        }
        admin_headers = {
            "Authorization": f"Bearer {create_access_token(admin_id)}",
        }
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            created = await client.post(
                "/privacy/requests",
                headers=subject_headers,
                json={
                    "request_type": "correction",
                    "community_id": str(community_id),
                    "message": "Synthetic correction request",
                },
            )
            self.assertEqual(created.status_code, 201)
            created_data = created.json()["data"]
            request_id = created_data["id"]
            self.request_ids.append(UUID(request_id))
            self.assertEqual(
                set(created_data),
                {
                    "id",
                    "community_id",
                    "request_type",
                    "message",
                    "status",
                    "resolution_note",
                    "resolved_at",
                    "created_at",
                    "updated_at",
                },
            )

            listed = await client.get(
                "/privacy/requests",
                headers=subject_headers,
            )
            self.assertEqual(listed.status_code, 200)
            self.assertEqual([item["id"] for item in listed.json()["data"]], [request_id])

            updated = await client.patch(
                f"/admin/privacy/requests/{request_id}",
                headers=admin_headers,
                json={
                    "status": "reviewed",
                    "resolution_note": "Synthetic review note",
                },
            )
            self.assertEqual(updated.status_code, 200)
            updated_data = updated.json()["data"]
            self.assertEqual(updated_data["status"], "reviewed")
            self.assertEqual(updated_data["user_id"], str(subject_id))
            self.assertIsNone(updated_data["resolved_by"])
            self.assertTrue(
                {
                    "identity_verified_at",
                    "processing_stopped_at",
                    "execution_started_at",
                    "completed_at",
                    "due_at",
                    "failure_code",
                    "destruction_evidence_id",
                    "cancelled_at",
                }.issubset(updated_data),
            )

        async with AsyncSessionLocal() as session:
            row = await session.scalar(
                select(PrivacyRequest).where(
                    PrivacyRequest.id == UUID(request_id),
                ),
            )
        self.assertIsNotNone(row)
        self.assertEqual(row.user_id, subject_id)
        self.assertIsNone(row.identity_verified_at)
        self.assertIsNone(row.destruction_evidence_id)

    async def test_database_revision_is_current_head(self) -> None:
        expected_revision = ScriptDirectory.from_config(
            Config("alembic.ini"),
        ).get_current_head()
        async with AsyncSessionLocal() as session:
            revision = await session.scalar(
                text("SELECT version_num FROM alembic_version"),
            )
        self.assertEqual(revision, expected_revision)


if __name__ == "__main__":
    unittest.main()
