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
    EventCapacityUnit,
    EventCategory,
    EventOccurrence,
    EventParticipationOption,
    EventParticipationOptionCapacityUnit,
    EventRegistration,
    EventRegistrationAnswer,
    EventRegistrationForm,
    EventRegistrationFormField,
    EventRegistrationCapacityReservation,
    EventRegistrationOptionSelection,
    Profile,
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
        self.questionnaire_form_id = uuid4()
        self.questionnaire_field_id = uuid4()
        self.optional_questionnaire_field_id = uuid4()
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
                await session.flush()
                form = EventRegistrationForm(
                    id=self.questionnaire_form_id,
                    event_id=self.event_id,
                    channel="web",
                    version=1,
                    purpose="Registration questionnaire",
                    status="draft",
                )
                session.add(form)
                await session.flush()
                session.add_all(
                    [
                        EventRegistrationFormField(
                            id=self.questionnaire_field_id, form_id=self.questionnaire_form_id,
                            field_key="conversion", field_type="single_select", label="Статус гиюра",
                            required=False, purpose="Registration question", retention_days=30,
                            options_payload=[{"value": "option_3", "label": "Я прошел гиюр"}],
                            validation_payload={}, data_category="ordinary", sort_order=0,
                        ),
                        EventRegistrationFormField(
                            id=self.optional_questionnaire_field_id,
                            form_id=self.questionnaire_form_id,
                            field_key="optional_note",
                            field_type="short_text",
                            label="Дополнительная заметка",
                            required=False,
                            purpose="Registration question",
                            retention_days=30,
                            options_payload=[],
                            validation_payload={},
                            data_category="ordinary",
                            sort_order=1,
                        ),
                    ],
                )
                await session.flush()
                form.status = "published"
                form.published_at = now
                session.add(EventRegistrationAnswer(
                    registration_id=self.registration_ids[0], field_id=self.questionnaire_field_id,
                    value_payload="option_3", purge_at=now + timedelta(days=30),
                ))

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

    async def test_questionnaire_answers_and_summary_use_registration_authorization(self) -> None:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            listed = await client.get(
                f"/admin/events/{self.event_id}/registrations",
                headers=self.event_manager_headers,
            )
            self.assertEqual(listed.status_code, 200)
            by_id = {row["id"]: row for row in listed.json()["data"]}
            answers = by_id[str(self.registration_ids[0])]["answers"]
            answer = next(item for item in answers if item["field_key"] == "conversion")
            self.assertEqual(answer["field_key"], "conversion")
            self.assertEqual(answer["field_id"], str(self.questionnaire_field_id))
            self.assertEqual(answer["label"], "Статус гиюра")
            self.assertEqual(answer["field_type"], "single_select")
            self.assertEqual(answer["value_payload"], "option_3")
            self.assertEqual(answer["form_version"], 1)
            self.assertEqual(answer["form_status"], "published")
            self.assertEqual(answer["options"], [{"value": "option_3", "label": "Я прошел гиюр"}])
            optional_answer = next(item for item in answers if item["field_key"] == "optional_note")
            self.assertIsNone(optional_answer["value_payload"])
            self.assertEqual(optional_answer["options"], [])
            self.assertEqual(by_id[str(self.registration_ids[1])]["answers"], [])

            summary = await client.get(
                f"/admin/events/{self.event_id}/questionnaire-answers/summary",
                headers=self.event_manager_headers,
            )
            self.assertEqual(summary.status_code, 200)
            field = summary.json()["data"]["fields"][0]
            self.assertEqual(field["answered_count"], 1)
            self.assertEqual(field["options"][0]["count"], 1)

            foreign = await client.get(
                f"/admin/events/{self.foreign_event_id}/questionnaire-answers/summary",
                headers=self.event_manager_headers,
            )
            self.assertEqual(foreign.status_code, 404)

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

class AdminRegistrationWriteContractTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.community_id = uuid4()
        self.foreign_community_id = uuid4()
        self.event_id = uuid4()
        self.foreign_event_id = uuid4()
        self.admin_id = uuid4()
        self.event_manager_id = uuid4()
        self.rabbi_id = uuid4()
        self.member_id = uuid4()
        self.inactive_admin_id = uuid4()
        self.foreign_admin_id = uuid4()
        self.existing_id = uuid4()
        self.duplicate_id = uuid4()
        self.out_of_scope_id = uuid4()
        self.unavailable_ids = [uuid4() for _ in range(3)]
        self.option_ids = [uuid4(), uuid4()]
        self.created_user_ids: list[UUID] = []
        self.marker = uuid4().int % 10_000_000
        now = datetime.now(UTC).replace(microsecond=0)

        users = [
            AppUser(id=self.admin_id, account_origin="admin", claim_state="claimed", status="active"),
            AppUser(id=self.event_manager_id, account_origin="admin", claim_state="claimed", status="active"),
            AppUser(id=self.rabbi_id, account_origin="admin", claim_state="claimed", status="active"),
            AppUser(id=self.member_id, account_origin="admin", claim_state="claimed", status="active"),
            AppUser(id=self.inactive_admin_id, account_origin="admin", claim_state="claimed", status="active"),
            AppUser(id=self.foreign_admin_id, account_origin="admin", claim_state="claimed", status="active"),
            AppUser(id=self.existing_id, email=f"existing-{self.event_id.hex[:12]}@example.invalid", account_origin="migration", claim_state="legacy_external", status="active"),
            AppUser(id=self.duplicate_id, email=f"duplicate-{self.event_id.hex[:12]}@example.invalid", account_origin="migration", claim_state="legacy_external", status="active"),
            AppUser(id=self.out_of_scope_id, email=f"outside-{self.event_id.hex[:12]}@example.invalid", account_origin="migration", claim_state="legacy_external", status="active"),
            AppUser(id=self.unavailable_ids[0], email=f"inactive-{self.event_id.hex[:12]}@example.invalid", account_origin="migration", claim_state="legacy_external", status="inactive"),
            AppUser(id=self.unavailable_ids[1], email=f"deleting-{self.event_id.hex[:12]}@example.invalid", account_origin="migration", claim_state="legacy_external", status="active", deletion_requested_at=now),
            AppUser(id=self.unavailable_ids[2], email=f"erased-{self.event_id.hex[:12]}@example.invalid", account_origin="migration", claim_state="legacy_external", status="active", erased_at=now),
        ]
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add_all([
                    Community(id=self.community_id, name="Admin write community", city="Moscow", slug=f"admin-write-{self.community_id.hex[:12]}"),
                    Community(id=self.foreign_community_id, name="Foreign admin write community", city="Moscow", slug=f"admin-write-foreign-{self.community_id.hex[:12]}"),
                    *users,
                ])
                await session.flush()
                session.add_all([
                    CommunityMembership(community_id=self.community_id, user_id=self.admin_id, role="admin", status="active"),
                    CommunityMembership(community_id=self.community_id, user_id=self.event_manager_id, role="event_manager", status="active"),
                    CommunityMembership(community_id=self.community_id, user_id=self.rabbi_id, role="rabbi", status="active"),
                    CommunityMembership(community_id=self.community_id, user_id=self.member_id, role="member", status="active"),
                    CommunityMembership(community_id=self.community_id, user_id=self.existing_id, role="member", status="active"),
                    *[
                        CommunityMembership(
                            community_id=self.community_id,
                            user_id=user_id,
                            role="member",
                            status="active",
                        )
                        for user_id in self.unavailable_ids
                    ],
                    CommunityMembership(community_id=self.community_id, user_id=self.inactive_admin_id, role="event_manager", status="suspended"),
                    CommunityMembership(community_id=self.foreign_community_id, user_id=self.foreign_admin_id, role="admin", status="active"),
                    CommunityMembership(community_id=self.foreign_community_id, user_id=self.out_of_scope_id, role="member", status="active"),
                    EventCategory(community_id=self.community_id, slug="community", title="Community", color="#123456", icon="*", created_by=self.admin_id, updated_by=self.admin_id),
                    EventCategory(community_id=self.foreign_community_id, slug="community", title="Community", color="#654321", icon="*", created_by=self.admin_id, updated_by=self.admin_id),
                ])
                await session.flush()
                session.add_all([
                    Profile(user_id=user_id, full_name=f"Participant {index}", display_name=f"Participant {index}")
                    for index, user_id in enumerate([self.existing_id, self.duplicate_id, self.out_of_scope_id, *self.unavailable_ids])
                ])
                session.add(Event(
                    id=self.event_id,
                    community_id=self.community_id,
                    title="Admin writable event",
                    starts_at=now + timedelta(days=2),
                    category="community",
                    registration_mode="internal_free",
                    capacity=10,
                ))
                session.add(Event(
                    id=self.foreign_event_id,
                    community_id=self.foreign_community_id,
                    title="Foreign Admin writable event",
                    starts_at=now + timedelta(days=2),
                    category="community",
                    registration_mode="internal_free",
                    capacity=10,
                ))
                await session.flush()
                session.add_all([
                    EventParticipationOption(
                        id=self.option_ids[0],
                        event_id=self.event_id,
                        title="Participation option one",
                        option_type="participation",
                    ),
                    EventParticipationOption(
                        id=self.option_ids[1],
                        event_id=self.event_id,
                        title="Participation option two",
                        option_type="participation",
                    ),
                ])
                session.add(EventRegistration(
                    event_id=self.event_id,
                    user_id=self.duplicate_id,
                    status="pending",
                    source_channel="mobile",
                ))

        self.admin_headers = {"Authorization": f"Bearer {create_access_token(self.admin_id)}"}
        self.role_headers = {
            "event_manager": {"Authorization": f"Bearer {create_access_token(self.event_manager_id)}"},
            "rabbi": {"Authorization": f"Bearer {create_access_token(self.rabbi_id)}"},
            "member": {"Authorization": f"Bearer {create_access_token(self.member_id)}"},
            "inactive": {"Authorization": f"Bearer {create_access_token(self.inactive_admin_id)}"},
            "foreign": {"Authorization": f"Bearer {create_access_token(self.foreign_admin_id)}"},
        }

    async def asyncTearDown(self) -> None:
        try:
            async with AsyncSessionLocal() as session:
                async with session.begin():
                    await session.execute(delete(Community).where(Community.id.in_([self.community_id, self.foreign_community_id])))
                    await session.execute(delete(AppUser).where(AppUser.id.in_([self.admin_id, self.event_manager_id, self.rabbi_id, self.member_id, self.inactive_admin_id, self.foreign_admin_id, self.existing_id, self.duplicate_id, self.out_of_scope_id, *self.unavailable_ids, *self.created_user_ids])))
        finally:
            await engine.dispose()

    def _phone(self, offset: int) -> str:
        return f"+7999{(self.marker + offset) % 10_000_000:07d}"

    def _existing_payload(self, user_id: UUID) -> dict[str, object]:
        return {"participant": {"mode": "existing", "user_id": str(user_id)}, "occurrence_id": None, "option_selections": [], "seats_count": 1, "guest_names": [], "comment": None}

    def _new_payload(self, offset: int, *, email: str | None = None, **extra: object) -> dict[str, object]:
        participant: dict[str, object] = {"mode": "new", "full_name": "  New   Admin Participant  ", "phone": self._phone(offset), "email": email}
        participant.update(extra)
        return {"participant": participant, "occurrence_id": None, "option_selections": [], "seats_count": 1, "guest_names": [], "comment": None}

    async def _post(
        self,
        payload: dict[str, object],
        headers: dict[str, str] | None = None,
        *,
        event_id: UUID | None = None,
    ) -> httpx.Response:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            return await client.post(
                f"/admin/events/{event_id or self.event_id}/registrations",
                headers=headers,
                json=payload,
            )

    async def _search_participants(
        self,
        search: str,
        headers: dict[str, str] | None = None,
        *,
        event_id: UUID | None = None,
    ) -> httpx.Response:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            return await client.get(
                f"/admin/events/{event_id or self.event_id}/registration-participants",
                headers=headers,
                params={"search": search},
            )

    async def _remember_created_user(self, response: httpx.Response) -> UUID:
        user_id = UUID(response.json()["data"]["user_id"])
        self.created_user_ids.append(user_id)
        return user_id

    async def test_only_active_admin_or_event_manager_are_authorized_and_contract_is_strict(self) -> None:
        for role, headers in self.role_headers.items():
            if role == "event_manager":
                continue
            with self.subTest(role=role):
                response = await self._post(self._existing_payload(self.existing_id), headers)
                self.assertEqual(response.status_code, 403)
        unauthenticated = await self._post(self._existing_payload(self.existing_id))
        self.assertEqual(unauthenticated.status_code, 401)

        manager_created = await self._post(
            self._existing_payload(self.member_id),
            self.role_headers["event_manager"],
        )
        self.assertEqual(manager_created.status_code, 200)
        manager_registration_id = UUID(manager_created.json()["data"]["id"])
        async with AsyncSessionLocal() as session:
            manager_registration = await session.get(EventRegistration, manager_registration_id)
        self.assertIsNotNone(manager_registration)
        assert manager_registration is not None
        self.assertEqual(manager_registration.source_channel, "admin")
        self.assertEqual(
            manager_registration.created_by_admin_user_id,
            self.event_manager_id,
        )

        cross_community = await self._post(
            self._existing_payload(self.out_of_scope_id),
            self.role_headers["event_manager"],
            event_id=self.foreign_event_id,
        )
        self.assertEqual(cross_community.status_code, 403)

        strict_payload = self._new_payload(1)
        strict_payload["source_channel"] = "mobile"
        strict = await self._post(strict_payload, self.admin_headers)
        self.assertEqual(strict.status_code, 422)

    async def test_existing_current_community_member_uses_canonical_writer_and_preserves_duplicate_provenance(self) -> None:
        created = await self._post(self._existing_payload(self.existing_id), self.admin_headers)
        self.assertEqual(created.status_code, 200)
        data = created.json()["data"]
        self.assertEqual(data["user_id"], str(self.existing_id))
        self.assertEqual(data["source_channel"], "admin")
        registration_id = UUID(data["id"])
        async with AsyncSessionLocal() as session:
            registration = await session.get(EventRegistration, registration_id)
        self.assertIsNotNone(registration)
        assert registration is not None
        self.assertEqual(registration.created_by_admin_user_id, self.admin_id)

        duplicate = await self._post(self._existing_payload(self.duplicate_id), self.admin_headers)
        self.assertEqual(duplicate.status_code, 200)
        self.assertEqual(duplicate.json()["data"]["source_channel"], "mobile")
        async with AsyncSessionLocal() as session:
            duplicate_registration = await session.scalar(select(EventRegistration).where(EventRegistration.event_id == self.event_id, EventRegistration.user_id == self.duplicate_id))
        self.assertIsNotNone(duplicate_registration)
        assert duplicate_registration is not None
        self.assertIsNone(duplicate_registration.created_by_admin_user_id)

    async def test_prior_community_registration_scopes_participant_without_membership(self) -> None:
        repeated = await self._post(self._existing_payload(self.duplicate_id), self.admin_headers)

        self.assertEqual(repeated.status_code, 200)
        self.assertEqual(repeated.json()["data"]["user_id"], str(self.duplicate_id))

    async def test_admin_created_participant_is_reselectable_only_in_same_community(self) -> None:
        created = await self._post(self._new_payload(9), self.admin_headers)
        self.assertEqual(created.status_code, 200)
        participant_id = await self._remember_created_user(created)

        repeated = await self._post(
            self._existing_payload(participant_id),
            self.admin_headers,
        )
        self.assertEqual(repeated.status_code, 200)
        self.assertEqual(repeated.json()["data"]["id"], created.json()["data"]["id"])

        foreign = await self._post(
            self._existing_payload(participant_id),
            self.role_headers["foreign"],
            event_id=self.foreign_event_id,
        )
        self.assertEqual(foreign.status_code, 404)
        self.assertNotIn(str(participant_id), str(foreign.json()))

    async def test_existing_participant_scope_and_availability_fail_closed(self) -> None:
        outside = await self._post(self._existing_payload(self.out_of_scope_id), self.admin_headers)
        self.assertEqual(outside.status_code, 404)
        self.assertNotIn(
            f"outside-{self.event_id.hex[:12]}@example.invalid",
            str(outside.json()),
        )
        for unavailable_id in self.unavailable_ids:
            with self.subTest(user_id=unavailable_id):
                response = await self._post(self._existing_payload(unavailable_id), self.admin_headers)
                self.assertEqual(response.status_code, 409)
                self.assertEqual(response.json()["error"]["code"], "admin_participant_unavailable")

    async def test_picker_returns_only_minimal_current_community_member_projection(self) -> None:
        response = await self._search_participants("Participant 0", self.admin_headers)

        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["id"], str(self.existing_id))
        self.assertEqual(data[0]["display_name"], "Participant 0")
        self.assertEqual(set(data[0]), {"id", "display_name", "phone", "email"})

    async def test_picker_uses_prior_registration_history_and_admin_created_history(self) -> None:
        prior = await self._search_participants("Participant 1", self.admin_headers)
        self.assertEqual(prior.status_code, 200)
        self.assertEqual([row["id"] for row in prior.json()["data"]], [str(self.duplicate_id)])

        created = await self._post(self._new_payload(13), self.admin_headers)
        self.assertEqual(created.status_code, 200)
        created_user_id = await self._remember_created_user(created)

        reselectable = await self._search_participants("New Admin Participant", self.admin_headers)
        self.assertEqual(reselectable.status_code, 200)
        self.assertIn(str(created_user_id), [row["id"] for row in reselectable.json()["data"]])

        foreign = await self._search_participants(
            "New Admin Participant",
            self.role_headers["foreign"],
            event_id=self.foreign_event_id,
        )
        self.assertEqual(foreign.status_code, 200)
        self.assertEqual(foreign.json()["data"], [])

    async def test_picker_does_not_cross_communities_or_include_users_without_evidence(self) -> None:
        foreign = await self._search_participants(
            "Participant 0",
            self.role_headers["foreign"],
            event_id=self.foreign_event_id,
        )
        self.assertEqual(foreign.status_code, 200)
        self.assertEqual(foreign.json()["data"], [])

        no_evidence_id = uuid4()
        self.created_user_ids.append(no_evidence_id)
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(AppUser(
                    id=no_evidence_id,
                    account_origin="migration",
                    claim_state="legacy_external",
                    status="active",
                ))
                session.add(Profile(
                    user_id=no_evidence_id,
                    full_name="Standalone Picker Person",
                    display_name="Standalone Picker Person",
                ))

        no_evidence = await self._search_participants("Standalone Picker", self.admin_headers)
        self.assertEqual(no_evidence.status_code, 200)
        self.assertEqual(no_evidence.json()["data"], [])

    async def test_picker_excludes_unavailable_users_and_never_dumps_on_blank_search(self) -> None:
        for index, unavailable_id in enumerate(self.unavailable_ids, start=3):
            with self.subTest(unavailable_id=unavailable_id):
                response = await self._search_participants(f"Participant {index}", self.admin_headers)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["data"], [])

        blank = await self._search_participants("   ", self.admin_headers)
        self.assertEqual(blank.status_code, 200)
        self.assertEqual(blank.json()["data"], [])

    async def test_picker_allows_event_manager_but_rejects_other_roles(self) -> None:
        allowed = await self._search_participants(
            "Participant 0",
            self.role_headers["event_manager"],
        )
        self.assertEqual(allowed.status_code, 200)
        self.assertEqual([row["id"] for row in allowed.json()["data"]], [str(self.existing_id)])
        for role, headers in self.role_headers.items():
            if role == "event_manager":
                continue
            with self.subTest(role=role):
                response = await self._search_participants("Participant", headers)
                self.assertEqual(response.status_code, 403)
        unauthenticated = await self._search_participants("Participant")
        self.assertEqual(unauthenticated.status_code, 401)

        cross_community = await self._search_participants(
            "Participant",
            self.role_headers["event_manager"],
            event_id=self.foreign_event_id,
        )
        self.assertEqual(cross_community.status_code, 403)

    async def test_new_participants_are_unclaimed_without_membership_or_verification(self) -> None:
        no_email = await self._post(self._new_payload(2), self.admin_headers)
        self.assertEqual(no_email.status_code, 200)
        without_email_id = await self._remember_created_user(no_email)
        email = f"admin-new-{self.event_id.hex[:12]}@example.invalid"
        with_email = await self._post(self._new_payload(3, email=email), self.admin_headers)
        self.assertEqual(with_email.status_code, 200)
        with_email_id = await self._remember_created_user(with_email)

        async with AsyncSessionLocal() as session:
            users = list(await session.scalars(select(AppUser).where(AppUser.id.in_([without_email_id, with_email_id]))))
            profiles = list(await session.scalars(select(Profile).where(Profile.user_id.in_([without_email_id, with_email_id]))))
            membership_count = await session.scalar(select(func.count()).select_from(CommunityMembership).where(CommunityMembership.user_id.in_([without_email_id, with_email_id])))
        self.assertEqual(len(users), 2)
        self.assertEqual(len(profiles), 2)
        self.assertEqual(membership_count, 0)
        for user in users:
            self.assertEqual(user.account_origin, "admin")
            self.assertEqual(user.claim_state, "unclaimed")
            self.assertIsNone(user.password_hash)
            self.assertIsNone(user.email_verified_at)
            self.assertIsNone(user.phone_verified_at)
            self.assertIsNone(user.claimed_at)
        self.assertEqual({profile.full_name for profile in profiles}, {"New Admin Participant"})

    async def test_event_manager_creates_new_participants_with_or_without_email(self) -> None:
        without_email = await self._post(
            self._new_payload(21),
            self.role_headers["event_manager"],
        )
        self.assertEqual(without_email.status_code, 200)
        without_email_id = await self._remember_created_user(without_email)
        with_email_value = f"manager-new-{self.event_id.hex[:12]}@example.invalid"
        with_email = await self._post(
            self._new_payload(22, email=with_email_value),
            self.role_headers["event_manager"],
        )
        self.assertEqual(with_email.status_code, 200)
        with_email_id = await self._remember_created_user(with_email)

        async with AsyncSessionLocal() as session:
            users = list(
                await session.scalars(
                    select(AppUser).where(AppUser.id.in_([without_email_id, with_email_id])),
                ),
            )
            membership_count = await session.scalar(
                select(func.count())
                .select_from(CommunityMembership)
                .where(CommunityMembership.user_id.in_([without_email_id, with_email_id])),
            )
            registrations = list(
                await session.scalars(
                    select(EventRegistration).where(
                        EventRegistration.user_id.in_([without_email_id, with_email_id]),
                    ),
                ),
            )
        self.assertEqual(len(users), 2)
        self.assertEqual(membership_count, 0)
        self.assertEqual({user.account_origin for user in users}, {"admin"})
        self.assertEqual({user.claim_state for user in users}, {"unclaimed"})
        self.assertEqual({user.email_verified_at for user in users}, {None})
        self.assertEqual({registration.source_channel for registration in registrations}, {"admin"})
        self.assertEqual(
            {registration.created_by_admin_user_id for registration in registrations},
            {self.event_manager_id},
        )

    async def test_new_identity_conflicts_are_stable_and_do_not_expose_pii(self) -> None:
        phone = self._phone(4)
        email = f"identity-{self.event_id.hex[:12]}@example.invalid"
        phone_user_id = uuid4()
        email_user_id = uuid4()
        self.created_user_ids.extend([phone_user_id, email_user_id])
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add_all([
                    AppUser(id=phone_user_id, phone=phone, account_origin="migration", claim_state="legacy_external", status="active"),
                    AppUser(id=email_user_id, email=email, account_origin="migration", claim_state="legacy_external", status="active"),
                ])

        duplicate_phone = await self._post(self._new_payload(4), self.admin_headers)
        self.assertEqual(duplicate_phone.status_code, 409)
        self.assertEqual(duplicate_phone.json()["error"]["code"], "admin_participant_phone_exists")
        duplicate_email = await self._post(self._new_payload(5, email=email), self.admin_headers)
        self.assertEqual(duplicate_email.status_code, 409)
        self.assertEqual(duplicate_email.json()["error"]["code"], "admin_participant_email_exists")
        ambiguous = await self._post(self._new_payload(4, email=email), self.admin_headers)
        self.assertEqual(ambiguous.status_code, 409)
        self.assertEqual(ambiguous.json()["error"]["code"], "admin_participant_identity_conflict")
        self.assertNotIn(phone, str(ambiguous.json()))
        self.assertNotIn(email, str(ambiguous.json()))

    async def test_registration_failures_roll_back_new_identity_and_capacity_does_not_orphan(self) -> None:
        invalid = self._new_payload(6)
        invalid["occurrence_id"] = str(uuid4())
        invalid_response = await self._post(invalid, self.admin_headers)
        self.assertEqual(invalid_response.status_code, 404)
        async with AsyncSessionLocal() as session:
            invalid_user = await session.scalar(select(AppUser).where(AppUser.phone == self._phone(6)))
        self.assertIsNone(invalid_user)

        async with AsyncSessionLocal() as session:
            async with session.begin():
                event = await session.get(Event, self.event_id)
                assert event is not None
                event.capacity = 1
                duplicate = await session.scalar(select(EventRegistration).where(EventRegistration.event_id == self.event_id, EventRegistration.user_id == self.duplicate_id))
                assert duplicate is not None
                duplicate.status = "cancelled"
        full = await self._post(self._new_payload(7), self.admin_headers)
        self.assertEqual(full.status_code, 200)
        await self._remember_created_user(full)
        capacity = await self._post(self._new_payload(8), self.admin_headers)
        self.assertEqual(capacity.status_code, 409)
        self.assertEqual(capacity.json()["error"]["code"], "capacity_unavailable")
        async with AsyncSessionLocal() as session:
            capacity_user = await session.scalar(select(AppUser).where(AppUser.phone == self._phone(8)))
        self.assertIsNone(capacity_user)

    async def test_option_selections_are_forwarded_to_the_canonical_writer(self) -> None:
        payload = self._existing_payload(self.member_id)
        payload["seats_count"] = 2
        payload["option_selections"] = [
            {"option_id": str(option_id), "quantity": 1}
            for option_id in self.option_ids
        ]

        created = await self._post(payload, self.role_headers["event_manager"])
        self.assertEqual(created.status_code, 200)
        data = created.json()["data"]
        self.assertEqual(data["seats_count"], 2)
        self.assertEqual(
            {selection["option_id"] for selection in data["selected_options"]},
            {str(option_id) for option_id in self.option_ids},
        )
        async with AsyncSessionLocal() as session:
            selections = list(
                await session.scalars(
                    select(EventRegistrationOptionSelection).where(
                        EventRegistrationOptionSelection.registration_id
                        == UUID(data["id"]),
                    ),
                ),
            )
        self.assertEqual(len(selections), 2)
        self.assertEqual({selection.quantity for selection in selections}, {1})
        async with AsyncSessionLocal() as session:
            registration = await session.get(EventRegistration, UUID(data["id"]))
        self.assertIsNotNone(registration)
        assert registration is not None
        self.assertEqual(registration.created_by_admin_user_id, self.event_manager_id)

        invalid_quantity = self._existing_payload(self.member_id)
        invalid_quantity["option_selections"] = [
            {"option_id": str(self.option_ids[0]), "quantity": 2},
        ]
        invalid = await self._post(invalid_quantity, self.admin_headers)
        self.assertEqual(invalid.status_code, 422)
        self.assertEqual(invalid.json()["error"]["code"], "validation_error")


if __name__ == "__main__":
    unittest.main()
