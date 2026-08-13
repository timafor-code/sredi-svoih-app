from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from io import BytesIO
import unittest
from unittest.mock import patch
from uuid import UUID, uuid4

from alembic.config import Config
from alembic.script import ScriptDirectory
import httpx
from PIL import Image
from sqlalchemy import delete, func, select

from app.core.tokens import create_access_token
from app.db.models.core import (
    AppUser,
    Community,
    CommunityMembership,
    Event,
    EventCategory,
)
from app.db.models.event_image import EventImage
from app.db.session import AsyncSessionLocal, engine
from app.main import app
from app.schemas.admin_events import AdminEventCreateRequest, AdminEventUpdateRequest
from app.services import admin_event_images
from app.storage.event_images import (
    EventImageStorageOperationError,
    EventImageStorageUnavailableError,
    StoredEventImage,
    build_event_image_object_key,
    build_event_image_public_url,
)


def _image_bytes(
    image_format: str,
    *,
    color: tuple[int, ...] = (20, 40, 60),
    size: tuple[int, int] = (32, 24),
) -> bytes:
    image = Image.new("RGB", size, color)
    output = BytesIO()
    image.save(output, format=image_format)
    return output.getvalue()


def _animated_webp_bytes() -> bytes:
    first = Image.new("RGB", (16, 16), (255, 0, 0))
    second = Image.new("RGB", (16, 16), (0, 0, 255))
    output = BytesIO()
    first.save(
        output,
        format="WEBP",
        save_all=True,
        append_images=[second],
        duration=100,
        loop=0,
    )
    return output.getvalue()


class FakeEventImageStorage:
    def __init__(self) -> None:
        self.public_base_url = "https://media.example.ru/event-images"
        self.objects: dict[str, bytes] = {}
        self.put_history: list[str] = []
        self.put_contents: list[bytes] = []
        self.delete_history: list[str] = []
        self.fail_put = False
        self.fail_delete_keys: set[str] = set()
        self.put_barrier_count = 0
        self._put_barrier = asyncio.Event()

    def public_url(self, *, object_key: str, version_token: UUID) -> str:
        return build_event_image_public_url(
            public_base_url=self.public_base_url,
            object_key=object_key,
            version_token=version_token,
        )

    async def put_normalized_image(
        self,
        *,
        object_key: str,
        content: bytes,
    ) -> StoredEventImage:
        if self.fail_put:
            raise EventImageStorageOperationError("synthetic write failure")
        self.objects[object_key] = content
        self.put_history.append(object_key)
        self.put_contents.append(content)
        if self.put_barrier_count > 0:
            self.put_barrier_count -= 1
            if self.put_barrier_count == 0:
                self._put_barrier.set()
            else:
                await self._put_barrier.wait()
        return StoredEventImage(etag="synthetic-etag")

    async def delete_image(self, *, object_key: str) -> None:
        self.delete_history.append(object_key)
        if object_key in self.fail_delete_keys:
            raise EventImageStorageOperationError("synthetic delete failure")
        self.objects.pop(object_key, None)


class AdminEventImageLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.community_id = uuid4()
        self.foreign_community_id = uuid4()
        self.event_id = uuid4()
        self.foreign_event_id = uuid4()
        self.admin_id = uuid4()
        self.event_manager_id = uuid4()
        self.member_id = uuid4()
        self.inactive_member_id = uuid4()
        self.foreign_manager_id = uuid4()
        self.now = datetime.now(UTC).replace(microsecond=0)
        self.storage = FakeEventImageStorage()

        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add_all(
                    [
                        Community(
                            id=self.community_id,
                            name="Event image community",
                            city="Moscow",
                            slug=f"event-image-{self.community_id.hex[:12]}",
                        ),
                        Community(
                            id=self.foreign_community_id,
                            name="Foreign event image community",
                            city="Moscow",
                            slug=f"event-image-{self.foreign_community_id.hex[:12]}",
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
                                self.event_manager_id,
                                self.member_id,
                                self.inactive_member_id,
                                self.foreign_manager_id,
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
                        CommunityMembership(
                            community_id=self.community_id,
                            user_id=self.inactive_member_id,
                            role="admin",
                            status="suspended",
                        ),
                        CommunityMembership(
                            community_id=self.foreign_community_id,
                            user_id=self.foreign_manager_id,
                            role="event_manager",
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
                await session.flush()
                session.add_all(
                    [
                        Event(
                            id=self.event_id,
                            community_id=self.community_id,
                            title="Event image fixture",
                            starts_at=self.now + timedelta(days=3),
                            category="community",
                        ),
                        Event(
                            id=self.foreign_event_id,
                            community_id=self.foreign_community_id,
                            title="Foreign event image fixture",
                            starts_at=self.now + timedelta(days=4),
                            category="community",
                        ),
                    ],
                )

        self.admin_headers = self._headers(self.admin_id)
        self.manager_headers = self._headers(self.event_manager_id)
        self.member_headers = self._headers(self.member_id)
        self.inactive_headers = self._headers(self.inactive_member_id)
        self.foreign_headers = self._headers(self.foreign_manager_id)

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
                                    self.inactive_member_id,
                                    self.foreign_manager_id,
                                ],
                            ),
                        ),
                    )
        finally:
            await engine.dispose()

    @staticmethod
    def _headers(user_id: UUID) -> dict[str, str]:
        return {"Authorization": f"Bearer {create_access_token(user_id)}"}

    async def _upload(
        self,
        content: bytes,
        content_type: str,
        *,
        headers: dict[str, str] | None = None,
        event_id: UUID | None = None,
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
                return await client.put(
                    f"/admin/events/{event_id or self.event_id}/image",
                    headers=headers if headers is not None else self.admin_headers,
                    files={"file": ("caller-name.bin", content, content_type)},
                )

    async def _remove(
        self,
        *,
        headers: dict[str, str] | None = None,
        event_id: UUID | None = None,
    ) -> httpx.Response:
        with patch.object(
            admin_event_images,
            "get_event_image_storage",
            return_value=self.storage,
        ):
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(
                transport=transport,
                base_url="http://testserver",
            ) as client:
                return await client.delete(
                    f"/admin/events/{event_id or self.event_id}/image",
                    headers=headers if headers is not None else self.admin_headers,
                )

    async def _event_image_rows(self) -> list[EventImage]:
        async with AsyncSessionLocal() as session:
            return list(
                await session.scalars(
                    select(EventImage)
                    .where(EventImage.event_id == self.event_id)
                    .order_by(EventImage.created_at, EventImage.id),
                ),
            )

    async def _event_image_url(self) -> str | None:
        async with AsyncSessionLocal() as session:
            return await session.scalar(
                select(Event.image_url).where(Event.id == self.event_id),
            )

    async def test_authorization_matrix_and_safe_not_found(self) -> None:
        source = _image_bytes("JPEG")
        admin = await self._upload(source, "image/jpeg")
        self.assertEqual(admin.status_code, 200)
        manager = await self._upload(
            source,
            "image/jpeg",
            headers=self.manager_headers,
        )
        self.assertEqual(manager.status_code, 200)
        member_remove = await self._remove(headers=self.member_headers)
        self.assertEqual(member_remove.status_code, 403)
        self.assertEqual(member_remove.json()["error"]["code"], "forbidden")

        for headers in (self.member_headers, self.inactive_headers):
            with self.subTest(headers=headers):
                rejected = await self._upload(source, "image/jpeg", headers=headers)
                self.assertEqual(rejected.status_code, 403)
                self.assertEqual(rejected.json()["error"]["code"], "forbidden")

        foreign = await self._upload(
            source,
            "image/jpeg",
            headers=self.foreign_headers,
        )
        self.assertEqual(foreign.status_code, 404)
        self.assertEqual(foreign.json()["error"]["code"], "not_found")

        unknown = await self._upload(source, "image/jpeg", event_id=uuid4())
        self.assertEqual(unknown.status_code, 404)
        self.assertEqual(unknown.json()["error"]["code"], "not_found")

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            unauthenticated = await client.put(
                f"/admin/events/{self.event_id}/image",
                files={"file": ("image.jpg", source, "image/jpeg")},
            )
        self.assertEqual(unauthenticated.status_code, 401)
        self.assertEqual(
            unauthenticated.json()["error"]["code"],
            "unauthenticated",
        )

    async def test_jpeg_png_and_webp_are_normalized_and_response_is_safe(self) -> None:
        for image_format, content_type, color in (
            ("JPEG", "image/jpeg", (10, 20, 30)),
            ("PNG", "image/png", (40, 50, 60)),
            ("WEBP", "image/webp", (70, 80, 90)),
        ):
            with self.subTest(image_format=image_format):
                response = await self._upload(
                    _image_bytes(image_format, color=color),
                    content_type,
                )
                self.assertEqual(response.status_code, 200)
                body = response.json()
                self.assertIsNone(body["error"])
                self.assertIn("request_id", body["meta"])
                self.assertTrue(body["data"]["image_url"].startswith("https://"))

        self.assertEqual(len(self.storage.put_history), 3)
        for content in self.storage.put_contents:
            with Image.open(BytesIO(content)) as normalized:
                self.assertEqual(normalized.format, "WEBP")

        data = response.json()["data"]
        self.assertTrue(
            {
                "object_key",
                "etag",
                "content_sha256",
                "version_token",
                "storage_endpoint",
                "credentials",
            }.isdisjoint(data),
        )

    async def test_multipart_shape_is_exact(self) -> None:
        with patch.object(
            admin_event_images,
            "get_event_image_storage",
            return_value=self.storage,
        ):
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(
                transport=transport,
                base_url="http://testserver",
            ) as client:
                responses = [
                    await client.put(
                        f"/admin/events/{self.event_id}/image",
                        headers=self.admin_headers,
                    ),
                    await client.put(
                        f"/admin/events/{self.event_id}/image",
                        headers=self.admin_headers,
                        data={"file": "not-an-upload"},
                    ),
                    await client.put(
                        f"/admin/events/{self.event_id}/image",
                        headers=self.admin_headers,
                        data={"extra": "not-allowed"},
                        files={
                            "file": (
                                "image.png",
                                _image_bytes("PNG"),
                                "image/png",
                            ),
                        },
                    ),
                    await client.put(
                        f"/admin/events/{self.event_id}/image",
                        headers=self.admin_headers,
                        files=[
                            (
                                "file",
                                ("image.png", _image_bytes("PNG"), "image/png"),
                            ),
                            (
                                "other",
                                ("extra.png", _image_bytes("PNG"), "image/png"),
                            ),
                        ],
                    ),
                    await client.put(
                        f"/admin/events/{self.event_id}/image",
                        headers=self.admin_headers,
                        json={"file": "not-multipart"},
                    ),
                ]
        for response in responses:
            self.assertEqual(response.status_code, 422)
            self.assertEqual(
                response.json()["error"]["code"],
                "invalid_event_image",
            )
        self.assertEqual(self.storage.put_history, [])

        with patch.object(
            admin_event_images,
            "get_event_image_storage",
            return_value=self.storage,
        ):
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(
                transport=transport,
                base_url="http://testserver",
            ) as client:
                removal_with_body = await client.request(
                    "DELETE",
                    f"/admin/events/{self.event_id}/image",
                    headers=self.admin_headers,
                    json={"unexpected": True},
                )
        self.assertEqual(removal_with_body.status_code, 422)
        self.assertEqual(
            removal_with_body.json()["error"]["code"],
            "invalid_event_image",
        )

    async def test_validation_errors_have_stable_status_and_codes(self) -> None:
        cases: list[tuple[bytes, str, int, str, dict[str, int]]] = [
            (
                b"123456789",
                "image/jpeg",
                413,
                "event_image_too_large",
                {"MAX_EVENT_IMAGE_SOURCE_BYTES": 8},
            ),
            (
                _image_bytes("PNG"),
                "image/png",
                413,
                "event_image_too_large",
                {"MAX_NORMALIZED_EVENT_IMAGE_BYTES": 1},
            ),
            (
                _image_bytes("PNG", size=(8, 8)),
                "image/png",
                413,
                "event_image_too_large",
                {"MAX_EVENT_IMAGE_PIXELS": 16},
            ),
            (
                _animated_webp_bytes(),
                "image/webp",
                415,
                "unsupported_event_image_type",
                {},
            ),
            (
                b"<svg xmlns='http://www.w3.org/2000/svg'></svg>",
                "image/svg+xml",
                415,
                "unsupported_event_image_type",
                {},
            ),
            (
                _image_bytes("PNG"),
                "image/jpeg",
                415,
                "unsupported_event_image_type",
                {},
            ),
        ]
        corrupt_jpeg = _image_bytes("JPEG", size=(128, 128))
        cases.append(
            (
                corrupt_jpeg[: len(corrupt_jpeg) // 2],
                "image/jpeg",
                422,
                "invalid_event_image",
                {},
            ),
        )

        for content, content_type, status_code, code, overrides in cases:
            with self.subTest(code=code, overrides=overrides):
                patchers = [
                    patch.object(admin_event_images, name, value)
                    for name, value in overrides.items()
                ]
                for patcher in patchers:
                    patcher.start()
                try:
                    response = await self._upload(content, content_type)
                finally:
                    for patcher in reversed(patchers):
                        patcher.stop()
                self.assertEqual(response.status_code, status_code)
                body = response.json()
                self.assertIsNone(body["data"])
                self.assertEqual(body["error"]["code"], code)
                self.assertIn("request_id", body["meta"])

    async def test_first_upload_same_content_replay_and_replacement(self) -> None:
        first_content = _image_bytes("PNG", color=(10, 20, 30))
        first = await self._upload(first_content, "image/png")
        self.assertEqual(first.status_code, 200)
        first_url = first.json()["data"]["image_url"]
        first_rows = await self._event_image_rows()
        self.assertEqual([row.status for row in first_rows], ["active"])

        replay = await self._upload(first_content, "image/png")
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.json()["data"]["image_url"], first_url)
        self.assertEqual(len(self.storage.put_history), 1)
        self.assertEqual(len(await self._event_image_rows()), 1)

        replacement = await self._upload(
            _image_bytes("PNG", color=(90, 80, 70)),
            "image/png",
        )
        self.assertEqual(replacement.status_code, 200)
        replacement_url = replacement.json()["data"]["image_url"]
        self.assertNotEqual(replacement_url, first_url)
        rows = await self._event_image_rows()
        self.assertEqual(sum(row.status == "active" for row in rows), 1)
        self.assertEqual(sum(row.status == "deleted" for row in rows), 1)
        active = next(row for row in rows if row.status == "active")
        self.assertIn(active.object_key, replacement_url)

    async def test_legacy_replacement_and_all_removal_modes(self) -> None:
        legacy_url = "https://legacy.example.invalid/event.jpg"
        async with AsyncSessionLocal() as session:
            async with session.begin():
                event = await session.get(Event, self.event_id)
                assert event is not None
                event.image_url = legacy_url

        replacement = await self._upload(_image_bytes("JPEG"), "image/jpeg")
        self.assertEqual(replacement.status_code, 200)
        self.assertNotEqual(replacement.json()["data"]["image_url"], legacy_url)
        self.assertEqual(self.storage.delete_history, [])

        managed_remove = await self._remove()
        self.assertEqual(managed_remove.status_code, 200)
        self.assertIsNone(managed_remove.json()["data"]["image_url"])
        rows = await self._event_image_rows()
        self.assertEqual(rows[0].status, "deleted")

        repeated = await self._remove()
        self.assertEqual(repeated.status_code, 200)
        self.assertIsNone(repeated.json()["data"]["image_url"])

        async with AsyncSessionLocal() as session:
            async with session.begin():
                event = await session.get(Event, self.event_id)
                assert event is not None
                event.image_url = legacy_url
        legacy_remove = await self._remove()
        self.assertEqual(legacy_remove.status_code, 200)
        self.assertIsNone(legacy_remove.json()["data"]["image_url"])

    async def test_storage_write_failure_preserves_current_image(self) -> None:
        initial = await self._upload(_image_bytes("JPEG"), "image/jpeg")
        initial_url = initial.json()["data"]["image_url"]
        self.storage.fail_put = True

        failed = await self._upload(
            _image_bytes("PNG", color=(100, 110, 120)),
            "image/png",
        )
        self.assertEqual(failed.status_code, 503)
        self.assertEqual(
            failed.json()["error"]["code"],
            "event_image_storage_unavailable",
        )
        self.assertEqual(await self._event_image_url(), initial_url)
        rows = await self._event_image_rows()
        self.assertEqual(sum(row.status == "active" for row in rows), 1)

    async def test_disabled_or_incomplete_storage_has_stable_error(self) -> None:
        with patch.object(
            self.storage,
            "public_url",
            side_effect=EventImageStorageUnavailableError(
                "synthetic disabled storage",
            ),
        ):
            failed = await self._upload(_image_bytes("JPEG"), "image/jpeg")
        self.assertEqual(failed.status_code, 503)
        self.assertEqual(
            failed.json()["error"]["code"],
            "event_image_storage_unavailable",
        )
        self.assertIsNone(await self._event_image_url())
        rows = await self._event_image_rows()
        self.assertEqual([row.status for row in rows], ["deleted"])

    async def test_activation_failure_preserves_current_and_cleans_new_object(self) -> None:
        initial = await self._upload(_image_bytes("JPEG"), "image/jpeg")
        initial_url = initial.json()["data"]["image_url"]

        with patch.object(
            admin_event_images,
            "_activate_uploaded_image",
            side_effect=RuntimeError("synthetic activation failure"),
        ):
            failed = await self._upload(
                _image_bytes("PNG", color=(120, 110, 100)),
                "image/png",
            )
        self.assertEqual(failed.status_code, 500)
        self.assertEqual(await self._event_image_url(), initial_url)
        rows = await self._event_image_rows()
        self.assertEqual(sum(row.status == "active" for row in rows), 1)
        self.assertEqual(sum(row.status == "deleted" for row in rows), 1)
        self.assertFalse(any(row.status == "pending" for row in rows))

    async def test_failed_old_delete_is_retried_by_later_mutation(self) -> None:
        first = await self._upload(_image_bytes("JPEG"), "image/jpeg")
        self.assertEqual(first.status_code, 200)
        first_row = (await self._event_image_rows())[0]
        self.storage.fail_delete_keys.add(first_row.object_key)

        replacement_content = _image_bytes("PNG", color=(200, 100, 50))
        replacement = await self._upload(replacement_content, "image/png")
        self.assertEqual(replacement.status_code, 200)
        rows = await self._event_image_rows()
        old_row = next(row for row in rows if row.id == first_row.id)
        self.assertEqual(old_row.status, "delete_pending")

        async with AsyncSessionLocal() as session:
            async with session.begin():
                stored_old = await session.get(EventImage, first_row.id)
                assert stored_old is not None
                stored_old.updated_at = self.now - timedelta(hours=2)
        self.storage.fail_delete_keys.clear()

        replay = await self._upload(replacement_content, "image/png")
        self.assertEqual(replay.status_code, 200)
        rows = await self._event_image_rows()
        old_row = next(row for row in rows if row.id == first_row.id)
        self.assertEqual(old_row.status, "deleted")

    async def test_stale_cleanup_is_bounded_and_never_makes_pending_visible(self) -> None:
        stale_ids: list[UUID] = []
        async with AsyncSessionLocal() as session:
            async with session.begin():
                for index in range(
                    admin_event_images.STALE_EVENT_IMAGE_CLEANUP_LIMIT + 1,
                ):
                    image_id = uuid4()
                    stale_ids.append(image_id)
                    object_key = build_event_image_object_key(
                        community_id=self.community_id,
                        event_id=self.event_id,
                    )
                    self.storage.objects[object_key] = b"synthetic"
                    session.add(
                        EventImage(
                            id=image_id,
                            event_id=self.event_id,
                            community_id=self.community_id,
                            object_key=object_key,
                            content_type="image/webp",
                            size_bytes=9,
                            width=1,
                            height=1,
                            content_sha256=f"{index:064x}",
                            version_token=uuid4(),
                            status="pending",
                            created_by=self.admin_id,
                            updated_at=self.now - timedelta(hours=2),
                        ),
                    )

        removed = await self._remove()
        self.assertEqual(removed.status_code, 200)
        self.assertIsNone(removed.json()["data"]["image_url"])
        rows = await self._event_image_rows()
        self.assertEqual(
            sum(row.status == "deleted" for row in rows),
            admin_event_images.STALE_EVENT_IMAGE_CLEANUP_LIMIT,
        )
        self.assertEqual(sum(row.status == "pending" for row in rows), 1)
        self.assertIsNone(await self._event_image_url())

    async def test_concurrent_replacements_leave_one_matching_active_row(self) -> None:
        self.storage.put_barrier_count = 2
        with patch.object(
            admin_event_images,
            "get_event_image_storage",
            return_value=self.storage,
        ):
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(
                transport=transport,
                base_url="http://testserver",
            ) as client:
                first, second = await asyncio.gather(
                    client.put(
                        f"/admin/events/{self.event_id}/image",
                        headers=self.admin_headers,
                        files={
                            "file": (
                                "first.png",
                                _image_bytes("PNG", color=(1, 2, 3)),
                                "image/png",
                            ),
                        },
                    ),
                    client.put(
                        f"/admin/events/{self.event_id}/image",
                        headers=self.manager_headers,
                        files={
                            "file": (
                                "second.png",
                                _image_bytes("PNG", color=(4, 5, 6)),
                                "image/png",
                            ),
                        },
                    ),
                )
        self.assertEqual([first.status_code, second.status_code], [200, 200])
        rows = await self._event_image_rows()
        active_rows = [row for row in rows if row.status == "active"]
        self.assertEqual(len(active_rows), 1)
        self.assertFalse(any(row.status == "pending" for row in rows))
        event_url = await self._event_image_url()
        self.assertIsNotNone(event_url)
        self.assertIn(active_rows[0].object_key, event_url or "")

    async def test_json_image_url_compatibility_and_single_alembic_head(self) -> None:
        legacy_url = "https://legacy.example.invalid/compatible.jpg"
        starts_at = (self.now + timedelta(days=10)).isoformat()
        create_model = AdminEventCreateRequest(
            community_id=self.community_id,
            title="Compatible model",
            starts_at=starts_at,
            image_url=legacy_url,
        )
        update_model = AdminEventUpdateRequest(image_url=legacy_url)
        self.assertEqual(create_model.image_url, legacy_url)
        self.assertEqual(update_model.image_url, legacy_url)

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            created = await client.post(
                "/admin/events",
                headers=self.admin_headers,
                json={
                    "community_id": str(self.community_id),
                    "title": "Compatible event create",
                    "starts_at": starts_at,
                    "image_url": legacy_url,
                },
            )
            updated = await client.patch(
                f"/admin/events/{self.event_id}",
                headers=self.admin_headers,
                json={"image_url": legacy_url},
            )
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.json()["data"]["image_url"], legacy_url)
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()["data"]["image_url"], legacy_url)

        script = ScriptDirectory.from_config(Config("alembic.ini"))
        self.assertEqual(script.get_heads(), ["20260813210000"])
        async with AsyncSessionLocal() as session:
            active_count = await session.scalar(
                select(func.count())
                .select_from(EventImage)
                .where(EventImage.event_id == self.event_id, EventImage.status == "active"),
            )
        self.assertEqual(active_count, 0)


if __name__ == "__main__":
    unittest.main()
