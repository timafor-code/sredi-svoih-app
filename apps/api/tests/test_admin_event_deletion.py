from __future__ import annotations

from datetime import UTC, datetime, timedelta
import unittest
from unittest.mock import patch
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
    EventPublicSlug,
    EventRegistration,
)
from app.db.models.event_image import EventImage
from app.db.session import AsyncSessionLocal, engine
from app.main import app
from app.services import admin_event_images
from app.storage.event_images import (
    EventImageStorageOperationError,
    build_event_image_object_key,
)


class FakeEventImageStorage:
    def __init__(self) -> None:
        self.objects: set[str] = set()
        self.delete_history: list[str] = []
        self.fail_delete_keys: set[str] = set()

    async def delete_image(self, *, object_key: str) -> None:
        self.delete_history.append(object_key)
        if object_key in self.fail_delete_keys:
            raise EventImageStorageOperationError("synthetic delete failure")
        self.objects.discard(object_key)


class AdminEventDeletionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.community_id = uuid4()
        self.foreign_community_id = uuid4()
        self.admin_id = uuid4()
        self.manager_id = uuid4()
        self.member_id = uuid4()
        self.now = datetime.now(UTC).replace(microsecond=0)
        self.storage = FakeEventImageStorage()

        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add_all(
                    [
                        Community(
                            id=self.community_id,
                            name="Event deletion community",
                            city="Moscow",
                            slug=f"event-delete-{self.community_id.hex[:12]}",
                        ),
                        Community(
                            id=self.foreign_community_id,
                            name="Foreign event deletion community",
                            city="Moscow",
                            slug=f"event-delete-{self.foreign_community_id.hex[:12]}",
                        ),
                        *[
                            AppUser(
                                id=user_id,
                                account_origin="admin",
                                claim_state="claimed",
                                status="active",
                            )
                            for user_id in (
                                self.admin_id,
                                self.manager_id,
                                self.member_id,
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
                            user_id=self.manager_id,
                            role="event_manager",
                            status="active",
                        ),
                        CommunityMembership(
                            community_id=self.community_id,
                            user_id=self.member_id,
                            role="member",
                            status="active",
                        ),
                        EventCategory(
                            community_id=self.community_id,
                            slug="community",
                            title="Community",
                            color="#123456",
                            icon="*",
                        ),
                        EventCategory(
                            community_id=self.foreign_community_id,
                            slug="community",
                            title="Community",
                            color="#654321",
                            icon="*",
                        ),
                    ],
                )

        self.admin_headers = self._headers(self.admin_id)
        self.manager_headers = self._headers(self.manager_id)
        self.member_headers = self._headers(self.member_id)

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
                                [self.admin_id, self.manager_id, self.member_id],
                            ),
                        ),
                    )
        finally:
            await engine.dispose()

    @staticmethod
    def _headers(user_id: UUID) -> dict[str, str]:
        return {"Authorization": f"Bearer {create_access_token(user_id)}"}

    async def _create_event(
        self,
        *,
        community_id: UUID | None = None,
        image_url: str | None = None,
        title: str = "Deletable event",
    ) -> UUID:
        event_id = uuid4()
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    Event(
                        id=event_id,
                        community_id=community_id or self.community_id,
                        title=title,
                        starts_at=self.now + timedelta(days=3),
                        category="community",
                        image_url=image_url,
                    ),
                )
        return event_id

    async def _delete_event(
        self,
        event_id: UUID,
        *,
        headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        with patch.object(
            admin_event_images,
            "get_event_image_storage",
            return_value=self.storage,
        ):
            transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
            async with httpx.AsyncClient(
                transport=transport,
                base_url="http://testserver",
            ) as client:
                return await client.delete(
                    f"/admin/events/{event_id}",
                    headers=headers or self.admin_headers,
                )

    async def _count(self, model: type, *conditions: object) -> int:
        async with AsyncSessionLocal() as session:
            value = await session.scalar(
                select(func.count()).select_from(model).where(*conditions),
            )
        return int(value or 0)

    async def _add_owned_data(
        self,
        event_id: UUID,
        *,
        with_registration: bool,
    ) -> tuple[UUID, UUID, UUID, UUID, UUID | None]:
        occurrence_id = uuid4()
        option_id = uuid4()
        capacity_unit_id = uuid4()
        slug_id = uuid4()
        registration_id = uuid4() if with_registration else None
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add_all(
                    [
                        EventOccurrence(
                            id=occurrence_id,
                            event_id=event_id,
                            starts_at=self.now + timedelta(days=3),
                            timezone="Europe/Moscow",
                            status="active",
                        ),
                        EventParticipationOption(
                            id=option_id,
                            event_id=event_id,
                            title="General admission",
                        ),
                        EventCapacityUnit(
                            id=capacity_unit_id,
                            event_id=event_id,
                            key="people",
                            title="People",
                        ),
                        EventPublicSlug(
                            id=slug_id,
                            event_id=event_id,
                            slug=f"delete-{event_id.hex}",
                            is_canonical=True,
                        ),
                    ],
                )
                if registration_id is not None:
                    session.add(
                        EventRegistration(
                            id=registration_id,
                            event_id=event_id,
                            user_id=self.member_id,
                            occurrence_id=occurrence_id,
                            status="confirmed",
                            source_channel="admin",
                        ),
                    )
        return (
            occurrence_id,
            option_id,
            capacity_unit_id,
            slug_id,
            registration_id,
        )

    async def _add_managed_image(self, event_id: UUID) -> tuple[UUID, str, str]:
        image_id = uuid4()
        version_token = uuid4()
        object_key = build_event_image_object_key(
            community_id=self.community_id,
            event_id=event_id,
        )
        image_url = f"https://media.example.invalid/{object_key}?v={version_token}"
        async with AsyncSessionLocal() as session:
            async with session.begin():
                event = await session.get(Event, event_id)
                assert event is not None
                event.image_url = image_url
                session.add(
                    EventImage(
                        id=image_id,
                        event_id=event_id,
                        community_id=self.community_id,
                        object_key=object_key,
                        size_bytes=128,
                        width=16,
                        height=8,
                        content_sha256="a" * 64,
                        version_token=version_token,
                        status="active",
                        activated_at=self.now,
                        created_by=self.admin_id,
                    ),
                )
        self.storage.objects.add(object_key)
        return image_id, object_key, image_url

    async def test_admin_can_delete_event_without_registrations(self) -> None:
        event_id = await self._create_event(title="Admin deletion")

        response = await self._delete_event(event_id)

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["data"]["id"], str(event_id))
        self.assertEqual(response.json()["data"]["title"], "Admin deletion")
        self.assertEqual(await self._count(Event, Event.id == event_id), 0)

    async def test_event_manager_can_delete_manageable_event(self) -> None:
        event_id = await self._create_event()

        response = await self._delete_event(
            event_id,
            headers=self.manager_headers,
        )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(await self._count(Event, Event.id == event_id), 0)

    async def test_member_cannot_delete_event(self) -> None:
        event_id = await self._create_event()

        response = await self._delete_event(event_id, headers=self.member_headers)

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"]["code"], "forbidden")
        self.assertEqual(await self._count(Event, Event.id == event_id), 1)

    async def test_foreign_and_unknown_events_are_safe_not_found(self) -> None:
        foreign_event_id = await self._create_event(
            community_id=self.foreign_community_id,
        )

        for event_id in (foreign_event_id, uuid4()):
            with self.subTest(event_id=event_id):
                response = await self._delete_event(event_id)
                self.assertEqual(response.status_code, 404)
                self.assertEqual(response.json()["error"]["code"], "not_found")
        self.assertEqual(await self._count(Event, Event.id == foreign_event_id), 1)

    async def test_registration_conflict_preserves_event_and_owned_data(self) -> None:
        event_id = await self._create_event()
        occurrence_id, option_id, capacity_unit_id, slug_id, registration_id = (
            await self._add_owned_data(event_id, with_registration=True)
        )
        image_id, object_key, image_url = await self._add_managed_image(event_id)
        assert registration_id is not None

        response = await self._delete_event(event_id)

        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(
            response.json()["error"]["code"],
            "event_has_registrations",
        )
        checks = (
            (Event, Event.id == event_id),
            (EventRegistration, EventRegistration.id == registration_id),
            (EventOccurrence, EventOccurrence.id == occurrence_id),
            (EventParticipationOption, EventParticipationOption.id == option_id),
            (EventCapacityUnit, EventCapacityUnit.id == capacity_unit_id),
            (EventPublicSlug, EventPublicSlug.id == slug_id),
            (EventImage, EventImage.id == image_id),
        )
        for model, condition in checks:
            self.assertEqual(await self._count(model, condition), 1)
        self.assertEqual(self.storage.delete_history, [])
        self.assertIn(object_key, self.storage.objects)
        async with AsyncSessionLocal() as session:
            stored_url = await session.scalar(
                select(Event.image_url).where(Event.id == event_id),
            )
        self.assertEqual(stored_url, image_url)

    async def test_successful_delete_uses_database_owned_cascades(self) -> None:
        event_id = await self._create_event()
        occurrence_id, option_id, capacity_unit_id, slug_id, _ = (
            await self._add_owned_data(event_id, with_registration=False)
        )

        response = await self._delete_event(event_id)

        self.assertEqual(response.status_code, 200, response.text)
        checks = (
            (Event, Event.id == event_id),
            (EventOccurrence, EventOccurrence.id == occurrence_id),
            (EventParticipationOption, EventParticipationOption.id == option_id),
            (EventCapacityUnit, EventCapacityUnit.id == capacity_unit_id),
            (EventPublicSlug, EventPublicSlug.id == slug_id),
        )
        for model, condition in checks:
            self.assertEqual(await self._count(model, condition), 0)

    async def test_managed_image_object_is_removed_with_event(self) -> None:
        event_id = await self._create_event()
        image_id, object_key, image_url = await self._add_managed_image(event_id)

        response = await self._delete_event(event_id)

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["data"]["image_url"], image_url)
        self.assertEqual(self.storage.delete_history, [object_key])
        self.assertNotIn(object_key, self.storage.objects)
        self.assertEqual(await self._count(Event, Event.id == event_id), 0)
        self.assertEqual(await self._count(EventImage, EventImage.id == image_id), 0)

    async def test_managed_image_failure_preserves_retryable_event(self) -> None:
        event_id = await self._create_event()
        image_id, object_key, image_url = await self._add_managed_image(event_id)
        self.storage.fail_delete_keys.add(object_key)

        failed = await self._delete_event(event_id)

        self.assertEqual(failed.status_code, 503, failed.text)
        self.assertEqual(
            failed.json()["error"]["code"],
            "event_image_storage_unavailable",
        )
        async with AsyncSessionLocal() as session:
            event = await session.get(Event, event_id)
            image = await session.get(EventImage, image_id)
        self.assertIsNotNone(event)
        self.assertIsNotNone(image)
        assert event is not None and image is not None
        self.assertEqual(event.image_url, image_url)
        self.assertEqual(image.status, "active")
        self.assertIn(object_key, self.storage.objects)

        self.storage.fail_delete_keys.clear()
        retried = await self._delete_event(event_id)
        self.assertEqual(retried.status_code, 200, retried.text)
        self.assertEqual(await self._count(Event, Event.id == event_id), 0)
        self.assertNotIn(object_key, self.storage.objects)

    async def test_legacy_image_does_not_attempt_object_deletion(self) -> None:
        event_id = await self._create_event(
            image_url="https://legacy.example.invalid/event.jpg",
        )

        with patch.object(
            admin_event_images,
            "get_event_image_storage",
            side_effect=AssertionError("external URL must bypass managed storage"),
        ):
            transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
            async with httpx.AsyncClient(
                transport=transport,
                base_url="http://testserver",
            ) as client:
                response = await client.delete(
                    f"/admin/events/{event_id}",
                    headers=self.admin_headers,
                )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(await self._count(Event, Event.id == event_id), 0)
        self.assertEqual(self.storage.delete_history, [])


if __name__ == "__main__":
    unittest.main()
