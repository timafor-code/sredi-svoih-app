from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch
from uuid import UUID, uuid4

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import delete, select, text

from app.db.models.core import AppUser, Community, CommunityMembership, Event, EventCategory
from app.db.session import AsyncSessionLocal, engine
from app.schemas.admin_events import AdminEventCreateRequest, AdminEventUpdateRequest
from app.services import admin_events


class AdminEventKindConsistencyTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.community_id = uuid4()
        self.actor_id = uuid4()
        self.now = datetime.now(UTC).replace(microsecond=0)
        self.category_slugs = ("community", "children", "holiday", "lecture", "shabbat")

        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add_all(
                    [
                        Community(
                            id=self.community_id,
                            name="Jewish kind consistency test community",
                            city="Moscow",
                            slug=f"jewish-kind-{self.community_id.hex[:20]}",
                        ),
                        AppUser(
                            id=self.actor_id,
                            email=f"jewish-kind-{self.actor_id.hex[:12]}@example.invalid",
                            password_hash="synthetic-hash",
                            account_origin="password_signup",
                            claim_state="claimed",
                            status="active",
                        ),
                        CommunityMembership(
                            community_id=self.community_id,
                            user_id=self.actor_id,
                            role="admin",
                            status="active",
                        ),
                    ],
                )
                session.add_all(
                    EventCategory(
                        community_id=self.community_id,
                        slug=slug,
                        title=slug,
                        color="#123456",
                        icon="*",
                        created_by=self.actor_id,
                        updated_by=self.actor_id,
                    )
                    for slug in self.category_slugs
                )

    async def asyncTearDown(self) -> None:
        try:
            async with AsyncSessionLocal() as session:
                async with session.begin():
                    await session.execute(delete(Community).where(Community.id == self.community_id))
                    await session.execute(delete(AppUser).where(AppUser.id == self.actor_id))
        finally:
            await engine.dispose()

    async def _actor(self, session) -> AppUser:
        actor = await session.get(AppUser, self.actor_id)
        assert actor is not None
        return actor

    async def _create_event(self, *, category: str, event_kind: str = "single") -> Event:
        async with AsyncSessionLocal() as session:
            event = await admin_events.create_admin_event(
                session,
                await self._actor(session),
                AdminEventCreateRequest(
                    community_id=self.community_id,
                    title=f"{category} event {uuid4().hex}",
                    starts_at=self.now + timedelta(days=7),
                    category=category,
                    event_kind=event_kind,
                ),
            )
            return event

    async def test_create_canonicalizes_holiday_and_shabbat_categories(self) -> None:
        holiday = await self._create_event(category="holiday")
        shabbat = await self._create_event(category="shabbat")

        self.assertEqual(holiday.event_kind, "holiday")
        self.assertEqual(shabbat.event_kind, "shabbat")

    async def test_partial_update_uses_the_resulting_category_and_kind(self) -> None:
        event = await self._create_event(category="community")
        async with AsyncSessionLocal() as session:
            updated = await admin_events.update_admin_event(
                session,
                await self._actor(session),
                event.id,
                AdminEventUpdateRequest(category="holiday"),
            )

        self.assertEqual(updated.category, "holiday")
        self.assertEqual(updated.event_kind, "holiday")

    async def test_ordinary_category_resets_only_a_jewish_kind(self) -> None:
        event = await self._create_event(category="holiday")
        async with AsyncSessionLocal() as session:
            updated = await admin_events.update_admin_event(
                session,
                await self._actor(session),
                event.id,
                AdminEventUpdateRequest(category="community"),
            )

        self.assertEqual(updated.category, "community")
        self.assertEqual(updated.event_kind, "single")

    async def test_ordinary_categories_preserve_non_jewish_event_kinds(self) -> None:
        course = await self._create_event(category="community", event_kind="course")
        school = await self._create_event(category="children", event_kind="sunday_school")

        self.assertEqual(course.event_kind, "course")
        self.assertEqual(school.event_kind, "sunday_school")

    def test_migration_repairs_only_single_jewish_category_mismatches(self) -> None:
        script = ScriptDirectory.from_config(Config("alembic.ini"))
        revision = script.get_revision("20260908120000")
        self.assertIsNotNone(revision)
        assert revision is not None
        self.assertEqual(revision.down_revision, "20260907210000")

        migration_op = MagicMock()
        with patch.object(revision.module, "op", migration_op):
            revision.module.upgrade()
        statements = [str(call.args[0]) for call in migration_op.execute.call_args_list]
        self.assertEqual(len(statements), 2)
        self.assertIn("category = 'holiday' AND event_kind = 'single'", statements[0])
        self.assertIn("SET event_kind = 'holiday'", statements[0])
        self.assertIn("category = 'shabbat' AND event_kind = 'single'", statements[1])
        self.assertIn("SET event_kind = 'shabbat'", statements[1])

    async def test_migration_changes_exactly_the_two_unambiguous_fixture_rows(self) -> None:
        event_ids = {name: uuid4() for name in (
            "holiday_single",
            "shabbat_single",
            "holiday_course",
            "shabbat_school",
            "community_single",
        )}
        async with AsyncSessionLocal() as session:
            session.add_all(
                Event(
                    id=event_id,
                    community_id=self.community_id,
                    title=f"Migration {name}",
                    starts_at=self.now + timedelta(days=10),
                    category={
                        "holiday_single": "holiday",
                        "shabbat_single": "shabbat",
                        "holiday_course": "holiday",
                        "shabbat_school": "shabbat",
                        "community_single": "community",
                    }[name],
                    event_kind={
                        "holiday_single": "single",
                        "shabbat_single": "single",
                        "holiday_course": "course",
                        "shabbat_school": "sunday_school",
                        "community_single": "single",
                    }[name],
                )
                for name, event_id in event_ids.items()
            )
            await session.commit()

        revision = ScriptDirectory.from_config(Config("alembic.ini")).get_revision("20260908120000")
        assert revision is not None

        class BoundMigrationOp:
            def __init__(self, connection) -> None:
                self.connection = connection

            def execute(self, statement: str) -> None:
                self.connection.execute(text(statement))

        def run_upgrade(sync_connection) -> None:
            with patch.object(revision.module, "op", BoundMigrationOp(sync_connection)):
                revision.module.upgrade()

        async with engine.begin() as connection:
            await connection.run_sync(run_upgrade)

        async with AsyncSessionLocal() as session:
            stored = {
                event.id: event.event_kind
                for event in await session.scalars(
                    select(Event).where(Event.id.in_(tuple(event_ids.values()))),
                )
            }

        self.assertEqual(stored[event_ids["holiday_single"]], "holiday")
        self.assertEqual(stored[event_ids["shabbat_single"]], "shabbat")
        self.assertEqual(stored[event_ids["holiday_course"]], "course")
        self.assertEqual(stored[event_ids["shabbat_school"]], "sunday_school")
        self.assertEqual(stored[event_ids["community_single"]], "single")


if __name__ == "__main__":
    unittest.main()
