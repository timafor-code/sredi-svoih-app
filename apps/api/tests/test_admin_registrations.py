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
    EventCapacityUnit,
    EventCategory,
    EventOccurrence,
    EventParticipationOption,
    EventParticipationOptionCapacityUnit,
    EventRegistration,
    EventRegistrationCapacityReservation,
    EventRegistrationOptionSelection,
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


class AdminRegistrationCapacityUnitFilterTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.community_id = uuid4()
        self.foreign_community_id = uuid4()
        self.admin_id = uuid4()
        self.participant_ids = [uuid4() for _ in range(6)]
        self.event_id = uuid4()
        self.foreign_event_id = uuid4()
        self.first_occurrence_id = uuid4()
        self.second_occurrence_id = uuid4()
        self.friday_unit_id = uuid4()
        self.lunch_unit_id = uuid4()
        self.foreign_unit_id = uuid4()
        self.registration_ids = {
            "friday_only": uuid4(),
            "both_units": uuid4(),
            "donation_only": uuid4(),
            "non_capacity": uuid4(),
            "persisted": uuid4(),
            "legacy_lunch": uuid4(),
        }
        self.option_ids = {
            "friday_only": uuid4(),
            "both_units": uuid4(),
            "donation_only": uuid4(),
            "non_capacity": uuid4(),
            "legacy_lunch": uuid4(),
        }
        now = datetime.now(UTC).replace(microsecond=0)

        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add_all(
                    [
                        Community(
                            id=self.community_id,
                            name="Capacity unit filter community",
                            city="Moscow",
                            slug=f"capacity-filter-{self.community_id.hex[:12]}",
                        ),
                        Community(
                            id=self.foreign_community_id,
                            name="Foreign capacity unit filter community",
                            city="Moscow",
                            slug=f"capacity-filter-{self.foreign_community_id.hex[:12]}",
                        ),
                        AppUser(
                            id=self.admin_id,
                            account_origin="admin",
                            claim_state="claimed",
                            status="active",
                        ),
                        *[
                            AppUser(
                                id=user_id,
                                email=(
                                    "both-unit-search@example.invalid"
                                    if index == 1
                                    else f"capacity-filter-{index}@example.invalid"
                                ),
                                account_origin="migration",
                                claim_state="legacy_external",
                                status="active",
                            )
                            for index, user_id in enumerate(self.participant_ids)
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
                            title="Capacity unit filter event",
                            starts_at=now + timedelta(days=2),
                            category="community",
                        ),
                        Event(
                            id=self.foreign_event_id,
                            community_id=self.foreign_community_id,
                            title="Foreign capacity unit filter event",
                            starts_at=now + timedelta(days=2),
                            category="community",
                        ),
                    ],
                )
                await session.flush()
                session.add_all(
                    [
                        EventOccurrence(
                            id=self.first_occurrence_id,
                            event_id=self.event_id,
                            title="First occurrence",
                            starts_at=now + timedelta(days=2),
                        ),
                        EventOccurrence(
                            id=self.second_occurrence_id,
                            event_id=self.event_id,
                            title="Second occurrence",
                            starts_at=now + timedelta(days=3),
                        ),
                        EventCapacityUnit(
                            id=self.friday_unit_id,
                            event_id=self.event_id,
                            key="first_meal",
                            title="First meal",
                            capacity=100,
                            sort_order=0,
                        ),
                        EventCapacityUnit(
                            id=self.lunch_unit_id,
                            event_id=self.event_id,
                            key="second_meal",
                            title="Second meal",
                            capacity=100,
                            sort_order=1,
                        ),
                        EventCapacityUnit(
                            id=self.foreign_unit_id,
                            event_id=self.foreign_event_id,
                            key="foreign_meal",
                            title="Foreign meal",
                            capacity=100,
                        ),
                    ],
                )
                options = [
                    EventParticipationOption(
                        id=self.option_ids["friday_only"],
                        event_id=self.event_id,
                        title="First meal only",
                        option_type="meal",
                    ),
                    EventParticipationOption(
                        id=self.option_ids["both_units"],
                        event_id=self.event_id,
                        title="Both meals",
                        option_type="package",
                    ),
                    EventParticipationOption(
                        id=self.option_ids["donation_only"],
                        event_id=self.event_id,
                        title="Donation",
                        option_type="donation",
                        is_donation=True,
                        counts_toward_capacity=False,
                    ),
                    EventParticipationOption(
                        id=self.option_ids["non_capacity"],
                        event_id=self.event_id,
                        title="Informational option",
                        option_type="other",
                        counts_toward_capacity=False,
                    ),
                    EventParticipationOption(
                        id=self.option_ids["legacy_lunch"],
                        event_id=self.event_id,
                        title="Legacy second meal",
                        option_type="meal",
                    ),
                ]
                session.add_all(options)
                await session.flush()
                session.add_all(
                    [
                        EventParticipationOptionCapacityUnit(
                            event_id=self.event_id,
                            option_id=self.option_ids["friday_only"],
                            capacity_unit_id=self.friday_unit_id,
                        ),
                        EventParticipationOptionCapacityUnit(
                            event_id=self.event_id,
                            option_id=self.option_ids["both_units"],
                            capacity_unit_id=self.friday_unit_id,
                        ),
                        EventParticipationOptionCapacityUnit(
                            event_id=self.event_id,
                            option_id=self.option_ids["both_units"],
                            capacity_unit_id=self.lunch_unit_id,
                        ),
                        EventParticipationOptionCapacityUnit(
                            event_id=self.event_id,
                            option_id=self.option_ids["donation_only"],
                            capacity_unit_id=self.lunch_unit_id,
                        ),
                        EventParticipationOptionCapacityUnit(
                            event_id=self.event_id,
                            option_id=self.option_ids["non_capacity"],
                            capacity_unit_id=self.lunch_unit_id,
                        ),
                        EventParticipationOptionCapacityUnit(
                            event_id=self.event_id,
                            option_id=self.option_ids["legacy_lunch"],
                            capacity_unit_id=self.lunch_unit_id,
                        ),
                    ],
                )
                registrations = [
                    EventRegistration(
                        id=self.registration_ids["friday_only"],
                        event_id=self.event_id,
                        occurrence_id=self.first_occurrence_id,
                        user_id=self.participant_ids[0],
                        status="pending",
                        source_channel="mobile",
                        registered_at=now + timedelta(minutes=1),
                    ),
                    EventRegistration(
                        id=self.registration_ids["both_units"],
                        event_id=self.event_id,
                        occurrence_id=self.first_occurrence_id,
                        user_id=self.participant_ids[1],
                        status="cancelled",
                        source_channel="public_web",
                        registered_at=now + timedelta(minutes=2),
                    ),
                    EventRegistration(
                        id=self.registration_ids["donation_only"],
                        event_id=self.event_id,
                        occurrence_id=self.first_occurrence_id,
                        user_id=self.participant_ids[2],
                        status="confirmed",
                        source_channel="admin",
                        registered_at=now + timedelta(minutes=3),
                    ),
                    EventRegistration(
                        id=self.registration_ids["non_capacity"],
                        event_id=self.event_id,
                        occurrence_id=self.first_occurrence_id,
                        user_id=self.participant_ids[3],
                        status="waitlisted",
                        source_channel="mobile",
                        registered_at=now + timedelta(minutes=4),
                    ),
                    EventRegistration(
                        id=self.registration_ids["persisted"],
                        event_id=self.event_id,
                        occurrence_id=self.second_occurrence_id,
                        user_id=self.participant_ids[4],
                        status="rejected",
                        source_channel="admin",
                        registered_at=now + timedelta(minutes=5),
                    ),
                    EventRegistration(
                        id=self.registration_ids["legacy_lunch"],
                        event_id=self.event_id,
                        occurrence_id=self.second_occurrence_id,
                        user_id=self.participant_ids[5],
                        status="no_show",
                        source_channel="mobile",
                        registered_at=now + timedelta(minutes=6),
                    ),
                ]
                session.add_all(registrations)
                await session.flush()
                session.add_all(
                    [
                        EventRegistrationOptionSelection(
                            registration_id=self.registration_ids[key],
                            option_id=self.option_ids[key],
                            title_snapshot=option.title,
                            option_type_snapshot=option.option_type,
                            quantity=1,
                            seats_count=(
                                0 if key in {"donation_only", "non_capacity"} else 1
                            ),
                            is_donation=option.is_donation,
                            counts_toward_capacity=option.counts_toward_capacity,
                        )
                        for key, option in zip(
                            [
                                "friday_only",
                                "both_units",
                                "donation_only",
                                "non_capacity",
                                "legacy_lunch",
                            ],
                            options,
                            strict=True,
                        )
                    ],
                )
                session.add(
                    EventRegistrationCapacityReservation(
                        registration_id=self.registration_ids["persisted"],
                        event_id=self.event_id,
                        occurrence_id=self.second_occurrence_id,
                        capacity_unit_id=self.friday_unit_id,
                        option_id=None,
                        capacity_unit_key_snapshot="first_meal",
                        capacity_unit_title_snapshot="First meal",
                        option_title_snapshot="Persisted selection",
                        quantity=1,
                        seats_per_quantity=1,
                        seats_count=1,
                    ),
                )

        self.headers = {
            "Authorization": f"Bearer {create_access_token(self.admin_id)}",
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
                            AppUser.id.in_([self.admin_id, *self.participant_ids]),
                        ),
                    )
        finally:
            await engine.dispose()

    async def _list(self, **params: object) -> httpx.Response:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            return await client.get(
                f"/admin/events/{self.event_id}/registrations",
                headers=self.headers,
                params=params,
            )

    async def test_no_capacity_unit_filter_keeps_existing_list_behavior(self) -> None:
        response = await self._list()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            {item["id"] for item in response.json()["data"]},
            {str(registration_id) for registration_id in self.registration_ids.values()},
        )

    async def test_fallback_classifies_single_multi_and_non_capacity_options(self) -> None:
        friday = await self._list(capacity_unit_id=self.friday_unit_id)
        lunch = await self._list(capacity_unit_id=self.lunch_unit_id)

        self.assertEqual(friday.status_code, 200)
        self.assertEqual(lunch.status_code, 200)
        friday_ids = {item["id"] for item in friday.json()["data"]}
        lunch_ids = {item["id"] for item in lunch.json()["data"]}
        self.assertIn(str(self.registration_ids["friday_only"]), friday_ids)
        self.assertNotIn(str(self.registration_ids["friday_only"]), lunch_ids)
        self.assertIn(str(self.registration_ids["both_units"]), friday_ids)
        self.assertIn(str(self.registration_ids["both_units"]), lunch_ids)
        self.assertIn(str(self.registration_ids["legacy_lunch"]), lunch_ids)
        self.assertNotIn(str(self.registration_ids["donation_only"]), lunch_ids)
        self.assertNotIn(str(self.registration_ids["non_capacity"]), lunch_ids)

    async def test_persisted_capacity_reservation_qualifies(self) -> None:
        response = await self._list(capacity_unit_id=self.friday_unit_id)

        self.assertEqual(response.status_code, 200)
        self.assertIn(
            str(self.registration_ids["persisted"]),
            {item["id"] for item in response.json()["data"]},
        )

    async def test_capacity_unit_combines_with_search_source_and_occurrence(self) -> None:
        searched = await self._list(
            capacity_unit_id=self.friday_unit_id,
            search="both-unit-search",
        )
        sourced = await self._list(
            capacity_unit_id=self.friday_unit_id,
            source_channel="public_web",
        )
        first_occurrence = await self._list(
            capacity_unit_id=self.friday_unit_id,
            occurrence_id=self.first_occurrence_id,
        )
        second_occurrence = await self._list(
            capacity_unit_id=self.friday_unit_id,
            occurrence_id=self.second_occurrence_id,
        )

        expected_both = [str(self.registration_ids["both_units"])]
        self.assertEqual([item["id"] for item in searched.json()["data"]], expected_both)
        self.assertEqual([item["id"] for item in sourced.json()["data"]], expected_both)
        self.assertEqual(
            {item["id"] for item in first_occurrence.json()["data"]},
            {
                str(self.registration_ids["friday_only"]),
                str(self.registration_ids["both_units"]),
            },
        )
        self.assertEqual(
            [item["id"] for item in second_occurrence.json()["data"]],
            [str(self.registration_ids["persisted"])],
        )

    async def test_pagination_is_applied_after_capacity_unit_filtering(self) -> None:
        complete = await self._list(capacity_unit_id=self.friday_unit_id)
        first_page = await self._list(
            capacity_unit_id=self.friday_unit_id,
            limit=2,
            offset=0,
        )
        second_page = await self._list(
            capacity_unit_id=self.friday_unit_id,
            limit=2,
            offset=2,
        )

        complete_ids = [item["id"] for item in complete.json()["data"]]
        paged_ids = [
            *[item["id"] for item in first_page.json()["data"]],
            *[item["id"] for item in second_page.json()["data"]],
        ]
        self.assertEqual(paged_ids, complete_ids)
        self.assertEqual(len(complete_ids), 3)

    async def test_foreign_capacity_unit_and_event_are_rejected_safely(self) -> None:
        foreign_unit = await self._list(capacity_unit_id=self.foreign_unit_id)

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            foreign_event = await client.get(
                f"/admin/events/{self.foreign_event_id}/registrations",
                headers=self.headers,
                params={"capacity_unit_id": self.foreign_unit_id},
            )

        self.assertEqual(foreign_unit.status_code, 404)
        self.assertEqual(foreign_unit.json()["error"]["code"], "not_found")
        self.assertEqual(foreign_event.status_code, 404)
        self.assertEqual(foreign_event.json()["error"]["code"], "not_found")


if __name__ == "__main__":
    unittest.main()
