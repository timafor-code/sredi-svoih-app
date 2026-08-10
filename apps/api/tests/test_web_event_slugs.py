from __future__ import annotations

import asyncio
import unittest
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch
from uuid import UUID, uuid4

import httpx
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import delete, func, inspect, select
from sqlalchemy.exc import IntegrityError

from app.core.tokens import create_access_token
from app.db.models.audit import AdminEventAuditEntry
from app.db.models.core import (
    AppUser,
    Community,
    CommunityMembership,
    Event,
    EventCategory,
    EventOccurrence,
    EventPublicSlug,
    EventRegistration,
)
from app.db.models.imports import EventImportItem, EventImportRun, EventImportSource
from app.db.session import AsyncSessionLocal, engine
from app.main import app
from app.schemas.admin_events import (
    AdminEventCreateRequest,
    AdminEventWebRegistrationUpdateRequest,
)
from app.schemas.admin_import import AdminImportItemPublishRequest
from app.services import admin_events, admin_import
from app.services.event_public_slugs import (
    InvalidPublicSlugError,
    fallback_public_slug,
    iter_automatic_public_slug_candidates,
    normalize_public_slug,
    validate_public_slug,
)


class EventPublicSlugNormalizationTests(unittest.TestCase):
    def test_exact_russian_transliteration_examples(self) -> None:
        examples = {
            "Цикл лекций по истории": "tsikl-lektsiy-po-istorii",
            "Шабат": "shabbat",
            "Праздники Тишрея — 2026": "prazdniki-tishreya-2026",
            "Среди Своих": "sredi-svoikh",
        }
        for title, expected in examples.items():
            with self.subTest(title=title):
                self.assertEqual(normalize_public_slug(title), expected)

    def test_nfkc_and_separator_normalization(self) -> None:
        self.assertEqual(normalize_public_slug(" Ｃｙｃｌｅ　２０２６ "), "cycle-2026")
        self.assertEqual(
            normalize_public_slug("  Foo___---bar!!!baz  "),
            "foo-bar-baz",
        )

    def test_reserved_uuid_length_and_absolute_url_are_invalid(self) -> None:
        for value in (
            "new",
            "Admin",
            "api",
            "auth",
            "privacy",
            "support",
            "assets",
            "static",
            "null",
            "undefined",
            "123e4567-e89b-12d3-a456-426614174000",
            "a",
            "a" * 81,
            "https://example.invalid/events/example",
        ):
            with self.subTest(value=value):
                with self.assertRaises(InvalidPublicSlugError):
                    validate_public_slug(value)

    def test_fallback_collision_suffixes_and_max_length(self) -> None:
        event_id = UUID("12345678-1234-1234-1234-1234567890ab")
        self.assertEqual(fallback_public_slug(event_id), "event-12345678")
        self.assertEqual(
            next(iter_automatic_public_slug_candidates("!!!", event_id)),
            "event-12345678",
        )
        candidates = list(
            iter_automatic_public_slug_candidates(
                "x" * 100,
                event_id,
                max_attempts=3,
            ),
        )
        self.assertEqual(len(candidates), 3)
        self.assertEqual(len(candidates[0]), 80)
        self.assertEqual(candidates[1][-2:], "-2")
        self.assertEqual(candidates[2][-2:], "-3")
        self.assertTrue(all(len(value) <= 80 for value in candidates))

    def test_backfill_is_stable_and_resolves_base_collisions(self) -> None:
        revision = ScriptDirectory.from_config(Config("alembic.ini")).get_revision(
            "20260810120000",
        )
        first_id = UUID("00000000-0000-0000-0000-000000000001")
        second_id = UUID("00000000-0000-0000-0000-000000000002")
        third_id = UUID("00000000-0000-0000-0000-000000000003")
        now = datetime(2026, 8, 10, tzinfo=UTC)
        event_rows = [
            {
                "id": first_id,
                "title": "Одинаковое событие",
                "created_at": now,
                "created_by": None,
            },
            {
                "id": second_id,
                "title": "Одинаковое событие",
                "created_at": now,
                "created_by": None,
            },
            {
                "id": third_id,
                "title": "Одинаковое событие",
                "created_at": now,
                "created_by": None,
            },
        ]
        migration_op = MagicMock()
        bind = migration_op.get_bind.return_value
        bind.execute.return_value.mappings.return_value = event_rows
        with patch.object(revision.module, "op", migration_op):
            revision.module._backfill_event_public_slugs()

        statement = str(bind.execute.call_args.args[0])
        self.assertIn("ORDER BY created_at, id", statement)
        inserted_rows = migration_op.bulk_insert.call_args.args[1]
        self.assertEqual(
            [row["slug"] for row in inserted_rows],
            [
                "odinakovoe-sobytie",
                "odinakovoe-sobytie-2",
                "odinakovoe-sobytie-3",
            ],
        )


class EventPublicSlugIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.marker = uuid4().hex[:12]
        self.community_id = uuid4()
        self.foreign_community_id = uuid4()
        self.actor_id = uuid4()
        self.non_admin_id = uuid4()
        self.participant_id = uuid4()
        self.event_id = uuid4()
        self.occupied_event_id = uuid4()
        self.foreign_event_id = uuid4()
        self.occurrence_id = uuid4()
        self.registration_id = uuid4()
        self.now = datetime.now(UTC).replace(microsecond=0)
        self.actor_token = create_access_token(self.actor_id)
        self.non_admin_token = create_access_token(self.non_admin_id)
        self.current_slug = f"slug-fixture-{self.marker}"
        self.occupied_slug = f"occupied-{self.marker}"
        self.occupied_alias = f"occupied-alias-{self.marker}"

        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add_all(
                    [
                        Community(
                            id=self.community_id,
                            name="Slug test community",
                            city="Moscow",
                            slug=f"slug-community-{self.marker}",
                        ),
                        Community(
                            id=self.foreign_community_id,
                            name="Foreign slug test community",
                            city="Moscow",
                            slug=f"slug-foreign-{self.marker}",
                        ),
                        AppUser(
                            id=self.actor_id,
                            account_origin="password_signup",
                            claim_state="claimed",
                            status="active",
                        ),
                        AppUser(
                            id=self.non_admin_id,
                            account_origin="password_signup",
                            claim_state="claimed",
                            status="active",
                        ),
                        AppUser(
                            id=self.participant_id,
                            account_origin="password_signup",
                            claim_state="claimed",
                            status="active",
                        ),
                    ],
                )
                await session.flush()
                session.add_all(
                    [
                        CommunityMembership(
                            community_id=self.community_id,
                            user_id=self.actor_id,
                            role="admin",
                            status="active",
                        ),
                        CommunityMembership(
                            community_id=self.community_id,
                            user_id=self.non_admin_id,
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
                            color="#123456",
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
                            title="Slug fixture title",
                            starts_at=self.now + timedelta(days=5),
                            category="community",
                            registration_mode="internal_free",
                            status="published",
                            visibility="public",
                        ),
                        Event(
                            id=self.occupied_event_id,
                            community_id=self.community_id,
                            title="Occupied slug event",
                            starts_at=self.now + timedelta(days=6),
                            category="community",
                        ),
                        Event(
                            id=self.foreign_event_id,
                            community_id=self.foreign_community_id,
                            title="Foreign slug event",
                            starts_at=self.now + timedelta(days=7),
                            category="community",
                        ),
                    ],
                )
                await session.flush()
                session.add_all(
                    [
                        EventPublicSlug(
                            event_id=self.event_id,
                            slug=self.current_slug,
                            is_canonical=True,
                            created_by=self.actor_id,
                        ),
                        EventPublicSlug(
                            event_id=self.occupied_event_id,
                            slug=self.occupied_slug,
                            is_canonical=True,
                            created_by=self.actor_id,
                        ),
                        EventPublicSlug(
                            event_id=self.occupied_event_id,
                            slug=self.occupied_alias,
                            is_canonical=False,
                            created_by=self.actor_id,
                        ),
                        EventPublicSlug(
                            event_id=self.foreign_event_id,
                            slug=f"foreign-{self.marker}",
                            is_canonical=True,
                        ),
                        EventOccurrence(
                            id=self.occurrence_id,
                            event_id=self.event_id,
                            starts_at=self.now + timedelta(days=5),
                            status="active",
                        ),
                        EventRegistration(
                            id=self.registration_id,
                            event_id=self.event_id,
                            user_id=self.participant_id,
                            occurrence_id=self.occurrence_id,
                            status="confirmed",
                            source_channel="admin",
                        ),
                    ],
                )

    async def asyncTearDown(self) -> None:
        try:
            async with AsyncSessionLocal() as session:
                async with session.begin():
                    await session.execute(
                        delete(AdminEventAuditEntry).where(
                            AdminEventAuditEntry.actor_user_id == self.actor_id,
                        ),
                    )
                    await session.execute(
                        delete(Community).where(
                            Community.id.in_(
                                (self.community_id, self.foreign_community_id),
                            ),
                        ),
                    )
                    await session.execute(
                        delete(AppUser).where(
                            AppUser.id.in_(
                                (
                                    self.actor_id,
                                    self.non_admin_id,
                                    self.participant_id,
                                ),
                            ),
                        ),
                    )
        finally:
            await engine.dispose()

    async def _request(
        self,
        method: str,
        path: str,
        *,
        token: str | None = None,
        json: dict[str, object] | None = None,
    ) -> httpx.Response:
        headers = {"Authorization": f"Bearer {token}"} if token else None
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
        ) as client:
            return await client.request(method, path, headers=headers, json=json)

    async def test_schema_enforces_one_canonical_and_global_alias_uniqueness(self) -> None:
        async with engine.connect() as connection:
            schema = await connection.run_sync(
                lambda sync_connection: {
                    "columns": inspect(sync_connection).get_columns(
                        "event_public_slugs",
                    ),
                    "constraints": inspect(sync_connection).get_check_constraints(
                        "event_public_slugs",
                    ),
                    "indexes": inspect(sync_connection).get_indexes(
                        "event_public_slugs",
                    ),
                    "foreign_keys": inspect(sync_connection).get_foreign_keys(
                        "event_public_slugs",
                    ),
                },
            )
        self.assertEqual(
            {column["name"] for column in schema["columns"]},
            {"id", "event_id", "slug", "is_canonical", "created_at", "created_by"},
        )
        self.assertEqual(
            {constraint["name"] for constraint in schema["constraints"]},
            {
                "event_public_slugs_format_check",
                "event_public_slugs_not_uuid_check",
                "event_public_slugs_reserved_check",
            },
        )
        self.assertIn(
            "event_public_slugs_lower_slug_key",
            {index["name"] for index in schema["indexes"]},
        )
        self.assertIn(
            "event_public_slugs_one_canonical_per_event_idx",
            {index["name"] for index in schema["indexes"]},
        )
        self.assertEqual(schema["foreign_keys"][0]["options"].get("ondelete"), "CASCADE")

        async with AsyncSessionLocal() as session:
            with self.assertRaises(IntegrityError):
                async with session.begin_nested():
                    session.add(
                        EventPublicSlug(
                            event_id=self.event_id,
                            slug=f"second-canonical-{self.marker}",
                            is_canonical=True,
                        ),
                    )
                    await session.flush()
            with self.assertRaises(IntegrityError):
                async with session.begin_nested():
                    session.add(
                        EventPublicSlug(
                            event_id=self.event_id,
                            slug=self.occupied_alias,
                            is_canonical=False,
                        ),
                    )
                    await session.flush()

    async def test_admin_and_concurrent_creation_allocate_unique_slugs(self) -> None:
        async with AsyncSessionLocal() as session:
            actor = await session.get(AppUser, self.actor_id)
            assert actor is not None
            created = await admin_events.create_admin_event(
                session,
                actor,
                AdminEventCreateRequest(
                    community_id=self.community_id,
                    title=f"Автоматический цикл {self.marker}",
                    starts_at=self.now + timedelta(days=20),
                ),
            )
            slug = await session.scalar(
                select(EventPublicSlug.slug).where(
                    EventPublicSlug.event_id == created.id,
                    EventPublicSlug.is_canonical.is_(True),
                ),
            )
        self.assertEqual(slug, f"avtomaticheskiy-tsikl-{self.marker}")

        concurrent_title = f"Конкурентное событие {self.marker}"

        async def create_one(offset: int) -> UUID:
            async with AsyncSessionLocal() as session:
                actor = await session.get(AppUser, self.actor_id)
                assert actor is not None
                event = await admin_events.create_admin_event(
                    session,
                    actor,
                    AdminEventCreateRequest(
                        community_id=self.community_id,
                        title=concurrent_title,
                        starts_at=self.now + timedelta(days=30 + offset),
                    ),
                )
                return event.id

        event_ids = await asyncio.gather(create_one(0), create_one(1))
        async with AsyncSessionLocal() as session:
            slugs = set(
                await session.scalars(
                    select(EventPublicSlug.slug).where(
                        EventPublicSlug.event_id.in_(event_ids),
                        EventPublicSlug.is_canonical.is_(True),
                    ),
                ),
            )
        base = f"konkurentnoe-sobytie-{self.marker}"
        self.assertEqual(slugs, {base, f"{base}-2"})

    async def test_import_creation_uses_shared_automatic_slug_assignment(self) -> None:
        source_id = uuid4()
        run_id = uuid4()
        item_id = uuid4()
        title = f"Импортированное событие {self.marker}"
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    EventImportSource(
                        id=source_id,
                        community_id=self.community_id,
                        key=f"slug_import_{self.marker}",
                        title="Slug import source",
                        source_type="website_scrape",
                        source_url="https://sredisvoih.com/events",
                        settings={},
                        is_active=True,
                        created_by=self.actor_id,
                        updated_by=self.actor_id,
                    ),
                )
                await session.flush()
                session.add(
                    EventImportRun(
                        id=run_id,
                        source_id=source_id,
                        community_id=self.community_id,
                        mode="apply_review_only",
                        status="success",
                        found_count=1,
                        created_count=0,
                        updated_count=0,
                        summary={},
                        parser_metadata={},
                        debug_metadata={},
                        created_by=self.actor_id,
                    ),
                )
                await session.flush()
                session.add(
                    EventImportItem(
                        id=item_id,
                        run_id=run_id,
                        source_id=source_id,
                        external_id=f"slug-{self.marker}",
                        source_url=f"https://sredisvoih.com/events/{self.marker}",
                        raw_payload={
                            "parsed": {
                                "title": title,
                                "category": "community",
                                "registration_mode": "none",
                            },
                        },
                        parsed_title=title,
                        parsed_starts_at=self.now + timedelta(days=40),
                        status="new",
                    ),
                )

        async with AsyncSessionLocal() as session:
            actor = await session.get(AppUser, self.actor_id)
            assert actor is not None
            result = await admin_import.publish_admin_import_item(
                session,
                actor,
                item_id,
                AdminImportItemPublishRequest(),
            )
            slug = await session.scalar(
                select(EventPublicSlug.slug).where(
                    EventPublicSlug.event_id == result.event.id,
                    EventPublicSlug.is_canonical.is_(True),
                ),
            )
        self.assertTrue(result.created)
        self.assertEqual(slug, f"importirovannoe-sobytie-{self.marker}")

    async def test_availability_is_scoped_and_handles_current_canonical_and_aliases(
        self,
    ) -> None:
        path = f"/admin/events/{self.event_id}/web-registration/check-slug"
        self.assertEqual(
            (await self._request("POST", path, json={"public_slug": "free"})).status_code,
            401,
        )
        self.assertEqual(
            (
                await self._request(
                    "POST",
                    path,
                    token=self.non_admin_token,
                    json={"public_slug": "free"},
                )
            ).status_code,
            403,
        )
        foreign = await self._request(
            "POST",
            f"/admin/events/{self.foreign_event_id}/web-registration/check-slug",
            token=self.actor_token,
            json={"public_slug": "free"},
        )
        self.assertEqual(foreign.status_code, 404)

        cases = (
            ("Свободный адрес", "svobodnyy-adres", True, None),
            (self.current_slug, self.current_slug, True, None),
            (self.occupied_slug, self.occupied_slug, False, "public_slug_taken"),
            (self.occupied_alias, self.occupied_alias, False, "public_slug_taken"),
        )
        for value, normalized, available, reason in cases:
            with self.subTest(value=value):
                response = await self._request(
                    "POST",
                    path,
                    token=self.actor_token,
                    json={"public_slug": value},
                )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(
                    response.json()["data"],
                    {
                        "normalized_slug": normalized,
                        "available": available,
                        "reason": reason,
                    },
                )

    async def test_patch_changes_aliases_audits_and_preserves_event_state(self) -> None:
        path = f"/admin/events/{self.event_id}/web-registration"
        new_slug = f"novyy-adres-{self.marker}"
        changed = await self._request(
            "PATCH",
            path,
            token=self.actor_token,
            json={"public_slug": f"Новый адрес {self.marker}"},
        )
        self.assertEqual(changed.status_code, 200)
        data = changed.json()["data"]
        self.assertEqual(data["public_slug"], new_slug)
        self.assertEqual(data["web_visibility"], "disabled")
        self.assertEqual(
            data["public_registration_url"],
            f"http://localhost:5174/events/{self.event_id}",
        )

        async with AsyncSessionLocal() as session:
            rows = list(
                await session.scalars(
                    select(EventPublicSlug)
                    .where(EventPublicSlug.event_id == self.event_id)
                    .order_by(EventPublicSlug.slug),
                ),
            )
            audit_rows = list(
                await session.scalars(
                    select(AdminEventAuditEntry).where(
                        AdminEventAuditEntry.event_id == self.event_id,
                    ),
                ),
            )
            event = await session.get(Event, self.event_id)
            occurrence_count = await session.scalar(
                select(func.count())
                .select_from(EventOccurrence)
                .where(EventOccurrence.event_id == self.event_id),
            )
            registration_count = await session.scalar(
                select(func.count())
                .select_from(EventRegistration)
                .where(EventRegistration.event_id == self.event_id),
            )
        self.assertEqual(
            {row.slug: row.is_canonical for row in rows},
            {self.current_slug: False, new_slug: True},
        )
        self.assertEqual(len(audit_rows), 1)
        self.assertEqual(audit_rows[0].action, "event_public_slug_changed")
        self.assertEqual(audit_rows[0].old_state, self.current_slug)
        self.assertEqual(audit_rows[0].new_state, new_slug)
        self.assertNotIn("http", repr(audit_rows[0]).lower())
        assert event is not None
        self.assertEqual(event.title, "Slug fixture title")
        self.assertEqual(event.web_visibility, "disabled")
        self.assertEqual(occurrence_count, 1)
        self.assertEqual(registration_count, 1)

        no_op = await self._request(
            "PATCH",
            path,
            token=self.actor_token,
            json={"public_slug": new_slug.upper()},
        )
        self.assertEqual(no_op.status_code, 200)

        reverted = await self._request(
            "PATCH",
            path,
            token=self.actor_token,
            json={"public_slug": self.current_slug},
        )
        self.assertEqual(reverted.status_code, 200)
        self.assertEqual(reverted.json()["data"]["public_slug"], self.current_slug)
        availability = await self._request(
            "POST",
            f"{path}/check-slug",
            token=self.actor_token,
            json={"public_slug": new_slug},
        )
        self.assertEqual(availability.status_code, 200)
        self.assertTrue(availability.json()["data"]["available"])

        async with AsyncSessionLocal() as session:
            audit_count = await session.scalar(
                select(func.count())
                .select_from(AdminEventAuditEntry)
                .where(AdminEventAuditEntry.event_id == self.event_id),
            )
        self.assertEqual(audit_count, 2)

    async def test_patch_returns_typed_conflict_and_validation_errors(self) -> None:
        path = f"/admin/events/{self.event_id}/web-registration"
        for value in (self.occupied_slug, self.occupied_alias):
            response = await self._request(
                "PATCH",
                path,
                token=self.actor_token,
                json={"public_slug": value},
            )
            self.assertEqual(response.status_code, 409)
            self.assertEqual(response.json()["error"]["code"], "public_slug_taken")

        for value in (
            "admin",
            "123e4567-e89b-12d3-a456-426614174000",
            "https://example.invalid/events/slug",
            "a" * 81,
        ):
            response = await self._request(
                "PATCH",
                path,
                token=self.actor_token,
                json={"public_slug": value},
            )
            self.assertEqual(response.status_code, 422)
            self.assertEqual(response.json()["error"]["code"], "invalid_public_slug")

        empty = await self._request(
            "PATCH",
            path,
            token=self.actor_token,
            json={},
        )
        self.assertEqual(empty.status_code, 422)
        async with AsyncSessionLocal() as session:
            canonical = await session.scalar(
                select(EventPublicSlug.slug).where(
                    EventPublicSlug.event_id == self.event_id,
                    EventPublicSlug.is_canonical.is_(True),
                ),
            )
        self.assertEqual(canonical, self.current_slug)


if __name__ == "__main__":
    unittest.main()
