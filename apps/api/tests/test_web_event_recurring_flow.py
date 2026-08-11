from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import httpx
from sqlalchemy import delete

from app.db.models.core import (
    Community,
    Event,
    EventCategory,
    EventOccurrence,
    EventPublicSlug,
    LegalDocument,
)
from app.db.session import AsyncSessionLocal, engine
from app.main import app
from app.services import events


def _occurrence(
    *,
    starts_at: datetime,
    ends_at: datetime | None,
    registration_opens_at: datetime | None = None,
    registration_closes_at: datetime | None = None,
) -> EventOccurrence:
    return EventOccurrence(
        id=uuid4(),
        event_id=uuid4(),
        starts_at=starts_at,
        ends_at=ends_at,
        registration_opens_at=registration_opens_at,
        registration_closes_at=registration_closes_at,
        status="active",
    )


class NearestPublicOccurrenceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.now = datetime(2026, 8, 14, 12, tzinfo=UTC)

    def test_selects_upcoming_shabbat_before_registration_opens(self) -> None:
        upcoming = _occurrence(
            starts_at=self.now + timedelta(days=1),
            ends_at=self.now + timedelta(days=1, hours=3),
            registration_opens_at=self.now + timedelta(hours=6),
        )
        self.assertIs(
            events.select_nearest_public_occurrence([upcoming], self.now),
            upcoming,
        )

    def test_selects_shabbat_inside_registration_window(self) -> None:
        current = _occurrence(
            starts_at=self.now + timedelta(hours=2),
            ends_at=self.now + timedelta(hours=5),
            registration_opens_at=self.now - timedelta(hours=2),
            registration_closes_at=self.now + timedelta(hours=1),
        )
        self.assertIs(
            events.select_nearest_public_occurrence([current], self.now),
            current,
        )

    def test_keeps_closed_window_until_occurrence_finishes(self) -> None:
        current = _occurrence(
            starts_at=self.now - timedelta(hours=1),
            ends_at=self.now + timedelta(hours=2),
            registration_opens_at=self.now - timedelta(days=1),
            registration_closes_at=self.now - timedelta(minutes=30),
        )
        future = _occurrence(
            starts_at=self.now + timedelta(days=7),
            ends_at=self.now + timedelta(days=7, hours=3),
        )
        self.assertIs(
            events.select_nearest_public_occurrence([future, current], self.now),
            current,
        )

    def test_transitions_to_next_occurrence_at_current_end(self) -> None:
        finished = _occurrence(
            starts_at=self.now - timedelta(hours=3),
            ends_at=self.now,
        )
        future = _occurrence(
            starts_at=self.now + timedelta(days=7),
            ends_at=self.now + timedelta(days=7, hours=3),
        )
        self.assertIs(
            events.select_nearest_public_occurrence([finished, future], self.now),
            future,
        )

    def test_selects_one_suitable_occurrence(self) -> None:
        only = _occurrence(
            starts_at=self.now + timedelta(hours=1),
            ends_at=None,
        )
        self.assertIs(
            events.select_nearest_public_occurrence([only], self.now),
            only,
        )

    def test_returns_none_without_a_suitable_occurrence(self) -> None:
        finished = _occurrence(
            starts_at=self.now - timedelta(hours=3),
            ends_at=self.now - timedelta(hours=1),
        )
        self.assertIsNone(
            events.select_nearest_public_occurrence([finished], self.now),
        )


class WebEventRecurringFlowTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.marker = uuid4().hex[:12]
        self.community_id = uuid4()
        self.event_id = uuid4()
        self.foreign_event_id = uuid4()
        self.foreign_occurrence_id = uuid4()
        self.consent_id = uuid4()
        self.slug = f"recurring-{self.marker}"
        self.now = datetime.now(UTC).replace(microsecond=0)

        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    Community(
                        id=self.community_id,
                        name="Recurring flow test community",
                        city="Moscow",
                        slug=f"recurring-{self.marker}",
                    ),
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
                            id=self.event_id,
                            community_id=self.community_id,
                            event_kind="course",
                            title="Recurring flow fixture",
                            starts_at=self.now + timedelta(days=1),
                            category="community",
                            registration_mode="internal_free",
                            status="published",
                            visibility="public",
                            web_visibility="unlisted",
                        ),
                        Event(
                            id=self.foreign_event_id,
                            community_id=self.community_id,
                            event_kind="course",
                            title="Foreign recurring fixture",
                            starts_at=self.now + timedelta(days=2),
                            category="community",
                            registration_mode="internal_free",
                            status="published",
                            visibility="public",
                            web_visibility="unlisted",
                        ),
                    ],
                )
                await session.flush()
                session.add_all(
                    [
                        EventPublicSlug(
                            event_id=self.event_id,
                            slug=self.slug,
                            is_canonical=True,
                        ),
                        EventOccurrence(
                            id=self.foreign_occurrence_id,
                            event_id=self.foreign_event_id,
                            starts_at=self.now + timedelta(days=2),
                            ends_at=self.now + timedelta(days=2, hours=2),
                            status="active",
                        ),
                        LegalDocument(
                            id=self.consent_id,
                            document_type="event_registration_consent",
                            version=f"recurring-{self.marker}",
                            title="Synthetic consent",
                            content_hash=f"sha256:{self.marker}",
                            published_url="https://example.invalid/consent",
                            effective_at=self.now - timedelta(days=1),
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
                        delete(LegalDocument).where(LegalDocument.id == self.consent_id),
                    )
        finally:
            await engine.dispose()

    async def _request(self, path: str) -> httpx.Response:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
        ) as client:
            return await client.get(path)

    async def _replace_occurrences(
        self,
        *occurrences: EventOccurrence,
    ) -> None:
        async with AsyncSessionLocal() as session:
            async with session.begin():
                await session.execute(
                    delete(EventOccurrence).where(
                        EventOccurrence.event_id == self.event_id,
                    ),
                )
                for occurrence in occurrences:
                    occurrence.event_id = self.event_id
                    session.add(occurrence)

    async def _set_event_kind(self, event_kind: str) -> None:
        async with AsyncSessionLocal() as session:
            event = await session.get(Event, self.event_id)
            assert event is not None
            event.event_kind = event_kind
            await session.commit()

    async def _form(self, query: str = "") -> dict[str, object]:
        response = await self._request(
            f"/web/events/{self.slug}/registration-form{query}",
        )
        self.assertEqual(response.status_code, 200)
        return response.json()["data"]

    async def test_none_without_occurrences_and_never_exposes_foreign_event(self) -> None:
        data = await self._form()
        self.assertEqual(data["occurrence_selection_mode"], "none")
        self.assertIsNone(data["default_occurrence_id"])
        self.assertIsNone(data["next_registration_state_check_at"])
        self.assertEqual(data["occurrences"], [])
        self.assertNotIn(str(self.foreign_occurrence_id), str(data))

    async def test_none_with_one_occurrence_uses_automatic_default(self) -> None:
        only = _occurrence(
            starts_at=self.now + timedelta(days=1),
            ends_at=self.now + timedelta(days=1, hours=2),
        )
        await self._replace_occurrences(only)
        data = await self._form()
        self.assertEqual(data["occurrence_selection_mode"], "none")
        self.assertEqual(data["default_occurrence_id"], str(only.id))
        self.assertIsNone(data["next_registration_state_check_at"])

    async def test_multiple_normal_occurrences_require_user_selection(self) -> None:
        first_opening = self.now + timedelta(hours=1)
        first = _occurrence(
            starts_at=self.now + timedelta(days=1),
            ends_at=self.now + timedelta(days=1, hours=2),
            registration_opens_at=first_opening,
            registration_closes_at=self.now + timedelta(hours=4),
        )
        second = _occurrence(
            starts_at=self.now + timedelta(days=2),
            ends_at=self.now + timedelta(days=2, hours=2),
            registration_opens_at=self.now + timedelta(hours=2),
            registration_closes_at=self.now + timedelta(hours=5),
        )
        await self._replace_occurrences(second, first)
        data = await self._form()
        self.assertEqual(data["occurrence_selection_mode"], "user_select")
        self.assertIsNone(data["default_occurrence_id"])
        self.assertEqual(
            datetime.fromisoformat(str(data["next_registration_state_check_at"])),
            first_opening,
        )

    async def test_course_excludes_past_active_and_automatically_uses_future(self) -> None:
        past = _occurrence(
            starts_at=self.now - timedelta(hours=3),
            ends_at=self.now - timedelta(hours=1),
            registration_closes_at=self.now + timedelta(minutes=30),
        )
        future = _occurrence(
            starts_at=self.now + timedelta(days=1),
            ends_at=self.now + timedelta(days=1, hours=2),
        )
        await self._replace_occurrences(past, future)

        data = await self._form()

        self.assertEqual(data["occurrence_selection_mode"], "none")
        self.assertEqual(data["default_occurrence_id"], str(future.id))
        self.assertEqual(
            [item["id"] for item in data["occurrences"]],
            [str(future.id)],
        )
        self.assertIsNone(data["next_registration_state_check_at"])

    async def test_course_excludes_past_active_from_user_select_list(self) -> None:
        past = _occurrence(
            starts_at=self.now - timedelta(days=1),
            ends_at=self.now - timedelta(hours=20),
        )
        first_future = _occurrence(
            starts_at=self.now + timedelta(days=1),
            ends_at=self.now + timedelta(days=1, hours=2),
        )
        second_future = _occurrence(
            starts_at=self.now + timedelta(days=2),
            ends_at=self.now + timedelta(days=2, hours=2),
        )
        await self._replace_occurrences(second_future, past, first_future)

        data = await self._form()

        self.assertEqual(data["occurrence_selection_mode"], "user_select")
        self.assertIsNone(data["default_occurrence_id"])
        self.assertEqual(
            [item["id"] for item in data["occurrences"]],
            [str(first_future.id), str(second_future.id)],
        )

    async def test_only_past_active_occurrences_fail_closed(self) -> None:
        past = _occurrence(
            starts_at=self.now - timedelta(days=2),
            ends_at=self.now - timedelta(hours=46),
            registration_closes_at=self.now + timedelta(hours=1),
        )
        later_past = _occurrence(
            starts_at=self.now - timedelta(days=1),
            ends_at=self.now - timedelta(hours=20),
        )
        await self._replace_occurrences(past, later_past)

        data = await self._form()

        self.assertEqual(data["occurrence_selection_mode"], "none")
        self.assertIsNone(data["default_occurrence_id"])
        self.assertEqual(data["registration_state"], "unavailable")
        self.assertEqual(data["occurrences"], [])
        self.assertIsNone(data["next_registration_state_check_at"])

    async def test_closed_window_remains_visible_until_occurrence_finishes(self) -> None:
        current = _occurrence(
            starts_at=self.now - timedelta(hours=2),
            ends_at=self.now + timedelta(hours=1),
            registration_opens_at=self.now - timedelta(days=1),
            registration_closes_at=self.now - timedelta(minutes=30),
        )
        await self._replace_occurrences(current)

        data = await self._form()

        self.assertEqual(data["occurrence_selection_mode"], "none")
        self.assertEqual(data["default_occurrence_id"], str(current.id))
        self.assertEqual(data["registration_state"], "closed")
        self.assertEqual(
            [item["registration_state"] for item in data["occurrences"]],
            ["closed"],
        )

    async def test_shabbat_uses_nearest_and_query_cannot_override_it(self) -> None:
        await self._set_event_kind("shabbat")
        current = _occurrence(
            starts_at=self.now - timedelta(hours=1),
            ends_at=self.now + timedelta(hours=2),
            registration_opens_at=self.now - timedelta(days=1),
            registration_closes_at=self.now - timedelta(minutes=30),
        )
        future = _occurrence(
            starts_at=self.now + timedelta(days=7),
            ends_at=self.now + timedelta(days=7, hours=2),
        )
        await self._replace_occurrences(future, current)
        data = await self._form(f"?occurrence={future.id}")
        self.assertEqual(data["occurrence_selection_mode"], "nearest")
        self.assertEqual(data["default_occurrence_id"], str(current.id))
        self.assertEqual(data["registration_state"], "closed")
        self.assertEqual(
            datetime.fromisoformat(str(data["next_registration_state_check_at"])),
            current.ends_at,
        )

    async def test_registration_window_boundaries_are_server_authoritative(self) -> None:
        occurrence = _occurrence(
            starts_at=self.now + timedelta(hours=2),
            ends_at=self.now + timedelta(hours=4),
            registration_opens_at=self.now,
            registration_closes_at=self.now + timedelta(hours=1),
        )
        async with AsyncSessionLocal() as session:
            event = await session.get(Event, self.event_id)
            assert event is not None
            self.assertEqual(
                await events._public_occurrence_state(
                    session,
                    event,
                    occurrence,
                    self.now,
                ),
                "open",
            )
            occurrence.registration_closes_at = self.now
            self.assertEqual(
                await events._public_occurrence_state(
                    session,
                    event,
                    occurrence,
                    self.now,
                ),
                "closed",
            )

    async def test_shabbat_without_suitable_occurrence_fails_closed(self) -> None:
        await self._set_event_kind("shabbat")
        finished = _occurrence(
            starts_at=self.now - timedelta(hours=3),
            ends_at=self.now - timedelta(hours=1),
        )
        await self._replace_occurrences(finished)
        data = await self._form()
        self.assertEqual(data["occurrence_selection_mode"], "none")
        self.assertIsNone(data["default_occurrence_id"])
        self.assertEqual(data["registration_state"], "unavailable")
        self.assertIsNone(data["next_registration_state_check_at"])
        self.assertEqual(data["occurrences"], [])
        self.assertNotIn(str(finished.id), str(data))
        self.assertNotIn(str(self.foreign_occurrence_id), str(data))
