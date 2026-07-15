from __future__ import annotations

import unittest
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import delete

from app.db.models.core import AdminFeedback, AppUser, Community, CommunityMembership
from app.db.session import AsyncSessionLocal, engine
from app.schemas.feedback import (
    AdminFeedbackCreateRequest,
    AdminFeedbackResponse,
    AdminFeedbackStatusUpdateRequest,
)
from app.services import feedback as feedback_service


def _now() -> datetime:
    return datetime.now(UTC)


@dataclass(frozen=True)
class TestContext:
    actor_id: UUID
    community_id: UUID


class AdminFeedbackTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.community_ids: list[UUID] = []
        self.user_ids: list[UUID] = []

    async def asyncTearDown(self) -> None:
        try:
            async with AsyncSessionLocal() as session:
                async with session.begin():
                    if self.community_ids:
                        await session.execute(
                            delete(Community).where(Community.id.in_(self.community_ids)),
                        )
                    if self.user_ids:
                        await session.execute(
                            delete(AppUser).where(AppUser.id.in_(self.user_ids)),
                        )
        finally:
            await engine.dispose()

    async def test_admin_lists_filters_paginates_and_orders_feedback(self) -> None:
        context = await self._create_context(role="admin")
        created_at = _now()
        oldest = await self._add_feedback(
            context,
            section="Portal",
            severity="issue",
            status="open",
            created_at=created_at - timedelta(minutes=1),
        )
        tied_first = await self._add_feedback(
            context,
            section="Portal",
            severity="blocker",
            status="open",
            created_at=created_at,
        )
        tied_second = await self._add_feedback(
            context,
            section="Events",
            severity="idea",
            status="reviewed",
            created_at=created_at,
        )
        newest = await self._add_feedback(
            context,
            section="Portal",
            severity="note",
            status="open",
            created_at=created_at + timedelta(minutes=1),
        )

        async with AsyncSessionLocal() as session:
            actor = await session.get(AppUser, context.actor_id)
            assert actor is not None
            items, total_count, limit, offset = await feedback_service.list_admin_feedback(
                session,
                actor,
                status="all",
                severity="all",
                limit=200,
            )

        expected = sorted(
            [oldest, tied_first, tied_second, newest],
            key=lambda item: (item.created_at, item.id.int),
            reverse=True,
        )
        self.assertEqual([item.id for item in items], [item.id for item in expected])
        self.assertEqual(total_count, 4)
        self.assertEqual(limit, 100)
        self.assertEqual(offset, 0)

        async with AsyncSessionLocal() as session:
            actor = await session.get(AppUser, context.actor_id)
            assert actor is not None
            status_items, status_total, _, _ = await feedback_service.list_admin_feedback(
                session,
                actor,
                status="open",
            )
            severity_items, severity_total, _, _ = await feedback_service.list_admin_feedback(
                session,
                actor,
                severity="issue",
            )
            section_items, section_total, _, _ = await feedback_service.list_admin_feedback(
                session,
                actor,
                section="  Portal  ",
            )
            page_items, page_total, page_limit, page_offset = (
                await feedback_service.list_admin_feedback(
                    session,
                    actor,
                    limit=2,
                    offset=1,
                )
            )

        self.assertEqual({item.id for item in status_items}, {oldest.id, tied_first.id, newest.id})
        self.assertEqual(status_total, 3)
        self.assertEqual([item.id for item in severity_items], [oldest.id])
        self.assertEqual(severity_total, 1)
        self.assertEqual({item.id for item in section_items}, {oldest.id, tied_first.id, newest.id})
        self.assertEqual(section_total, 3)
        self.assertEqual([item.id for item in page_items], [item.id for item in expected[1:3]])
        self.assertEqual(page_total, 4)
        self.assertEqual(page_limit, 2)
        self.assertEqual(page_offset, 1)

    async def test_admin_updates_resolution_metadata_for_each_status_family(self) -> None:
        context = await self._create_context(role="admin")
        feedback = await self._add_feedback(context)

        async with AsyncSessionLocal() as session:
            actor = await session.get(AppUser, context.actor_id)
            assert actor is not None
            resolved = await feedback_service.update_admin_feedback_status(
                session,
                actor,
                feedback.id,
                AdminFeedbackStatusUpdateRequest(status="resolved"),
            )
        self.assertEqual(resolved.status, "resolved")
        self.assertIsNotNone(resolved.resolved_at)
        self.assertEqual(resolved.resolved_by, context.actor_id)
        self.assertGreaterEqual(resolved.updated_at, feedback.updated_at)

        async with AsyncSessionLocal() as session:
            actor = await session.get(AppUser, context.actor_id)
            assert actor is not None
            closed = await feedback_service.update_admin_feedback_status(
                session,
                actor,
                feedback.id,
                AdminFeedbackStatusUpdateRequest(status="closed"),
            )
        self.assertEqual(closed.status, "closed")
        self.assertIsNotNone(closed.resolved_at)
        self.assertEqual(closed.resolved_by, context.actor_id)

        async with AsyncSessionLocal() as session:
            actor = await session.get(AppUser, context.actor_id)
            assert actor is not None
            reviewed = await feedback_service.update_admin_feedback_status(
                session,
                actor,
                feedback.id,
                AdminFeedbackStatusUpdateRequest(status="reviewed"),
            )
        self.assertEqual(reviewed.status, "reviewed")
        self.assertIsNone(reviewed.resolved_at)
        self.assertIsNone(reviewed.resolved_by)

        async with AsyncSessionLocal() as session:
            actor = await session.get(AppUser, context.actor_id)
            assert actor is not None
            reopened = await feedback_service.update_admin_feedback_status(
                session,
                actor,
                feedback.id,
                AdminFeedbackStatusUpdateRequest(status="open"),
            )
        self.assertEqual(reopened.status, "open")
        self.assertIsNone(reopened.resolved_at)
        self.assertIsNone(reopened.resolved_by)

    async def test_submission_remains_available_to_admin_and_event_manager(self) -> None:
        admin_context = await self._create_context(role="admin")
        manager_context = await self._create_context(role="event_manager")

        async with AsyncSessionLocal() as session:
            admin = await session.get(AppUser, admin_context.actor_id)
            manager = await session.get(AppUser, manager_context.actor_id)
            assert admin is not None
            assert manager is not None
            admin_feedback = await feedback_service.create_admin_feedback(
                session,
                admin,
                AdminFeedbackCreateRequest(section="Portal", message="Admin report"),
            )
            manager_feedback = await feedback_service.create_admin_feedback(
                session,
                manager,
                AdminFeedbackCreateRequest(section="Events", message="Manager report"),
            )

        self.assertEqual(admin_feedback.community_id, admin_context.community_id)
        self.assertEqual(manager_feedback.community_id, manager_context.community_id)
        self.assertEqual(admin_feedback.status, "open")
        self.assertEqual(manager_feedback.status, "open")

    async def test_event_manager_and_member_cannot_list_or_update(self) -> None:
        admin_context = await self._create_context(role="admin")
        manager_id = await self._add_member(admin_context.community_id, role="event_manager")
        member_id = await self._add_member(admin_context.community_id, role="member")
        feedback = await self._add_feedback(admin_context)

        for actor_id in (manager_id, member_id):
            async with AsyncSessionLocal() as session:
                actor = await session.get(AppUser, actor_id)
                assert actor is not None
                with self.assertRaises(HTTPException) as list_error:
                    await feedback_service.list_admin_feedback(session, actor)
                self.assertEqual(list_error.exception.status_code, 403)

            async with AsyncSessionLocal() as session:
                actor = await session.get(AppUser, actor_id)
                assert actor is not None
                with self.assertRaises(HTTPException) as update_error:
                    await feedback_service.update_admin_feedback_status(
                        session,
                        actor,
                        feedback.id,
                        AdminFeedbackStatusUpdateRequest(status="reviewed"),
                    )
                self.assertEqual(update_error.exception.status_code, 403)

    async def test_other_community_feedback_is_hidden_and_safe_not_found_matches_missing(self) -> None:
        context = await self._create_context(role="admin")
        own_feedback = await self._add_feedback(context)
        other_context = await self._create_context(role="admin")
        other_feedback = await self._add_feedback(other_context)

        async with AsyncSessionLocal() as session:
            actor = await session.get(AppUser, context.actor_id)
            assert actor is not None
            items, total_count, _, _ = await feedback_service.list_admin_feedback(session, actor)
        self.assertEqual([item.id for item in items], [own_feedback.id])
        self.assertEqual(total_count, 1)

        async with AsyncSessionLocal() as session:
            actor = await session.get(AppUser, context.actor_id)
            assert actor is not None
            with self.assertRaises(HTTPException) as out_of_scope:
                await feedback_service.update_admin_feedback_status(
                    session,
                    actor,
                    other_feedback.id,
                    AdminFeedbackStatusUpdateRequest(status="resolved"),
                )

        async with AsyncSessionLocal() as session:
            actor = await session.get(AppUser, context.actor_id)
            assert actor is not None
            with self.assertRaises(HTTPException) as missing:
                await feedback_service.update_admin_feedback_status(
                    session,
                    actor,
                    uuid4(),
                    AdminFeedbackStatusUpdateRequest(status="resolved"),
                )

        self.assertEqual(out_of_scope.exception.status_code, 404)
        self.assertEqual(missing.exception.status_code, 404)
        self.assertEqual(out_of_scope.exception.detail, missing.exception.detail)

    async def test_feedback_operations_do_not_log_feedback_content(self) -> None:
        context = await self._create_context(role="admin")
        private_message = "Private report: person@example.test, +79990001122"

        with self.assertNoLogs("app.services.feedback", level="DEBUG"):
            async with AsyncSessionLocal() as session:
                actor = await session.get(AppUser, context.actor_id)
                assert actor is not None
                feedback = await feedback_service.create_admin_feedback(
                    session,
                    actor,
                    AdminFeedbackCreateRequest(
                        section="Portal",
                        message=private_message,
                    ),
                )
                await feedback_service.list_admin_feedback(session, actor)
                await feedback_service.update_admin_feedback_status(
                    session,
                    actor,
                    feedback.id,
                    AdminFeedbackStatusUpdateRequest(status="resolved"),
                )

    def test_routes_and_response_schema_expose_only_feedback_contract(self) -> None:
        from app.main import app

        feedback_paths = app.openapi()["paths"]
        self.assertEqual(set(feedback_paths["/admin/feedback"]), {"get", "post"})
        self.assertEqual(
            set(feedback_paths["/admin/feedback/{feedback_id}"]),
            {"patch"},
        )
        self.assertEqual(
            set(AdminFeedbackResponse.model_fields),
            {
                "id",
                "community_id",
                "user_id",
                "section",
                "entity_type",
                "entity_id",
                "severity",
                "message",
                "status",
                "url",
                "user_agent",
                "created_at",
                "updated_at",
                "resolved_at",
                "resolved_by",
            },
        )

    async def _create_context(self, *, role: str) -> TestContext:
        community_id = uuid4()
        actor_id = uuid4()
        self.community_ids.append(community_id)
        self.user_ids.append(actor_id)
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add_all(
                    [
                        Community(
                            id=community_id,
                            name="Feedback test community",
                            city="Moscow",
                            slug=f"feedback-{community_id.hex[:20]}",
                        ),
                        AppUser(id=actor_id, status="active"),
                        CommunityMembership(
                            id=uuid4(),
                            community_id=community_id,
                            user_id=actor_id,
                            role=role,
                            status="active",
                        ),
                    ],
                )
        return TestContext(actor_id=actor_id, community_id=community_id)

    async def _add_member(self, community_id: UUID, *, role: str) -> UUID:
        user_id = uuid4()
        self.user_ids.append(user_id)
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add_all(
                    [
                        AppUser(id=user_id, status="active"),
                        CommunityMembership(
                            id=uuid4(),
                            community_id=community_id,
                            user_id=user_id,
                            role=role,
                            status="active",
                        ),
                    ],
                )
        return user_id

    async def _add_feedback(
        self,
        context: TestContext,
        *,
        section: str = "Portal",
        severity: str = "note",
        status: str = "open",
        created_at: datetime | None = None,
    ) -> AdminFeedback:
        timestamp = created_at or _now()
        feedback = AdminFeedback(
            id=uuid4(),
            community_id=context.community_id,
            user_id=context.actor_id,
            section=section,
            severity=severity,
            message=f"Feedback {uuid4()}",
            status=status,
            created_at=timestamp,
            updated_at=timestamp,
        )
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(feedback)
        return feedback


if __name__ == "__main__":
    unittest.main()
