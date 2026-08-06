from __future__ import annotations

import logging
import unittest
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import httpx
from sqlalchemy import delete, event as sqlalchemy_event

from app.core.tokens import create_access_token
from app.db.models.core import (
    AppUser,
    Community,
    CommunityMembership,
    PrivacyDestructionEvidence,
    PrivacyRequest,
)
from app.db.session import AsyncSessionLocal, engine
from app.main import app


class _CollectingLogHandler(logging.Handler):
    def __init__(self) -> None:
        super().__init__()
        self.messages: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.messages.append(record.getMessage())


class AdminPrivacyRequestContractTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.community_id = uuid4()
        self.foreign_community_id = uuid4()
        self.admin_id = uuid4()
        self.event_manager_id = uuid4()
        self.subject_id = uuid4()
        self.evidence_id = uuid4()
        self.request_ids = [uuid4() for _ in range(5)]
        self.now = datetime.now(UTC).replace(microsecond=0)
        created_at = self.now - timedelta(days=5)

        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add_all(
                    [
                        Community(
                            id=self.community_id,
                            name="Admin privacy contract community",
                            city="Moscow",
                            slug=f"admin-privacy-{self.community_id.hex[:14]}",
                        ),
                        Community(
                            id=self.foreign_community_id,
                            name="Foreign admin privacy contract community",
                            city="Moscow",
                            slug=f"admin-privacy-{self.foreign_community_id.hex[:14]}",
                        ),
                        *[
                            AppUser(
                                id=user_id,
                                account_origin="migration",
                                claim_state="legacy_external",
                                status="active",
                            )
                            for user_id in (
                                self.admin_id,
                                self.event_manager_id,
                                self.subject_id,
                            )
                        ],
                    ],
                )
                await session.flush()
                session.add_all(
                    [
                        CommunityMembership(
                            community_id=self.community_id,
                            user_id=self.admin_id,
                            role="admin",
                            status="active",
                        ),
                        CommunityMembership(
                            community_id=self.community_id,
                            user_id=self.event_manager_id,
                            role="event_manager",
                            status="active",
                        ),
                        PrivacyDestructionEvidence(
                            id=self.evidence_id,
                            subject_ref_hash=f"privacy-contract-{uuid4().hex}",
                            execution_version="privacy-erasure-v1",
                            result_status="completed",
                            completed_at=created_at + timedelta(seconds=4),
                            categories_deleted=["account", "profile"],
                            created_at=created_at + timedelta(seconds=4),
                        ),
                    ],
                )
                await session.flush()
                session.add_all(
                    [
                        PrivacyRequest(
                            id=self.request_ids[0],
                            user_id=self.subject_id,
                            community_id=self.community_id,
                            request_type="deletion",
                            message="Synthetic completed request",
                            status="resolved",
                            resolution_note="Synthetic resolution",
                            resolved_at=created_at + timedelta(seconds=4),
                            resolved_by=self.admin_id,
                            identity_verified_at=created_at + timedelta(seconds=1),
                            processing_stopped_at=created_at + timedelta(seconds=2),
                            execution_started_at=created_at + timedelta(seconds=3),
                            completed_at=created_at + timedelta(seconds=4),
                            due_at=created_at + timedelta(days=2),
                            pre_deletion_user_status="active",
                            destruction_evidence_id=self.evidence_id,
                            created_at=created_at,
                            updated_at=created_at + timedelta(seconds=4),
                        ),
                        PrivacyRequest(
                            id=self.request_ids[1],
                            user_id=self.subject_id,
                            community_id=self.community_id,
                            request_type="deletion",
                            message="Synthetic cancelled request",
                            status="reviewed",
                            identity_verified_at=created_at + timedelta(seconds=1),
                            processing_stopped_at=created_at + timedelta(seconds=2),
                            due_at=self.now + timedelta(days=1),
                            failure_code="manual_review_required",
                            pre_deletion_user_status="active",
                            cancelled_at=created_at + timedelta(seconds=3),
                            created_at=created_at,
                            updated_at=created_at + timedelta(seconds=3),
                        ),
                        PrivacyRequest(
                            id=self.request_ids[2],
                            user_id=self.subject_id,
                            community_id=self.community_id,
                            request_type="correction",
                            message="raw-log-sentinel-provider-exception",
                            status="open",
                            due_at=self.now - timedelta(days=1),
                            failure_code="provider_unavailable",
                            created_at=created_at,
                            updated_at=created_at,
                        ),
                        PrivacyRequest(
                            id=self.request_ids[3],
                            user_id=self.subject_id,
                            community_id=self.community_id,
                            request_type="other",
                            status="closed",
                            due_at=self.now - timedelta(days=1),
                            created_at=created_at,
                            updated_at=self.now,
                        ),
                        PrivacyRequest(
                            id=self.request_ids[4],
                            user_id=self.subject_id,
                            community_id=self.foreign_community_id,
                            request_type="correction",
                            status="open",
                            due_at=self.now - timedelta(days=1),
                            created_at=created_at,
                            updated_at=created_at,
                        ),
                    ],
                )

        self.admin_headers = self._headers(self.admin_id)
        self.event_manager_headers = self._headers(self.event_manager_id)

    @staticmethod
    def _headers(user_id: UUID) -> dict[str, str]:
        return {"Authorization": f"Bearer {create_access_token(user_id)}"}

    async def asyncTearDown(self) -> None:
        try:
            async with AsyncSessionLocal() as session:
                async with session.begin():
                    await session.execute(
                        delete(PrivacyRequest).where(
                            PrivacyRequest.id.in_(self.request_ids),
                        ),
                    )
                    await session.execute(
                        delete(PrivacyDestructionEvidence).where(
                            PrivacyDestructionEvidence.id == self.evidence_id,
                        ),
                    )
                    await session.execute(
                        delete(Community).where(
                            Community.id.in_(
                                [self.community_id, self.foreign_community_id],
                            ),
                        ),
                    )
                    await session.execute(
                        delete(AppUser).where(
                            AppUser.id.in_(
                                [
                                    self.admin_id,
                                    self.event_manager_id,
                                    self.subject_id,
                                ],
                            ),
                        ),
                    )
        finally:
            await engine.dispose()

    async def test_lifecycle_fields_and_filters_are_complete_and_scoped(self) -> None:
        statements: list[str] = []

        def capture_statement(
            _connection,
            _cursor,
            statement,
            _parameters,
            _context,
            _executemany,
        ) -> None:
            statements.append(str(statement))

        log_handler = _CollectingLogHandler()
        root_logger = logging.getLogger()
        root_logger.addHandler(log_handler)
        sqlalchemy_event.listen(
            engine.sync_engine,
            "before_cursor_execute",
            capture_statement,
        )
        try:
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(
                transport=transport,
                base_url="http://testserver",
            ) as client:
                listed = await client.get(
                    "/admin/privacy/requests",
                    headers=self.admin_headers,
                    params={"community_id": str(self.community_id)},
                )
                self.assertEqual(listed.status_code, 200)
                data = listed.json()["data"]
                self.assertEqual(len(data), 4)
                lifecycle_fields = {
                    "identity_verified_at",
                    "processing_stopped_at",
                    "execution_started_at",
                    "completed_at",
                    "due_at",
                    "failure_code",
                    "destruction_evidence_id",
                    "cancelled_at",
                }
                self.assertTrue(all(lifecycle_fields.issubset(item) for item in data))
                completed = next(
                    item for item in data if item["id"] == str(self.request_ids[0])
                )
                self.assertEqual(
                    completed["destruction_evidence_id"],
                    str(self.evidence_id),
                )
                self.assertIsNotNone(completed["completed_at"])
                cancelled = next(
                    item for item in data if item["id"] == str(self.request_ids[1])
                )
                self.assertIsNotNone(cancelled["cancelled_at"])

                request_type_filtered = await client.get(
                    "/admin/privacy/requests",
                    headers=self.admin_headers,
                    params={
                        "community_id": str(self.community_id),
                        "request_type": "deletion",
                    },
                )
                self.assertEqual(request_type_filtered.status_code, 200)
                self.assertEqual(
                    {item["id"] for item in request_type_filtered.json()["data"]},
                    {str(self.request_ids[0]), str(self.request_ids[1])},
                )

                overdue = await client.get(
                    "/admin/privacy/requests",
                    headers=self.admin_headers,
                    params={
                        "community_id": str(self.community_id),
                        "overdue_only": "true",
                    },
                )
                self.assertEqual(overdue.status_code, 200)
                self.assertEqual(
                    [item["id"] for item in overdue.json()["data"]],
                    [str(self.request_ids[2])],
                )

                status_filtered = await client.get(
                    "/admin/privacy/requests",
                    headers=self.admin_headers,
                    params={
                        "community_id": str(self.community_id),
                        "status": "reviewed",
                    },
                )
                self.assertEqual(status_filtered.status_code, 200)
                self.assertEqual(
                    [item["id"] for item in status_filtered.json()["data"]],
                    [str(self.request_ids[1])],
                )

                denied = await client.get(
                    "/admin/privacy/requests",
                    headers=self.event_manager_headers,
                )
                self.assertEqual(denied.status_code, 403)
        finally:
            sqlalchemy_event.remove(
                engine.sync_engine,
                "before_cursor_execute",
                capture_statement,
            )
            root_logger.removeHandler(log_handler)

        serialized_sql = "\n".join(statements).lower()
        private_prayer_table = "prayer_activity" + "_logs"
        self.assertNotIn(private_prayer_table, serialized_sql)
        serialized_response = str(data).lower()
        for forbidden_field in (
            "recipient_ciphertext",
            "recipient_nonce",
            "encryption_key_id",
        ):
            self.assertNotIn(forbidden_field, serialized_response)
        serialized_logs = "\n".join(log_handler.messages).lower()
        self.assertNotIn("raw-log-sentinel-provider-exception", serialized_logs)


if __name__ == "__main__":
    unittest.main()
