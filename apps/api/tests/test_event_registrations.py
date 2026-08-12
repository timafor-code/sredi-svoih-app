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
    Event,
    EventCategory,
    EventOccurrence,
    EventParticipationOption,
    EventRegistration,
    EventRegistrationOptionSelection,
)
from app.db.session import AsyncSessionLocal, engine
from app.main import app


class EventRegistrationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.community_id = uuid4()
        self.user_id = uuid4()
        self.paid_event_id = uuid4()
        self.free_event_id = uuid4()
        self.paid_occurrence_id = uuid4()
        self.free_occurrence_id = uuid4()
        self.option_a_id = uuid4()
        self.option_b_id = uuid4()
        now = datetime.now(UTC).replace(microsecond=0)

        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add_all(
                    [
                        Community(
                            id=self.community_id,
                            name="Event registration tests",
                            city="Moscow",
                            slug=f"event-registration-{self.community_id.hex[:12]}",
                        ),
                        AppUser(
                            id=self.user_id,
                            email=f"event-registration-{self.user_id.hex[:12]}@example.invalid",
                            account_origin="migration",
                            claim_state="legacy_external",
                            status="active",
                        ),
                    ],
                )
                await session.flush()
                session.add(
                    EventCategory(
                        community_id=self.community_id,
                        slug="community",
                        title="Community",
                        color="#123456",
                        icon="*",
                    ),
                )
                await session.flush()
                session.add_all(
                    [
                        Event(
                            id=self.paid_event_id,
                            community_id=self.community_id,
                            event_kind="shabbat",
                            title="Repeat paid registration",
                            starts_at=now + timedelta(days=2),
                            category="community",
                            registration_mode="internal_paid",
                            status="published",
                            visibility="public",
                            capacity=3,
                            waitlist_enabled=False,
                        ),
                        Event(
                            id=self.free_event_id,
                            community_id=self.community_id,
                            title="Duplicate-safe free registration",
                            starts_at=now + timedelta(days=3),
                            category="community",
                            registration_mode="internal_free",
                            status="published",
                            visibility="public",
                            capacity=10,
                        ),
                    ],
                )
                await session.flush()
                session.add_all(
                    [
                        EventOccurrence(
                            id=self.paid_occurrence_id,
                            event_id=self.paid_event_id,
                            starts_at=now + timedelta(days=2),
                            capacity=3,
                            waitlist_enabled=False,
                            status="active",
                        ),
                        EventOccurrence(
                            id=self.free_occurrence_id,
                            event_id=self.free_event_id,
                            starts_at=now + timedelta(days=3),
                            capacity=10,
                            status="active",
                        ),
                        EventParticipationOption(
                            id=self.option_a_id,
                            event_id=self.paid_event_id,
                            title="Option A",
                            description="First option snapshot",
                            option_type="package",
                            price_amount=1000,
                            price_currency="RUB",
                            seat_limit=3,
                            allow_quantity=True,
                            min_quantity=1,
                            max_quantity=3,
                        ),
                        EventParticipationOption(
                            id=self.option_b_id,
                            event_id=self.paid_event_id,
                            title="Option B",
                            description="Second option snapshot",
                            option_type="child",
                            price_amount=700,
                            price_currency="RUB",
                            seat_limit=3,
                            allow_quantity=True,
                            min_quantity=1,
                            max_quantity=3,
                        ),
                    ],
                )

        self.headers = {
            "Authorization": f"Bearer {create_access_token(self.user_id)}",
        }
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
        )

    async def asyncTearDown(self) -> None:
        await self.client.aclose()
        try:
            async with AsyncSessionLocal() as session:
                async with session.begin():
                    await session.execute(
                        delete(Community).where(Community.id == self.community_id),
                    )
                    await session.execute(
                        delete(AppUser).where(AppUser.id == self.user_id),
                    )
        finally:
            await engine.dispose()

    async def _register_paid(
        self,
        option_id: UUID,
        quantity: int,
    ) -> httpx.Response:
        return await self.client.post(
            f"/events/{self.paid_event_id}/register",
            headers=self.headers,
            json={
                "occurrence_id": str(self.paid_occurrence_id),
                "option_selections": [
                    {"option_id": str(option_id), "quantity": quantity},
                ],
            },
        )

    async def _register_free(self) -> httpx.Response:
        return await self.client.post(
            f"/events/{self.free_event_id}/register",
            headers=self.headers,
            json={"occurrence_id": str(self.free_occurrence_id)},
        )

    async def test_repeat_paid_same_event_and_occurrence_creates_distinct_rows(
        self,
    ) -> None:
        first = await self._register_paid(self.option_a_id, 1)
        second = await self._register_paid(self.option_a_id, 1)

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        first_registration = first.json()["data"]
        second_registration = second.json()["data"]
        self.assertNotEqual(first_registration["id"], second_registration["id"])

        async with AsyncSessionLocal() as session:
            registrations = list(
                await session.scalars(
                    select(EventRegistration)
                    .where(EventRegistration.event_id == self.paid_event_id)
                    .order_by(EventRegistration.created_at, EventRegistration.id),
                ),
            )

        self.assertEqual(len(registrations), 2)
        self.assertEqual({item.user_id for item in registrations}, {self.user_id})
        self.assertEqual(
            {item.occurrence_id for item in registrations},
            {self.paid_occurrence_id},
        )

    async def test_repeat_paid_selections_are_independent_snapshots(self) -> None:
        first = await self._register_paid(self.option_a_id, 1)
        second = await self._register_paid(self.option_b_id, 2)

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        first_id = UUID(first.json()["data"]["id"])
        second_id = UUID(second.json()["data"]["id"])

        async with AsyncSessionLocal() as session:
            selections = list(
                await session.scalars(
                    select(EventRegistrationOptionSelection)
                    .where(
                        EventRegistrationOptionSelection.registration_id.in_(
                            [first_id, second_id],
                        ),
                    )
                    .order_by(EventRegistrationOptionSelection.created_at),
                ),
            )

        selections_by_registration = {
            selection.registration_id: selection for selection in selections
        }
        self.assertEqual(len(selections), 2)
        first_snapshot = selections_by_registration[first_id]
        self.assertEqual(first_snapshot.option_id, self.option_a_id)
        self.assertEqual(first_snapshot.title_snapshot, "Option A")
        self.assertEqual(first_snapshot.description_snapshot, "First option snapshot")
        self.assertEqual(first_snapshot.option_type_snapshot, "package")
        self.assertEqual(first_snapshot.quantity, 1)
        self.assertEqual(first_snapshot.unit_price_amount, 1000)
        self.assertEqual(first_snapshot.total_amount, 1000)
        self.assertEqual(first_snapshot.currency, "RUB")
        self.assertEqual(first_snapshot.seats_count, 1)

        second_snapshot = selections_by_registration[second_id]
        self.assertEqual(second_snapshot.option_id, self.option_b_id)
        self.assertEqual(second_snapshot.title_snapshot, "Option B")
        self.assertEqual(second_snapshot.description_snapshot, "Second option snapshot")
        self.assertEqual(second_snapshot.option_type_snapshot, "child")
        self.assertEqual(second_snapshot.quantity, 2)
        self.assertEqual(second_snapshot.unit_price_amount, 700)
        self.assertEqual(second_snapshot.total_amount, 1400)
        self.assertEqual(second_snapshot.currency, "RUB")
        self.assertEqual(second_snapshot.seats_count, 2)

    async def test_me_registrations_returns_each_paid_registration(self) -> None:
        first = await self._register_paid(self.option_a_id, 1)
        second = await self._register_paid(self.option_b_id, 1)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)

        listed = await self.client.get(
            "/me/registrations",
            headers=self.headers,
        )

        self.assertEqual(listed.status_code, 200)
        paid_registrations = [
            item
            for item in listed.json()["data"]
            if item["event_id"] == str(self.paid_event_id)
        ]
        self.assertEqual(len(paid_registrations), 2)
        self.assertEqual(
            {item["id"] for item in paid_registrations},
            {first.json()["data"]["id"], second.json()["data"]["id"]},
        )

    async def test_capacity_counts_all_repeat_paid_registrations(self) -> None:
        first = await self._register_paid(self.option_a_id, 2)
        second = await self._register_paid(self.option_b_id, 1)
        third = await self._register_paid(self.option_a_id, 1)

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(third.status_code, 409)
        self.assertEqual(third.json()["error"]["code"], "capacity_unavailable")

        async with AsyncSessionLocal() as session:
            registration_count = await session.scalar(
                select(func.count())
                .select_from(EventRegistration)
                .where(EventRegistration.event_id == self.paid_event_id),
            )
            occupied_seats = await session.scalar(
                select(func.sum(EventRegistration.seats_count)).where(
                    EventRegistration.event_id == self.paid_event_id,
                    EventRegistration.status.in_(["pending", "confirmed"]),
                ),
            )

        self.assertEqual(registration_count, 2)
        self.assertEqual(occupied_seats, 3)

    async def test_internal_free_remains_duplicate_safe(self) -> None:
        first = await self._register_free()
        second = await self._register_free()

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.json()["data"]["id"], second.json()["data"]["id"])

        async with AsyncSessionLocal() as session:
            registration_count = await session.scalar(
                select(func.count())
                .select_from(EventRegistration)
                .where(
                    EventRegistration.event_id == self.free_event_id,
                    EventRegistration.user_id == self.user_id,
                    EventRegistration.occurrence_id == self.free_occurrence_id,
                    EventRegistration.status.in_(["pending", "confirmed", "waitlisted"]),
                ),
            )

        self.assertEqual(registration_count, 1)

    async def test_cancellation_isolated_to_selected_registration(self) -> None:
        first = await self._register_paid(self.option_a_id, 1)
        second = await self._register_paid(self.option_b_id, 1)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        first_id = UUID(first.json()["data"]["id"])
        second_id = UUID(second.json()["data"]["id"])

        cancelled = await self.client.post(
            f"/registrations/{second_id}/cancel",
            headers=self.headers,
        )

        self.assertEqual(cancelled.status_code, 200)
        self.assertEqual(cancelled.json()["data"]["id"], str(second_id))
        self.assertEqual(cancelled.json()["data"]["status"], "cancelled")
        async with AsyncSessionLocal() as session:
            first_registration = await session.get(EventRegistration, first_id)
            second_registration = await session.get(EventRegistration, second_id)

        assert first_registration is not None
        assert second_registration is not None
        self.assertEqual(first_registration.status, "pending")
        self.assertEqual(second_registration.status, "cancelled")


if __name__ == "__main__":
    unittest.main()
