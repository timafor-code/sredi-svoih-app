from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import delete, select

from app.db.models.core import (
    AppUser,
    Community,
    CommunityMembership,
    Event,
    EventCategory,
    EventOccurrence,
    EventRegistration,
)
from app.db.session import AsyncSessionLocal, engine
from app.schemas.admin_events import (
    AdminEventOccurrenceUpsertRequest,
    AdminEventOccurrencesReplaceRequest,
)
from app.services import admin_events as admin_events_service


class AdminEventOccurrenceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.community_id = uuid4()
        self.actor_id = uuid4()
        self.event_id = uuid4()
        self.occurrence_id = uuid4()
        self.registration_id = uuid4()
        self.now = datetime.now(UTC).replace(microsecond=0)
        self.starts_at = self.now - timedelta(days=2)
        self.ends_at = self.starts_at + timedelta(hours=3)

        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add_all([
                    Community(
                        id=self.community_id,
                        name="Admin occurrence test community",
                        city="Moscow",
                        slug=f"occurrence-{self.community_id.hex[:20]}",
                    ),
                    AppUser(
                        id=self.actor_id,
                        email=f"occurrence-{self.actor_id.hex[:12]}@example.invalid",
                        password_hash="not-a-public-value",
                        status="active",
                    ),
                ])
                await session.flush()
                session.add(
                    EventCategory(
                        community_id=self.community_id,
                        slug="community",
                        title="Community",
                        color="#123456",
                        icon="*",
                        created_by=self.actor_id,
                        updated_by=self.actor_id,
                    ),
                )
                await session.flush()

        async with AsyncSessionLocal() as session:
            category = await session.scalar(
                select(EventCategory).where(
                    EventCategory.community_id == self.community_id,
                    EventCategory.slug == "community",
                ),
            )
        assert category is not None

        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add_all(
                    [
                        CommunityMembership(
                            community_id=self.community_id,
                            user_id=self.actor_id,
                            role="admin",
                            status="active",
                        ),
                        Event(
                            id=self.event_id,
                            community_id=self.community_id,
                            title="Past Shabbat",
                            starts_at=self.starts_at,
                            category="community",
                        ),
                        EventOccurrence(
                            id=self.occurrence_id,
                            event_id=self.event_id,
                            title="Past Shabbat occurrence",
                            starts_at=self.starts_at,
                            ends_at=self.ends_at,
                            timezone="Europe/Moscow",
                            capacity=None,
                            status="active",
                            sort_order=0,
                        ),
                        EventRegistration(
                            id=self.registration_id,
                            event_id=self.event_id,
                            user_id=self.actor_id,
                            occurrence_id=self.occurrence_id,
                            status="confirmed",
                        ),
                    ],
                )

    async def asyncTearDown(self) -> None:
        try:
            async with AsyncSessionLocal() as session:
                async with session.begin():
                    await session.execute(
                        delete(Community).where(Community.id == self.community_id),
                    )
                    await session.execute(
                        delete(AppUser).where(AppUser.id == self.actor_id),
                    )
        finally:
            await engine.dispose()

    async def test_archiving_inherited_occurrence_persists_and_keeps_registrations(
        self,
    ) -> None:
        payload = AdminEventOccurrencesReplaceRequest(
            occurrences=[
                AdminEventOccurrenceUpsertRequest(
                    id=self.occurrence_id,
                    title="Past Shabbat occurrence",
                    starts_at=self.starts_at,
                    ends_at=self.ends_at,
                    timezone="Europe/Moscow",
                    capacity=None,
                    waitlist_enabled=None,
                    requires_approval=None,
                    status="archived",
                    sort_order=0,
                ),
            ],
        )

        async with AsyncSessionLocal() as session:
            actor = await session.get(AppUser, self.actor_id)
            assert actor is not None
            saved = await admin_events_service.replace_admin_event_occurrences(
                session,
                actor,
                self.event_id,
                payload,
            )

        self.assertEqual(len(saved), 1)
        self.assertEqual(saved[0].id, self.occurrence_id)
        self.assertEqual(saved[0].status, "archived")
        self.assertIsNone(saved[0].capacity)

        async with AsyncSessionLocal() as session:
            actor = await session.get(AppUser, self.actor_id)
            assert actor is not None
            reloaded = await admin_events_service.list_admin_event_occurrences(
                session,
                actor,
                self.event_id,
            )
            registration = await session.get(EventRegistration, self.registration_id)

        self.assertEqual([(item.id, item.status) for item in reloaded], [
            (self.occurrence_id, "archived"),
        ])
        self.assertIsNotNone(registration)
        assert registration is not None
        self.assertEqual(registration.occurrence_id, self.occurrence_id)
