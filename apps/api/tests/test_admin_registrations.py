from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import httpx
from sqlalchemy import delete

from app.core.tokens import create_access_token
from app.db.models.core import (
    AppUser,
    Community,
    CommunityMembership,
    Event,
    EventCategory,
    EventRegistration,
)
from app.db.session import AsyncSessionLocal, engine
from app.main import app


class AdminRegistrationSourceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.community_id = uuid4()
        self.foreign_community_id = uuid4()
        self.admin_id = uuid4()
        self.event_manager_id = uuid4()
        self.participant_ids = [uuid4() for _ in range(4)]
        self.event_id = uuid4()
        self.foreign_event_id = uuid4()
        self.registration_ids = [uuid4() for _ in range(3)]
        now = datetime.now(UTC).replace(microsecond=0)

        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add_all(
                    [
                        Community(
                            id=self.community_id,
                            name="Registration source community",
                            city="Moscow",
                            slug=f"registration-source-{self.community_id.hex[:12]}",
                        ),
                        Community(
                            id=self.foreign_community_id,
                            name="Foreign registration source community",
                            city="Moscow",
                            slug=f"registration-source-{self.foreign_community_id.hex[:12]}",
                        ),
                        AppUser(
                            id=self.admin_id,
                            account_origin="admin",
                            claim_state="claimed",
                            status="active",
                        ),
                        AppUser(
                            id=self.event_manager_id,
                            account_origin="admin",
                            claim_state="claimed",
                            status="active",
                        ),
                        *[
                            AppUser(
                                id=user_id,
                                email=f"registration-{user_id.hex[:12]}@example.invalid",
                                account_origin="migration",
                                claim_state="legacy_external",
                                status="active",
                            )
                            for user_id in self.participant_ids
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
                            title="Source visibility event",
                            starts_at=now + timedelta(days=2),
                            category="community",
                        ),
                        Event(
                            id=self.foreign_event_id,
                            community_id=self.foreign_community_id,
                            title="Foreign source visibility event",
                            starts_at=now + timedelta(days=2),
                            category="community",
                        ),
                    ],
                )
                await session.flush()
                session.add_all(
                    [
                        EventRegistration(
                            id=self.registration_ids[0],
                            event_id=self.event_id,
                            user_id=self.participant_ids[0],
                            status="pending",
                            source_channel="mobile",
                        ),
                        EventRegistration(
                            id=self.registration_ids[1],
                            event_id=self.event_id,
                            user_id=self.participant_ids[1],
                            status="confirmed",
                            source_channel="public_web",
                        ),
                        EventRegistration(
                            id=self.registration_ids[2],
                            event_id=self.event_id,
                            user_id=self.participant_ids[2],
                            status="waitlisted",
                            source_channel="admin",
                        ),
                        EventRegistration(
                            event_id=self.foreign_event_id,
                            user_id=self.participant_ids[3],
                            status="confirmed",
                            source_channel="public_web",
                        ),
                    ],
                )

        self.admin_headers = {
            "Authorization": f"Bearer {create_access_token(self.admin_id)}",
        }
        self.event_manager_headers = {
            "Authorization": f"Bearer {create_access_token(self.event_manager_id)}",
        }

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
                                    *self.participant_ids,
                                ],
                            ),
                        ),
                    )
        finally:
            await engine.dispose()

    async def test_list_returns_and_filters_canonical_source_channels(self) -> None:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            listed = await client.get(
                f"/admin/events/{self.event_id}/registrations",
                headers=self.event_manager_headers,
            )
            self.assertEqual(listed.status_code, 200)
            data = listed.json()["data"]
            self.assertEqual(
                {item["source_channel"] for item in data},
                {"mobile", "public_web", "admin"},
            )

            for source_channel in ("mobile", "public_web", "admin"):
                filtered = await client.get(
                    f"/admin/events/{self.event_id}/registrations",
                    headers=self.admin_headers,
                    params={"source_channel": source_channel},
                )
                self.assertEqual(filtered.status_code, 200)
                filtered_data = filtered.json()["data"]
                self.assertEqual(len(filtered_data), 1)
                self.assertEqual(filtered_data[0]["source_channel"], source_channel)

            status_filtered = await client.get(
                f"/admin/events/{self.event_id}/registrations",
                headers=self.admin_headers,
                params={"status": "waitlisted"},
            )
            self.assertEqual(status_filtered.status_code, 200)
            self.assertEqual(status_filtered.json()["data"][0]["status"], "waitlisted")

    async def test_invalid_source_and_foreign_event_use_safe_envelopes(self) -> None:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            invalid = await client.get(
                f"/admin/events/{self.event_id}/registrations",
                headers=self.admin_headers,
                params={"source_channel": "unknown"},
            )
            self.assertEqual(invalid.status_code, 422)
            self.assertEqual(invalid.json()["error"]["code"], "validation_error")

            foreign = await client.get(
                f"/admin/events/{self.foreign_event_id}/registrations",
                headers=self.admin_headers,
            )
            self.assertEqual(foreign.status_code, 404)
            self.assertEqual(foreign.json()["error"]["code"], "not_found")

    async def test_existing_status_and_attendance_actions_preserve_source(self) -> None:
        registration_id = self.registration_ids[0]
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            confirmed = await client.post(
                f"/admin/registrations/{registration_id}/confirm",
                headers=self.admin_headers,
            )
            self.assertEqual(confirmed.status_code, 200)
            self.assertEqual(confirmed.json()["data"]["status"], "confirmed")
            self.assertEqual(confirmed.json()["data"]["source_channel"], "mobile")

            attended = await client.post(
                f"/admin/registrations/{registration_id}/attended",
                headers=self.admin_headers,
            )
            self.assertEqual(attended.status_code, 200)
            self.assertEqual(attended.json()["data"]["status"], "attended")
            self.assertEqual(attended.json()["data"]["source_channel"], "mobile")

        async with AsyncSessionLocal() as session:
            registration = await session.get(EventRegistration, UUID(str(registration_id)))
        self.assertIsNotNone(registration)
        assert registration is not None
        self.assertEqual(registration.status, "attended")
        self.assertEqual(registration.source_channel, "mobile")


if __name__ == "__main__":
    unittest.main()
