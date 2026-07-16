from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta
from unittest.mock import patch
from uuid import UUID, uuid4

from sqlalchemy import delete, select

from app.db.models.core import AppUser, Community, CommunityMembership, Event, EventCategory
from app.db.models.imports import EventImportItem, EventImportRun, EventImportSource
from app.db.session import AsyncSessionLocal, engine
from app.importer.dedupe import build_dedupe
from app.importer.parser import ParsedImportItem, ParsedImportItemResult, ParsedWebsiteResult
from app.importer.runner import execute_review_import
from app.schemas.admin_events import AdminEventUpdateRequest
from app.schemas.admin_import import AdminImportIgnoreRequest
from app.services import admin_import as admin_import_service
from app.services import admin_events as admin_events_service
from app.services.import_maintenance import ignore_exact_open_import_duplicates


class AdminImportTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.community_id = uuid4()
        self.actor_id = uuid4()
        self.source_id = uuid4()
        self.created_run_ids: list[UUID] = []
        self.now = datetime.now(UTC).replace(microsecond=0)

        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add_all(
                    [
                        Community(
                            id=self.community_id,
                            name="Admin import test community",
                            city="Moscow",
                            slug=f"import-{self.community_id.hex[:20]}",
                        ),
                        AppUser(
                            id=self.actor_id,
                            email=f"import-{self.actor_id.hex[:12]}@example.invalid",
                            password_hash="not-a-public-value",
                            status="active",
                        ),
                        CommunityMembership(
                            community_id=self.community_id,
                            user_id=self.actor_id,
                            role="admin",
                            status="active",
                        ),
                        EventCategory(
                            community_id=self.community_id,
                            slug="community",
                            title="Community",
                            color="#123456",
                            icon="*",
                            created_by=self.actor_id,
                            updated_by=self.actor_id,
                        ),
                        EventImportSource(
                            id=self.source_id,
                            community_id=self.community_id,
                            key=f"test_{self.source_id.hex[:12]}",
                            title="Import test source",
                            source_type="website_scrape",
                            source_url="https://sredisvoih.com/events",
                            settings={},
                            is_active=True,
                            created_by=self.actor_id,
                            updated_by=self.actor_id,
                        ),
                    ],
                )

    async def asyncTearDown(self) -> None:
        try:
            async with AsyncSessionLocal() as session:
                async with session.begin():
                    await session.execute(delete(Community).where(Community.id == self.community_id))
                    await session.execute(delete(AppUser).where(AppUser.id == self.actor_id))
        finally:
            await engine.dispose()

    def _parsed_item(
        self,
        *,
        external_id: str | None,
        source_url: str | None,
        title: str = "Imported event",
        starts_at: datetime | None = None,
    ) -> ParsedImportItemResult:
        event_starts_at = starts_at or self.now + timedelta(days=7)
        return ParsedImportItemResult(
            item=ParsedImportItem(
                external_id=external_id,
                source_url=source_url,
                title=title,
                image_url=None,
                description="Imported description",
                short_description="Imported short description",
                starts_at=event_starts_at,
                parsed_location="Moscow",
                location_name="Moscow",
                address=None,
                registration_mode="none",
                registration_url=None,
                category="community",
                audience=None,
                date_confidence="exact",
                import_review={
                    "dedupe": build_dedupe(
                        title=title,
                        starts_at=event_starts_at,
                        description="Imported description",
                        source_url=source_url,
                        external_id=external_id,
                    ),
                },
                raw_payload={},
            ),
        )

    async def _run_import(self, items: list[ParsedImportItemResult]) -> EventImportRun:
        run_id = uuid4()
        self.created_run_ids.append(run_id)
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    EventImportRun(
                        id=run_id,
                        source_id=self.source_id,
                        community_id=self.community_id,
                        mode="apply_review_only",
                        status="started",
                        found_count=0,
                        created_count=0,
                        updated_count=0,
                        summary={},
                        parser_metadata={},
                        debug_metadata={},
                        created_by=self.actor_id,
                    ),
                )

            with patch(
                "app.importer.runner.parse_website_events",
                return_value=ParsedWebsiteResult(found_on_list=len(items), items=items),
            ):
                return await execute_review_import(
                    session,
                    run_id=run_id,
                    source_id=self.source_id,
                    source_url="https://sredisvoih.com/events",
                    limit=None,
                    assume_year=None,
                )

    async def _actor(self, session):
        actor = await session.get(AppUser, self.actor_id)
        assert actor is not None
        return actor

    async def test_repeat_import_skips_exact_rows_and_keeps_possible_duplicates_reviewable(self) -> None:
        exact_item = self._parsed_item(
            external_id="same-external-id",
            source_url="https://sredisvoih.com/events/same?campaign=test",
        )
        first_run = await self._run_import([exact_item])
        self.assertEqual(first_run.summary["written"], 1)

        second_run = await self._run_import([exact_item])
        self.assertEqual(second_run.summary["written"], 0)
        self.assertEqual(second_run.summary["skipped"], 1)
        self.assertEqual(second_run.summary["skippedExistingImportItem"], 1)
        self.assertEqual(second_run.summary["skippedExistingEvent"], 0)

        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    Event(
                        community_id=self.community_id,
                        title="Existing exact event",
                        starts_at=self.now + timedelta(days=8),
                        category="community",
                        source_type="website_scrape",
                        source_external_id="existing-event",
                        source_url="https://sredisvoih.com/events/existing?from=legacy",
                    ),
                )
                session.add(
                    Event(
                        community_id=self.community_id,
                        title="Possible duplicate",
                        starts_at=self.now + timedelta(days=9),
                        category="community",
                        source_type="website_scrape",
                    ),
                )

        third_run = await self._run_import(
            [
                self._parsed_item(
                    external_id="existing-event",
                    source_url="https://sredisvoih.com/events/existing",
                    title="Existing exact event",
                    starts_at=self.now + timedelta(days=8),
                ),
                self._parsed_item(
                    external_id="different-id",
                    source_url="https://sredisvoih.com/events/possible",
                    title="Possible duplicate",
                    starts_at=self.now + timedelta(days=9),
                ),
            ],
        )
        self.assertEqual(third_run.summary["written"], 1)
        self.assertEqual(third_run.summary["skippedExistingEvent"], 1)
        self.assertEqual(third_run.summary["possibleDuplicate"], 1)

        async with AsyncSessionLocal() as session:
            rows = list(
                await session.scalars(
                    select(EventImportItem).where(EventImportItem.source_id == self.source_id),
                )
            )
        self.assertEqual(len(rows), 2)
        possible_duplicate_row = next(
            row for row in rows
            if row.external_id == "different-id"
        )
        self.assertEqual(
            possible_duplicate_row.raw_payload["importReview"]["dedupe"]["status"],
            "possible_duplicate",
        )

    async def test_review_queue_filters_before_pagination_and_ignore_does_not_return(self) -> None:
        run = await self._run_import([self._parsed_item(
            external_id="reviewable", source_url="https://sredisvoih.com/events/reviewable",
        )])
        async with AsyncSessionLocal() as session:
            async with session.begin():
                source = await session.get(EventImportSource, self.source_id)
                assert source is not None
                session.add_all(
                    [
                        EventImportItem(
                            run_id=run.id,
                            source_id=self.source_id,
                            raw_payload={},
                            status="error",
                            error="Parse failed",
                        ),
                        EventImportItem(
                            run_id=run.id,
                            source_id=self.source_id,
                            raw_payload={},
                            status="ignored",
                        ),
                        EventImportItem(
                            run_id=run.id,
                            source_id=self.source_id,
                            raw_payload={},
                            status="linked",
                        ),
                    ],
                )

        async with AsyncSessionLocal() as session:
            actor = await self._actor(session)
            actionable = await admin_import_service.list_admin_import_items(
                session, actor, status=None, needs_review=True, source_id=None, run_id=None,
                limit=10, offset=0,
            )
            diagnostic = await admin_import_service.list_admin_import_items(
                session, actor, status="all", needs_review=False, source_id=None, run_id=None,
                limit=10, offset=0,
            )
        self.assertEqual({item.status for item in actionable}, {"new", "error"})
        self.assertEqual({item.status for item in diagnostic}, {"new", "error", "ignored", "linked"})

        async with AsyncSessionLocal() as session:
            actor = await self._actor(session)
            for item in actionable:
                await admin_import_service.ignore_admin_import_item(
                    session,
                    actor,
                    item.id,
                    AdminImportIgnoreRequest(reason="Reviewed"),
                )

        async with AsyncSessionLocal() as session:
            actor = await self._actor(session)
            reloaded = await admin_import_service.list_admin_import_items(
                session, actor, status=None, needs_review=True, source_id=None, run_id=None,
                limit=10, offset=0,
            )
        self.assertEqual(reloaded, [])

    async def test_duplicate_maintenance_is_dry_run_until_apply(self) -> None:
        first_run = await self._run_import([])
        second_run = await self._run_import([])
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add_all(
                    [
                        EventImportItem(
                            run_id=first_run.id,
                            source_id=self.source_id,
                            external_id="maintenance-id",
                            source_url="https://sredisvoih.com/events/maintenance",
                            raw_payload={},
                            status="new",
                        ),
                        EventImportItem(
                            run_id=second_run.id,
                            source_id=self.source_id,
                            external_id="maintenance-id",
                            source_url="https://sredisvoih.com/events/maintenance?copy=1",
                            raw_payload={},
                            status="error",
                            error="Transient parse error",
                        ),
                    ],
                )

        async with AsyncSessionLocal() as session:
            dry_run = await ignore_exact_open_import_duplicates(session, apply=False)
            self.assertEqual(dry_run.duplicate_groups, 1)
            self.assertEqual(dry_run.would_change, 1)
            self.assertEqual(dry_run.changed, 0)

        async with AsyncSessionLocal() as session:
            applied = await ignore_exact_open_import_duplicates(
                session,
                apply=True,
                community_id=self.community_id,
            )
            self.assertEqual(applied.changed, 1)
            statuses = list(
                await session.scalars(
                    select(EventImportItem.status)
                    .where(EventImportItem.source_id == self.source_id)
                    .order_by(EventImportItem.created_at, EventImportItem.id),
                )
            )
        self.assertEqual(statuses.count("ignored"), 1)

    async def test_unmodified_legacy_category_does_not_block_an_unrelated_patch(self) -> None:
        event_id = uuid4()
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    EventCategory(
                        community_id=self.community_id,
                        slug="legacy_category",
                        title="Archived legacy category",
                        color="#654321",
                        icon="*",
                        is_active=False,
                        created_by=self.actor_id,
                        updated_by=self.actor_id,
                    ),
                )
                await session.flush()
                session.add(
                    Event(
                        id=event_id,
                        community_id=self.community_id,
                        title="Legacy event",
                        starts_at=self.now,
                        category="legacy_category",
                        status="draft",
                        visibility="hidden",
                        registration_mode="none",
                    ),
                )

        async with AsyncSessionLocal() as session:
            actor = await self._actor(session)
            updated = await admin_events_service.update_admin_event(
                session,
                actor,
                event_id,
                AdminEventUpdateRequest(title="Renamed legacy event"),
            )
        self.assertEqual(updated.title, "Renamed legacy event")
        self.assertEqual(updated.category, "legacy_category")


if __name__ == "__main__":
    unittest.main()
