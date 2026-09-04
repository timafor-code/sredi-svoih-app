from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime, timedelta
import unittest
from uuid import UUID, uuid4

import httpx
import pytest
from pydantic import ValidationError
from sqlalchemy import delete, func, inspect, select

from app.core.tokens import create_access_token
from app.db.models.core import (
    AppUser, Community, CommunityMembership, Event, EventCategory,
    EventParticipationOption, EventPublicSlug, LegalDocument,
)
from app.db.session import AsyncSessionLocal, engine
from app.main import app
from app.schemas.events import EventSchedule


def schedule_document() -> dict:
    return {
        "version": 1,
        "days": [{
            "date": "2026-09-25",
            "label": "Канун Суккота и Шаббата",
            "note": "Теилим: 72–76",
            "items": [{"time": "18:00", "title": "Минха", "option_id": None}],
        }],
    }


def invalid_documents() -> list[tuple[str, dict]]:
    cases = []
    for target, changes in (
        ("schedule", {"version": [None, 2, "1", True, 1.0], "days": [None, {}], "extra": [1]}),
        ("day", {
            "date": ["25.09.2026", "2026/09/25", "2026-9-25", "2026-02-31",
                     "2026-02-29", "1900-02-29", "0000-01-01", "2026-09-25\n", 20260925],
            "label": ["x" * 201, 1], "note": ["x" * 201, False],
            "items": [None, {}], "extra": [1],
        }),
        ("item", {
            "time": ["6:30", "24:00", "12:90", "09:05\n", "09:05:00", 630],
            "title": ["x" * 201, None, 1], "option_id": ["invalid", 1], "extra": [1],
        }),
    ):
        for field, values in changes.items():
            for value in values:
                document = schedule_document()
                node = document if target == "schedule" else document["days"][0]
                if target == "item":
                    node = node["items"][0]
                node[field] = value
                cases.append((f"{target}.{field}={value!r}", document))
    for field in ("version", "days"):
        document = schedule_document()
        del document[field]
        cases.append((f"missing {field}", document))
    document = schedule_document()
    document["days"] *= 31
    cases.append(("31 days", document))
    document = schedule_document()
    document["days"][0]["items"] *= 61
    cases.append(("61 items", document))
    return cases


@pytest.mark.parametrize("name,document", invalid_documents())
def test_schedule_rejects_invalid_shape(name: str, document: dict) -> None:
    with pytest.raises(ValidationError):
        EventSchedule.model_validate(document)


@pytest.mark.parametrize("value", ["00:00", "09:05", "23:59"])
def test_schedule_accepts_time_boundaries(value: str) -> None:
    document = schedule_document()
    document["days"][0]["items"][0]["time"] = value
    assert EventSchedule.model_validate(document).model_dump(mode="json") == document


def test_schedule_limits_and_json_serialization() -> None:
    document = schedule_document()
    day = document["days"][0]
    day.update(date="2000-02-29", label="😀" * 200, note="x" * 200)
    day["items"][0].update(title="x" * 200, option_id=str(uuid4()))
    day["items"] *= 60
    document["days"] *= 30
    assert EventSchedule.model_validate(document).model_dump(mode="json") == document


def test_optional_text_and_option_serialize_as_null() -> None:
    document = {"version": 1, "days": [{
        "date": "2026-09-25", "items": [{"time": "09:05", "title": "  "}],
    }]}
    saved = EventSchedule.model_validate(document).model_dump(mode="json")
    assert saved["days"][0]["label"] is None
    assert saved["days"][0]["note"] is None
    assert saved["days"][0]["items"][0] == {
        "time": "09:05", "title": "  ", "option_id": None,
    }


class EventScheduleApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.community_id, self.actor_id, self.event_id = uuid4(), uuid4(), uuid4()
        self.foreign_event_id, self.option_id, self.foreign_option_id = uuid4(), uuid4(), uuid4()
        self.consent_id = uuid4()
        self.now = datetime.now(UTC).replace(microsecond=0)
        self.headers = {"Authorization": f"Bearer {create_access_token(self.actor_id)}"}
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add_all([
                    Community(id=self.community_id, name="Schedule test community", city="Moscow",
                              slug=f"schedule-{self.community_id.hex}"),
                    AppUser(id=self.actor_id, account_origin="admin", claim_state="claimed",
                            status="active"),
                ])
                await session.flush()
                session.add_all([
                    CommunityMembership(community_id=self.community_id, user_id=self.actor_id,
                                        role="admin", status="active"),
                    EventCategory(community_id=self.community_id, slug="community",
                                  title="Community", color="#123456", icon="*"),
                ])
                await session.flush()
                for event_id in (self.event_id, self.foreign_event_id):
                    session.add(Event(
                        id=event_id, community_id=self.community_id, title="Schedule fixture",
                        starts_at=self.now + timedelta(days=5), category="community",
                        registration_mode="internal_free", status="published",
                        visibility="public", web_visibility="unlisted",
                    ))
                await session.flush()
                session.add_all([
                    EventPublicSlug(event_id=self.event_id, slug=f"schedule-{self.event_id.hex}",
                                    is_canonical=True, created_by=self.actor_id),
                    EventParticipationOption(id=self.option_id, event_id=self.event_id,
                                             title="Inactive same-event option", is_active=False),
                    EventParticipationOption(id=self.foreign_option_id,
                                             event_id=self.foreign_event_id, title="Foreign option"),
                    LegalDocument(id=self.consent_id, document_type="event_registration_consent",
                                  version=f"schedule-{self.consent_id.hex}", title="Synthetic consent",
                                  content_hash=f"sha256:{self.consent_id.hex}",
                                  published_url="https://example.invalid/consent",
                                  effective_at=self.now - timedelta(hours=1)),
                ])

    async def asyncTearDown(self) -> None:
        try:
            async with AsyncSessionLocal() as session:
                async with session.begin():
                    await session.execute(delete(Community).where(Community.id == self.community_id))
                    await session.execute(delete(LegalDocument).where(LegalDocument.id == self.consent_id))
                    await session.execute(delete(AppUser).where(AppUser.id == self.actor_id))
        finally:
            await engine.dispose()

    async def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://testserver",
        ) as client:
            return await client.request(method, path, **kwargs)

    async def _create(self, **updates) -> httpx.Response:
        return await self._request("POST", "/admin/events", headers=self.headers, json={
            "title": "Created schedule event", "community_id": str(self.community_id),
            "starts_at": (self.now + timedelta(days=5)).isoformat(), **updates,
        })

    async def _patch(self, **updates) -> httpx.Response:
        return await self._request("PATCH", f"/admin/events/{self.event_id}",
                                   headers=self.headers, json=updates)

    async def _admin_get(self, event_id: UUID | None = None) -> dict:
        response = await self._request("GET", f"/admin/events/{event_id or self.event_id}",
                                       headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["data"]

    async def _public_get(self) -> dict:
        response = await self._request("GET", f"/events/{self.event_id}/registration-form?channel=web")
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["data"]

    async def _stored(self, event_id: UUID | None = None) -> dict | None:
        async with AsyncSessionLocal() as session:
            return await session.scalar(select(Event.schedule).where(Event.id == (event_id or self.event_id)))

    async def _assert_sql_null(self, event_id: UUID) -> None:
        async with AsyncSessionLocal() as session:
            self.assertTrue(await session.scalar(select(Event.schedule.is_(None)).where(Event.id == event_id)))

    async def test_migration_column_is_nullable_jsonb_without_default(self) -> None:
        async with engine.connect() as connection:
            columns = await connection.run_sync(lambda conn: inspect(conn).get_columns("events"))
        column = next(column for column in columns if column["name"] == "schedule")
        self.assertEqual(str(column["type"]), "JSONB")
        self.assertTrue(column["nullable"])
        self.assertIsNone(column["default"])
        await self._assert_sql_null(self.event_id)

    async def test_create_omitted_and_explicit_null_schedule(self) -> None:
        for payload in ({}, {"schedule": None}):
            with self.subTest(payload=payload):
                response = await self._create(**payload)
                self.assertEqual(response.status_code, 201, response.text)
                event = response.json()["data"]
                self.assertIsNone(event["schedule"])
                await self._assert_sql_null(UUID(event["id"]))

    async def test_create_schedule_persists_and_admin_get_round_trips(self) -> None:
        document = schedule_document()
        response = await self._create(schedule=document)
        self.assertEqual(response.status_code, 201, response.text)
        event_id = UUID(response.json()["data"]["id"])
        self.assertEqual(response.json()["data"]["schedule"], document)
        self.assertEqual(await self._stored(event_id), document)
        self.assertEqual((await self._admin_get(event_id))["schedule"], document)

    async def test_patch_replace_preserve_and_clear(self) -> None:
        document = schedule_document()
        response = await self._patch(schedule=document)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(await self._stored(), document)
        replacement = {"version": 1, "days": []}
        response = await self._patch(schedule=replacement)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(await self._stored(), replacement)
        response = await self._patch(title="Updated title")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual((await self._admin_get())["schedule"], replacement)
        response = await self._patch(schedule=None)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIsNone(response.json()["data"]["schedule"])
        await self._assert_sql_null(self.event_id)

    async def test_invalid_documents_rejected_whole_by_create_and_patch(self) -> None:
        original = schedule_document()
        self.assertEqual((await self._patch(schedule=original)).status_code, 200)
        for name, document in invalid_documents():
            with self.subTest(case=name):
                self.assertEqual((await self._create(schedule=document)).status_code, 422)
                response = await self._patch(schedule=document, title="Must not persist")
                self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(await self._stored(), original)
        self.assertEqual((await self._admin_get())["title"], "Schedule fixture")
        async with AsyncSessionLocal() as session:
            self.assertEqual(await session.scalar(select(func.count()).select_from(Event).where(
                Event.community_id == self.community_id,
            )), 2)

    async def test_same_event_inactive_and_repeated_option_accepted(self) -> None:
        document = schedule_document()
        document["days"][0]["items"][0]["option_id"] = str(self.option_id)
        document["days"][0]["items"] *= 2
        response = await self._patch(schedule=document)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(await self._stored(), document)

    async def test_missing_and_foreign_option_rejected_without_partial_update(self) -> None:
        original = schedule_document()
        self.assertEqual((await self._patch(schedule=original)).status_code, 200)
        for option_id in (uuid4(), self.foreign_option_id):
            document = deepcopy(original)
            document["days"][0]["items"][0]["option_id"] = str(self.option_id)
            document["days"][0]["items"].append({
                "time": "20:30", "title": "Meal", "option_id": str(option_id),
            })
            response = await self._patch(schedule=document, title="Must not persist")
            self.assertEqual(response.status_code, 422, response.text)
            self.assertEqual(response.json()["error"]["code"], "validation_error")
            self.assertEqual(await self._stored(), original)
        self.assertEqual((await self._admin_get())["title"], "Schedule fixture")

    async def test_create_with_linked_option_rolls_back_event(self) -> None:
        for option_id in (self.option_id, uuid4()):
            document = schedule_document()
            document["days"][0]["items"][0]["option_id"] = str(option_id)
            response = await self._create(schedule=document)
            self.assertEqual(response.status_code, 422, response.text)
        async with AsyncSessionLocal() as session:
            self.assertEqual(await session.scalar(select(func.count()).select_from(Event).where(
                Event.community_id == self.community_id,
            )), 2)

    async def test_dangling_link_admin_public_read_and_unrelated_patch(self) -> None:
        document = schedule_document()
        document["days"][0]["items"][0]["option_id"] = str(self.option_id)
        self.assertEqual((await self._patch(schedule=document)).status_code, 200)
        async with AsyncSessionLocal() as session:
            await session.execute(delete(EventParticipationOption).where(EventParticipationOption.id == self.option_id))
            await session.commit()
        self.assertEqual((await self._admin_get())["schedule"], document)
        self.assertEqual((await self._public_get())["event"]["schedule"], document)
        response = await self._patch(title="Changed with dangling link")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(await self._stored(), document)
        self.assertEqual((await self._patch(schedule=document)).status_code, 422)

    async def test_public_null_and_schedule_preserve_other_registration_fields(self) -> None:
        before = await self._public_get()
        self.assertIsNone(before["event"]["schedule"])
        document = schedule_document()
        self.assertEqual((await self._patch(schedule=document)).status_code, 200)
        after = await self._public_get()
        self.assertEqual(after["event"]["schedule"], document)
        after["event"]["schedule"] = None
        self.assertEqual(after, before)
        generic = await self._request("GET", f"/events/{self.event_id}")
        self.assertEqual(generic.status_code, 200, generic.text)
        self.assertNotIn("schedule", generic.json()["data"])
