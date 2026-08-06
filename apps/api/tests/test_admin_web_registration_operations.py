from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import httpx
from sqlalchemy import delete, func, select

from app.core.tokens import create_access_token
from app.db.models.core import (
    AppUser,
    Community,
    CommunityMembership,
    Event,
    EventCategory,
    EventRegistration,
    PrivacyRequest,
    Profile,
    WebRegistrationIdentityConflict,
    WebRegistrationIntent,
)
from app.db.session import AsyncSessionLocal, engine
from app.main import app


class AdminWebRegistrationOperationsTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.community_id = uuid4()
        self.foreign_community_id = uuid4()
        self.admin_id = uuid4()
        self.event_manager_id = uuid4()
        self.member_id = uuid4()
        self.email_user_id = uuid4()
        self.phone_user_id = uuid4()
        self.event_id = uuid4()
        self.foreign_event_id = uuid4()
        self.open_conflict_id = uuid4()
        self.resolved_conflict_id = uuid4()
        self.foreign_conflict_id = uuid4()
        self.now = datetime.now(UTC).replace(microsecond=0)

        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add_all(
                    [
                        Community(
                            id=self.community_id,
                            name="Operations community",
                            city="Moscow",
                            slug=f"operations-{self.community_id.hex[:16]}",
                        ),
                        Community(
                            id=self.foreign_community_id,
                            name="Foreign operations community",
                            city="Moscow",
                            slug=f"operations-{self.foreign_community_id.hex[:16]}",
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
                                self.member_id,
                                self.email_user_id,
                                self.phone_user_id,
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
                        CommunityMembership(
                            community_id=self.community_id,
                            user_id=self.member_id,
                            role="member",
                            status="active",
                        ),
                        Profile(
                            user_id=self.email_user_id,
                            community_id=self.community_id,
                            display_name="Synthetic email profile",
                        ),
                        Profile(
                            user_id=self.phone_user_id,
                            community_id=self.community_id,
                            display_name="Synthetic phone profile",
                        ),
                        EventCategory(
                            community_id=self.community_id,
                            slug="community",
                            title="Community",
                            color="#123456",
                            icon="*",
                            created_by=self.admin_id,
                            updated_by=self.admin_id,
                        ),
                        EventCategory(
                            community_id=self.foreign_community_id,
                            slug="community",
                            title="Community",
                            color="#654321",
                            icon="*",
                            created_by=self.admin_id,
                            updated_by=self.admin_id,
                        ),
                    ],
                )
                await session.flush()
                session.add_all(
                    [
                        Event(
                            id=self.event_id,
                            community_id=self.community_id,
                            title="Operations event",
                            starts_at=self.now + timedelta(days=2),
                            category="community",
                        ),
                        Event(
                            id=self.foreign_event_id,
                            community_id=self.foreign_community_id,
                            title="Foreign operations event",
                            starts_at=self.now + timedelta(days=2),
                            category="community",
                        ),
                    ],
                )
                await session.flush()

                active_intent = self._intent(
                    self.event_id,
                    status="email_verification_required",
                    created_at=self.now,
                    expires_at=self.now + timedelta(hours=1),
                )
                expired_intent = self._intent(
                    self.event_id,
                    status="email_verification_required",
                    created_at=self.now - timedelta(days=2),
                    expires_at=self.now - timedelta(days=1),
                )
                confirmed_intent = self._intent(
                    self.event_id,
                    status="confirmed",
                    created_at=self.now,
                    expires_at=self.now + timedelta(hours=1),
                    confirmed_at=self.now + timedelta(minutes=1),
                )
                foreign_active_intent = self._intent(
                    self.foreign_event_id,
                    status="email_verification_required",
                    created_at=self.now,
                    expires_at=self.now + timedelta(hours=1),
                )
                open_conflict_intent = self._intent(
                    self.event_id,
                    status="failed",
                    created_at=self.now,
                    expires_at=self.now + timedelta(hours=1),
                )
                resolved_conflict_intent = self._intent(
                    self.event_id,
                    status="failed",
                    created_at=self.now,
                    expires_at=self.now + timedelta(hours=1),
                )
                foreign_conflict_intent = self._intent(
                    self.foreign_event_id,
                    status="failed",
                    created_at=self.now,
                    expires_at=self.now + timedelta(hours=1),
                )
                session.add_all(
                    [
                        active_intent,
                        expired_intent,
                        confirmed_intent,
                        foreign_active_intent,
                        open_conflict_intent,
                        resolved_conflict_intent,
                        foreign_conflict_intent,
                    ],
                )
                await session.flush()
                session.add_all(
                    [
                        WebRegistrationIdentityConflict(
                            id=self.open_conflict_id,
                            registration_intent_id=open_conflict_intent.id,
                            category="email_phone_different_users",
                            email_user_id=self.email_user_id,
                            phone_user_id=self.phone_user_id,
                            status="open",
                        ),
                        WebRegistrationIdentityConflict(
                            id=self.resolved_conflict_id,
                            registration_intent_id=resolved_conflict_intent.id,
                            category="email_phone_different_users",
                            email_user_id=self.email_user_id,
                            phone_user_id=self.phone_user_id,
                            status="resolved",
                            resolved_at=self.now,
                        ),
                        WebRegistrationIdentityConflict(
                            id=self.foreign_conflict_id,
                            registration_intent_id=foreign_conflict_intent.id,
                            category="email_phone_different_users",
                            email_user_id=self.email_user_id,
                            phone_user_id=self.phone_user_id,
                            status="open",
                        ),
                        PrivacyRequest(
                            user_id=self.member_id,
                            community_id=self.community_id,
                            request_type="correction",
                            status="open",
                            due_at=self.now - timedelta(days=1),
                            created_at=self.now - timedelta(days=2),
                            updated_at=self.now - timedelta(days=2),
                        ),
                        PrivacyRequest(
                            user_id=self.member_id,
                            community_id=self.community_id,
                            request_type="other",
                            status="reviewed",
                            due_at=self.now + timedelta(days=1),
                            created_at=self.now - timedelta(days=1),
                            updated_at=self.now - timedelta(days=1),
                        ),
                        *[
                            PrivacyRequest(
                                user_id=self.member_id,
                                community_id=self.community_id,
                                request_type="other",
                                status=terminal_status,
                                due_at=self.now - timedelta(days=1),
                                created_at=self.now - timedelta(days=2),
                                updated_at=self.now,
                            )
                            for terminal_status in ("resolved", "rejected", "closed")
                        ],
                        PrivacyRequest(
                            user_id=self.member_id,
                            community_id=self.foreign_community_id,
                            request_type="correction",
                            status="open",
                            due_at=self.now - timedelta(days=1),
                            created_at=self.now - timedelta(days=2),
                            updated_at=self.now - timedelta(days=2),
                        ),
                    ],
                )

        self.admin_headers = self._headers(self.admin_id)
        self.event_manager_headers = self._headers(self.event_manager_id)
        self.member_headers = self._headers(self.member_id)

    def _intent(
        self,
        event_id: UUID,
        *,
        status: str,
        created_at: datetime,
        expires_at: datetime,
        confirmed_at: datetime | None = None,
    ) -> WebRegistrationIntent:
        intent_id = uuid4()
        return WebRegistrationIntent(
            id=intent_id,
            flow_token_hash=f"flow-{intent_id.hex}",
            event_id=event_id,
            first_name="Synthetic",
            last_name="Registrant",
            email_normalized=f"{intent_id.hex}@example.invalid",
            phone_normalized=f"+79{intent_id.int % 10**9:09d}",
            seats_count=1,
            option_payload=[],
            answer_payload=None,
            legal_acceptance_payload=[],
            account_choice="without_password",
            status=status,
            idempotency_key_hash=f"idempotency-{intent_id.hex}",
            request_fingerprint_hash=f"fingerprint-{intent_id.hex}",
            expires_at=expires_at,
            confirmed_at=confirmed_at,
            created_at=created_at,
        )

    @staticmethod
    def _headers(user_id: UUID) -> dict[str, str]:
        return {"Authorization": f"Bearer {create_access_token(user_id)}"}

    async def asyncTearDown(self) -> None:
        try:
            async with AsyncSessionLocal() as session:
                async with session.begin():
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
                                    self.member_id,
                                    self.email_user_id,
                                    self.phone_user_id,
                                ],
                            ),
                        ),
                    )
        finally:
            await engine.dispose()

    async def test_summary_counts_only_active_own_community_operations(self) -> None:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            response = await client.get(
                "/admin/web-registration/operations-summary",
                headers=self.admin_headers,
                params={"community_id": str(self.community_id)},
            )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(
                response.json()["data"],
                {
                    "active_email_verification_intents": 1,
                    "open_identity_conflicts": 1,
                    "open_privacy_requests": 2,
                    "overdue_privacy_requests": 1,
                },
            )

            denied = await client.get(
                "/admin/web-registration/operations-summary",
                headers=self.event_manager_headers,
            )
            self.assertEqual(denied.status_code, 403)

    async def test_conflict_queue_is_allowlisted_scoped_and_admin_only(self) -> None:
        expected_fields = {
            "id",
            "registration_intent_id",
            "category",
            "status",
            "email_user_id",
            "phone_user_id",
            "event_id",
            "occurrence_id",
            "intent_status",
            "created_at",
            "resolved_at",
        }
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            open_response = await client.get(
                "/admin/web-registration/conflicts",
                headers=self.admin_headers,
                params={"status": "open", "limit": 10, "offset": 0},
            )
            self.assertEqual(open_response.status_code, 200)
            open_data = open_response.json()["data"]
            self.assertEqual([item["id"] for item in open_data], [str(self.open_conflict_id)])
            self.assertEqual(set(open_data[0]), expected_fields)
            serialized = str(open_data).lower()
            for forbidden_value in (
                "@example.invalid",
                "+79",
                "synthetic registrant",
                "flow-",
                "idempotency-",
                "fingerprint-",
            ):
                self.assertNotIn(forbidden_value, serialized)

            resolved_response = await client.get(
                "/admin/web-registration/conflicts",
                headers=self.admin_headers,
                params={"status": "resolved"},
            )
            self.assertEqual(resolved_response.status_code, 200)
            self.assertEqual(
                [item["id"] for item in resolved_response.json()["data"]],
                [str(self.resolved_conflict_id)],
            )

            for headers in (self.event_manager_headers, self.member_headers):
                denied = await client.get(
                    "/admin/web-registration/conflicts",
                    headers=headers,
                )
                self.assertEqual(denied.status_code, 403)
                denied_update = await client.patch(
                    f"/admin/web-registration/conflicts/{self.open_conflict_id}",
                    headers=headers,
                    json={"status": "resolved"},
                )
                self.assertEqual(denied_update.status_code, 403)

            invalid_update = await client.patch(
                f"/admin/web-registration/conflicts/{self.open_conflict_id}",
                headers=self.admin_headers,
                json={"status": "resolved", "merge_users": True},
            )
            self.assertEqual(invalid_update.status_code, 422)

    async def test_resolve_is_idempotent_reopen_is_safe_and_foreign_is_not_found(self) -> None:
        async with AsyncSessionLocal() as session:
            email_profile_before = await session.scalar(
                select(Profile.display_name).where(Profile.user_id == self.email_user_id),
            )
            phone_profile_before = await session.scalar(
                select(Profile.display_name).where(Profile.user_id == self.phone_user_id),
            )
            user_count_before = await session.scalar(select(func.count()).select_from(AppUser))
            registration_count_before = await session.scalar(
                select(func.count())
                .select_from(EventRegistration)
                .where(EventRegistration.event_id == self.event_id),
            )
            conflict_before = await session.get(
                WebRegistrationIdentityConflict,
                self.open_conflict_id,
            )
            assert conflict_before is not None
            intent_id = conflict_before.registration_intent_id
            intent_status_before = await session.scalar(
                select(WebRegistrationIntent.status).where(
                    WebRegistrationIntent.id == intent_id,
                ),
            )

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            resolved = await client.patch(
                f"/admin/web-registration/conflicts/{self.open_conflict_id}",
                headers=self.admin_headers,
                json={"status": "resolved"},
            )
            self.assertEqual(resolved.status_code, 200)
            resolved_at = resolved.json()["data"]["resolved_at"]
            self.assertIsNotNone(resolved_at)

            repeated = await client.patch(
                f"/admin/web-registration/conflicts/{self.open_conflict_id}",
                headers=self.admin_headers,
                json={"status": "resolved"},
            )
            self.assertEqual(repeated.status_code, 200)
            self.assertEqual(repeated.json()["data"]["resolved_at"], resolved_at)

            reopened = await client.patch(
                f"/admin/web-registration/conflicts/{self.open_conflict_id}",
                headers=self.admin_headers,
                json={"status": "open"},
            )
            self.assertEqual(reopened.status_code, 200)
            self.assertIsNone(reopened.json()["data"]["resolved_at"])

            foreign = await client.patch(
                f"/admin/web-registration/conflicts/{self.foreign_conflict_id}",
                headers=self.admin_headers,
                json={"status": "resolved"},
            )
            self.assertEqual(foreign.status_code, 404)
            self.assertEqual(foreign.json()["error"]["code"], "not_found")

        async with AsyncSessionLocal() as session:
            self.assertEqual(
                await session.scalar(
                    select(Profile.display_name).where(
                        Profile.user_id == self.email_user_id,
                    ),
                ),
                email_profile_before,
            )
            self.assertEqual(
                await session.scalar(
                    select(Profile.display_name).where(
                        Profile.user_id == self.phone_user_id,
                    ),
                ),
                phone_profile_before,
            )
            self.assertEqual(
                await session.scalar(select(func.count()).select_from(AppUser)),
                user_count_before,
            )
            self.assertEqual(
                await session.scalar(
                    select(func.count())
                    .select_from(EventRegistration)
                    .where(EventRegistration.event_id == self.event_id),
                ),
                registration_count_before,
            )
            self.assertEqual(
                await session.scalar(
                    select(WebRegistrationIntent.status).where(
                        WebRegistrationIntent.id == intent_id,
                    ),
                ),
                intent_status_before,
            )


if __name__ == "__main__":
    unittest.main()
