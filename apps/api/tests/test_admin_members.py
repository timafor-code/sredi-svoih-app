from __future__ import annotations

import asyncio
import unittest
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import httpx
from fastapi import HTTPException
from sqlalchemy import delete, func, select

from app.core.tokens import create_access_token
from app.db.models.auth import (
    AuthEmailVerificationCode,
    AuthSession,
    AuthSetPasswordCode,
    PasswordResetCode,
    PrivacyAccessCode,
    PrivacyAccessSession,
)
from app.db.models.core import (
    AppUser,
    Community,
    CommunityMembership,
    PrivacyRequest,
    Profile,
)
from app.db.session import AsyncSessionLocal, engine
from app.main import app
from app.services import admin_members, privacy_erasure
from app.services.email_delivery import EmailSendResult
from app.services.privacy_erasure_worker import (
    privacy_erasure_request_is_authorized,
)


class AdminMemberDeletionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.marker = uuid4().hex[:12]
        self.now = datetime.now(UTC).replace(microsecond=0)
        self.community_id = uuid4()
        self.other_community_id = uuid4()
        self.community_ids = [self.community_id, self.other_community_id]
        self.user_ids: list[UUID] = []
        self.email_mock = patch(
            "app.services.privacy_erasure.send_privacy_erasure_accepted",
            return_value=EmailSendResult(sent=True, disabled=False),
        ).start()
        self.addCleanup(patch.stopall)

        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add_all(
                    [
                        Community(
                            id=self.community_id,
                            name="Synthetic admin members community",
                            city="Moscow",
                            slug=f"admin-members-{self.marker}",
                        ),
                        Community(
                            id=self.other_community_id,
                            name="Synthetic other community",
                            city="Moscow",
                            slug=f"admin-members-other-{self.marker}",
                        ),
                    ],
                )

        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
        )

    async def asyncTearDown(self) -> None:
        await self.client.aclose()
        try:
            async with AsyncSessionLocal() as session:
                async with session.begin():
                    if self.user_ids:
                        await session.execute(
                            delete(PrivacyRequest).where(
                                PrivacyRequest.user_id.in_(self.user_ids),
                            ),
                        )
                    await session.execute(
                        delete(Community).where(
                            Community.id.in_(self.community_ids),
                        ),
                    )
                    if self.user_ids:
                        await session.execute(
                            delete(AppUser).where(AppUser.id.in_(self.user_ids)),
                        )
        finally:
            await engine.dispose()

    async def _add_user(
        self,
        *,
        email: bool = True,
        status: str = "active",
        auth_token_version: int = 0,
    ) -> UUID:
        user_id = uuid4()
        self.user_ids.append(user_id)
        canonical_email = (
            f"admin-members-{self.marker}-{len(self.user_ids)}@example.invalid"
            if email
            else None
        )
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    AppUser(
                        id=user_id,
                        email=canonical_email,
                        account_origin="migration",
                        claim_state="legacy_external",
                        status=status,
                        auth_token_version=auth_token_version,
                        deletion_requested_at=(self.now if status == "deletion_pending" else None),
                    ),
                )
                await session.flush()
                session.add(
                    Profile(
                        user_id=user_id,
                        first_name="Synthetic",
                        last_name=f"Member {len(self.user_ids)}",
                        full_name=f"Synthetic Member {len(self.user_ids)}",
                        display_name=f"Synthetic Member {len(self.user_ids)}",
                        email=canonical_email,
                    ),
                )
        return user_id

    async def _add_membership(
        self,
        user_id: UUID,
        *,
        community_id: UUID | None = None,
        role: str = "member",
        status: str = "active",
    ) -> UUID:
        membership_id = uuid4()
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    CommunityMembership(
                        id=membership_id,
                        community_id=community_id or self.community_id,
                        user_id=user_id,
                        role=role,
                        status=status,
                        joined_at=self.now if status == "active" else None,
                    ),
                )
        return membership_id

    async def _add_admin(self) -> UUID:
        user_id = await self._add_user()
        await self._add_membership(user_id, role="admin")
        return user_id

    async def _add_target(
        self,
        *,
        email: bool = True,
        role: str = "member",
        status: str = "active",
        user_status: str = "active",
        auth_token_version: int = 0,
    ) -> UUID:
        user_id = await self._add_user(
            email=email,
            status=user_status,
            auth_token_version=auth_token_version,
        )
        await self._add_membership(user_id, role=role, status=status)
        return user_id

    @staticmethod
    def _headers(user_id: UUID, *, auth_token_version: int = 0) -> dict[str, str]:
        return {
            "Authorization": (
                f"Bearer {create_access_token(user_id, auth_token_version=auth_token_version)}"
            ),
        }

    async def _delete_member(
        self,
        actor_id: UUID,
        target_id: UUID,
        *,
        community_id: UUID | None = None,
        confirmation: str = "DELETE",
    ) -> httpx.Response:
        return await self.client.post(
            f"/admin/members/{target_id}/deletion",
            headers=self._headers(actor_id),
            json={
                "community_id": str(community_id or self.community_id),
                "confirmation": confirmation,
            },
        )

    async def _list_members(
        self,
        actor_id: UUID,
        **filters: object,
    ) -> httpx.Response:
        return await self.client.get(
            "/admin/members",
            headers=self._headers(actor_id),
            params={"community_id": str(self.community_id), **filters},
        )

    async def _get_member_detail(
        self,
        actor_id: UUID,
        target_id: UUID,
    ) -> httpx.Response:
        return await self.client.get(
            f"/admin/members/{target_id}",
            headers=self._headers(actor_id),
            params={"community_id": str(self.community_id)},
        )

    async def _update_member_profile(
        self,
        actor_id: UUID,
        target_id: UUID,
        **fields: object,
    ) -> httpx.Response:
        return await self.client.patch(
            f"/admin/members/{target_id}/profile",
            headers=self._headers(actor_id),
            json={"community_id": str(self.community_id), **fields},
        )

    async def _add_credentials(self, user_id: UUID) -> dict[str, UUID]:
        ids = {
            "auth_session": uuid4(),
            "privacy_session": uuid4(),
            "email_code": uuid4(),
            "reset_code": uuid4(),
            "set_password_code": uuid4(),
            "privacy_code": uuid4(),
        }
        expires_at = self.now + timedelta(hours=1)
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add_all(
                    [
                        AuthSession(
                            id=ids["auth_session"],
                            user_id=user_id,
                            refresh_token_hash=f"refresh-{uuid4().hex}",
                            expires_at=expires_at,
                            created_at=self.now,
                            updated_at=self.now,
                        ),
                        PrivacyAccessSession(
                            id=ids["privacy_session"],
                            user_id=user_id,
                            token_hash=f"privacy-session-{uuid4().hex}",
                            scope="privacy_self_service",
                            expires_at=expires_at,
                            created_at=self.now,
                        ),
                        AuthEmailVerificationCode(
                            id=ids["email_code"],
                            user_id=user_id,
                            code_hash=f"email-code-{uuid4().hex}",
                            expires_at=expires_at,
                            created_at=self.now,
                            updated_at=self.now,
                        ),
                        PasswordResetCode(
                            id=ids["reset_code"],
                            user_id=user_id,
                            code_hash=f"reset-code-{uuid4().hex}",
                            expires_at=expires_at,
                            created_at=self.now,
                            updated_at=self.now,
                        ),
                        AuthSetPasswordCode(
                            id=ids["set_password_code"],
                            user_id=user_id,
                            code_hash=f"set-password-code-{uuid4().hex}",
                            expires_at=expires_at,
                            created_at=self.now,
                            updated_at=self.now,
                        ),
                        PrivacyAccessCode(
                            id=ids["privacy_code"],
                            user_id=user_id,
                            code_hash=f"privacy-code-{uuid4().hex}",
                            expires_at=expires_at,
                            created_at=self.now,
                            updated_at=self.now,
                        ),
                    ],
                )
        return ids

    async def test_active_member_remains_visible_in_fresh_list(self) -> None:
        admin_id = await self._add_admin()
        target_id = await self._add_target()

        response = await self._list_members(admin_id)

        self.assertEqual(response.status_code, 200, response.text)
        user_ids = {row["user_id"] for row in response.json()["data"]}
        self.assertIn(str(target_id), user_ids)

    async def test_deletion_pending_member_is_hidden_from_list_and_filters(
        self,
    ) -> None:
        admin_id = await self._add_admin()
        target_id = await self._add_target(user_status="deletion_pending")

        response = await self._list_members(admin_id)
        filtered_response = await self._list_members(
            admin_id,
            search=str(target_id),
            role="member",
            membership_status="active",
        )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(filtered_response.status_code, 200, filtered_response.text)
        self.assertNotIn(
            str(target_id),
            {row["user_id"] for row in response.json()["data"]},
        )
        self.assertNotIn(
            str(target_id),
            {row["user_id"] for row in filtered_response.json()["data"]},
        )

    async def test_admin_deletion_removes_member_from_fresh_list_response(
        self,
    ) -> None:
        admin_id = await self._add_admin()
        target_id = await self._add_target()
        other_member_id = await self._add_target()

        before = await self._list_members(admin_id)
        self.assertEqual(before.status_code, 200, before.text)
        self.assertIn(
            str(target_id),
            {row["user_id"] for row in before.json()["data"]},
        )

        deletion = await self._delete_member(admin_id, target_id)
        self.assertEqual(deletion.status_code, 200, deletion.text)
        self.assertEqual(deletion.json()["data"]["state"], "deletion_pending")

        refreshed = await self._list_members(admin_id)
        self.assertEqual(refreshed.status_code, 200, refreshed.text)
        refreshed_user_ids = {row["user_id"] for row in refreshed.json()["data"]}
        self.assertNotIn(str(target_id), refreshed_user_ids)
        self.assertIn(str(other_member_id), refreshed_user_ids)

    async def test_success_starts_canonical_admin_erasure_and_revokes_access(
        self,
    ) -> None:
        admin_id = await self._add_admin()
        target_id = await self._add_target()
        credential_ids = await self._add_credentials(target_id)
        old_target_headers = self._headers(target_id)

        response = await self._delete_member(admin_id, target_id)

        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()["data"]
        self.assertEqual(data["user_id"], str(target_id))
        self.assertEqual(data["state"], "deletion_pending")

        async with AsyncSessionLocal() as session:
            user = await session.get(AppUser, target_id)
            request = await session.get(PrivacyRequest, UUID(data["request_id"]))
            request_count = await session.scalar(
                select(func.count())
                .select_from(PrivacyRequest)
                .where(PrivacyRequest.user_id == target_id),
            )
            auth_session = await session.get(AuthSession, credential_ids["auth_session"])
            privacy_session = await session.get(
                PrivacyAccessSession,
                credential_ids["privacy_session"],
            )
            code_rows = [
                await session.get(AuthEmailVerificationCode, credential_ids["email_code"]),
                await session.get(PasswordResetCode, credential_ids["reset_code"]),
                await session.get(AuthSetPasswordCode, credential_ids["set_password_code"]),
                await session.get(PrivacyAccessCode, credential_ids["privacy_code"]),
            ]
            profile = await session.scalar(
                select(Profile).where(Profile.user_id == target_id),
            )
            membership = await session.scalar(
                select(CommunityMembership).where(
                    CommunityMembership.user_id == target_id,
                    CommunityMembership.community_id == self.community_id,
                ),
            )

        self.assertIsNotNone(user)
        self.assertEqual(user.status, "deletion_pending")
        self.assertIsNotNone(user.deletion_requested_at)
        self.assertEqual(user.auth_token_version, 1)
        self.assertEqual(request_count, 1)
        self.assertEqual(request.request_type, "deletion")
        self.assertEqual(request.origin, "admin")
        self.assertEqual(request.initiated_by_user_id, admin_id)
        self.assertEqual(request.community_id, self.community_id)
        self.assertIsNotNone(request.admin_authorized_at)
        self.assertIsNone(request.identity_verified_at)
        self.assertIsNotNone(request.processing_stopped_at)
        self.assertEqual(request.pre_deletion_user_status, "active")
        self.assertTrue(privacy_erasure_request_is_authorized(request))
        self.assertIsNotNone(auth_session.revoked_at)
        self.assertIsNotNone(privacy_session.revoked_at)
        self.assertTrue(all(row.consumed_at is not None for row in code_rows))
        self.assertIsNotNone(profile)
        self.assertIsNotNone(membership)
        self.email_mock.assert_called_once()

        old_access = await self.client.get("/auth/me", headers=old_target_headers)
        self.assertEqual(old_access.status_code, 401)

    async def test_only_active_admin_membership_is_authorized(self) -> None:
        target_id = await self._add_target()
        rejected_actors: list[UUID] = []
        for role, membership_status in (
            ("member", "active"),
            ("rabbi", "active"),
            ("event_manager", "active"),
            ("admin", "pending"),
            ("admin", "suspended"),
            ("admin", "left"),
        ):
            actor_id = await self._add_user()
            rejected_actors.append(actor_id)
            await self._add_membership(
                actor_id,
                role=role,
                status=membership_status,
            )

        for actor_id in rejected_actors:
            rejected = await self._delete_member(actor_id, target_id)
            self.assertEqual(rejected.status_code, 403, rejected.text)

        active_admin_id = await self._add_admin()
        accepted = await self._delete_member(active_admin_id, target_id)
        self.assertEqual(accepted.status_code, 200, accepted.text)

    async def test_self_delete_and_invalid_confirmation_make_no_changes(self) -> None:
        admin_id = await self._add_admin()
        target_id = await self._add_target()

        self_delete = await self._delete_member(admin_id, admin_id)
        self.assertEqual(self_delete.status_code, 409, self_delete.text)
        self.assertEqual(self_delete.json()["error"]["code"], "cannot_delete_self")

        invalid = await self._delete_member(
            admin_id,
            target_id,
            confirmation="delete",
        )
        self.assertEqual(invalid.status_code, 422, invalid.text)
        self.assertEqual(invalid.json()["error"]["code"], "invalid_confirmation")

        async with AsyncSessionLocal() as session:
            users = {
                user.id: user
                for user in await session.scalars(
                    select(AppUser).where(AppUser.id.in_([admin_id, target_id])),
                )
            }
            request_count = await session.scalar(
                select(func.count())
                .select_from(PrivacyRequest)
                .where(PrivacyRequest.user_id.in_([admin_id, target_id])),
            )
        self.assertEqual(request_count, 0)
        self.assertEqual(users[admin_id].status, "active")
        self.assertEqual(users[target_id].status, "active")
        self.assertEqual(users[admin_id].auth_token_version, 0)
        self.assertEqual(users[target_id].auth_token_version, 0)

    async def test_other_active_community_is_blocked_without_disclosure(self) -> None:
        admin_id = await self._add_admin()
        target_id = await self._add_target()
        await self._add_membership(
            target_id,
            community_id=self.other_community_id,
            role="rabbi",
            status="active",
        )

        response = await self._delete_member(admin_id, target_id)

        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(
            response.json()["error"]["code"],
            "member_has_other_active_communities",
        )
        self.assertNotIn(str(self.other_community_id), response.text)
        self.assertNotIn("Synthetic other community", response.text)
        self.assertNotIn("rabbi", response.text)
        async with AsyncSessionLocal() as session:
            user = await session.get(AppUser, target_id)
            request_count = await session.scalar(
                select(func.count())
                .select_from(PrivacyRequest)
                .where(PrivacyRequest.user_id == target_id),
            )
        self.assertEqual(user.status, "active")
        self.assertEqual(request_count, 0)

    async def test_non_active_memberships_elsewhere_do_not_block(self) -> None:
        admin_id = await self._add_admin()
        for membership_status in ("pending", "suspended", "left"):
            target_id = await self._add_target()
            await self._add_membership(
                target_id,
                community_id=self.other_community_id,
                status=membership_status,
            )
            response = await self._delete_member(admin_id, target_id)
            self.assertEqual(response.status_code, 200, response.text)

    async def test_idempotency_preserves_admin_request_and_token_version(self) -> None:
        admin_id = await self._add_admin()
        target_id = await self._add_target()

        first = await self._delete_member(admin_id, target_id)
        self.assertEqual(first.status_code, 200, first.text)
        self.email_mock.reset_mock()
        second = await self._delete_member(admin_id, target_id)

        self.assertEqual(second.status_code, 200, second.text)
        self.assertEqual(
            second.json()["data"]["request_id"],
            first.json()["data"]["request_id"],
        )
        async with AsyncSessionLocal() as session:
            user = await session.get(AppUser, target_id)
            requests = list(
                await session.scalars(
                    select(PrivacyRequest).where(PrivacyRequest.user_id == target_id),
                ),
            )
        self.assertEqual(user.auth_token_version, 1)
        self.assertEqual(len(requests), 1)
        self.assertEqual(requests[0].origin, "admin")
        self.email_mock.assert_not_called()

    async def test_idempotency_preserves_existing_self_service_request(self) -> None:
        admin_id = await self._add_admin()
        target_id = await self._add_target(
            user_status="deletion_pending",
            auth_token_version=1,
        )
        request_id = uuid4()
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    PrivacyRequest(
                        id=request_id,
                        user_id=target_id,
                        community_id=self.community_id,
                        request_type="deletion",
                        status="open",
                        origin="self_service",
                        identity_verified_at=self.now,
                        pre_deletion_user_status="active",
                        processing_stopped_at=self.now,
                        created_at=self.now,
                        updated_at=self.now,
                    ),
                )

        response = await self._delete_member(admin_id, target_id)

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["data"]["request_id"], str(request_id))
        async with AsyncSessionLocal() as session:
            user = await session.get(AppUser, target_id)
            request = await session.get(PrivacyRequest, request_id)
            request_count = await session.scalar(
                select(func.count())
                .select_from(PrivacyRequest)
                .where(PrivacyRequest.user_id == target_id),
            )
        self.assertEqual(user.auth_token_version, 1)
        self.assertEqual(request_count, 1)
        self.assertEqual(request.origin, "self_service")
        self.assertIsNone(request.initiated_by_user_id)
        self.assertIsNone(request.admin_authorized_at)
        self.email_mock.assert_not_called()

    async def test_no_email_target_and_non_last_admin_target_are_supported(self) -> None:
        admin_id = await self._add_admin()
        no_email_target_id = await self._add_target(email=False)

        no_email_response = await self._delete_member(admin_id, no_email_target_id)
        self.assertEqual(no_email_response.status_code, 200, no_email_response.text)
        self.email_mock.assert_not_called()

        admin_target_id = await self._add_target(role="admin")
        admin_response = await self._delete_member(admin_id, admin_target_id)
        self.assertEqual(admin_response.status_code, 200, admin_response.text)
        async with AsyncSessionLocal() as session:
            actor = await session.get(AppUser, admin_id)
            target = await session.get(AppUser, admin_target_id)
        self.assertEqual(actor.status, "active")
        self.assertEqual(target.status, "deletion_pending")

    async def test_last_admin_guard_ignores_deletion_pending_admin(self) -> None:
        guarded_community_id = uuid4()
        self.community_ids.append(guarded_community_id)
        target_id = await self._add_user()
        pending_admin_id = await self._add_user(
            status="deletion_pending",
            auth_token_version=1,
        )
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    Community(
                        id=guarded_community_id,
                        name="Synthetic guarded community",
                        city="Moscow",
                        slug=f"admin-members-guarded-{self.marker}",
                    ),
                )
        membership_id = await self._add_membership(
            target_id,
            community_id=guarded_community_id,
            role="admin",
            status="active",
        )
        await self._add_membership(
            pending_admin_id,
            community_id=guarded_community_id,
            role="admin",
            status="active",
        )

        async with AsyncSessionLocal() as session:
            async with session.begin():
                membership = await session.get(CommunityMembership, membership_id)
                with self.assertRaises(HTTPException) as raised:
                    await admin_members._ensure_other_active_admin_remains(
                        session,
                        community_id=guarded_community_id,
                        target_user_id=target_id,
                        target_membership=membership,
                    )
        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(
            raised.exception.detail["code"],
            "cannot_delete_last_admin",
        )
        async with AsyncSessionLocal() as session:
            user = await session.get(AppUser, target_id)
            request_count = await session.scalar(
                select(func.count())
                .select_from(PrivacyRequest)
                .where(PrivacyRequest.user_id == target_id),
            )
        self.assertEqual(user.status, "active")
        self.assertEqual(request_count, 0)

    async def test_last_admin_guard_waits_for_self_service_transition(self) -> None:
        guarded_community_id = uuid4()
        self.community_ids.append(guarded_community_id)
        target_id = await self._add_user()
        candidate_id = await self._add_user()
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    Community(
                        id=guarded_community_id,
                        name="Synthetic concurrent guard community",
                        city="Moscow",
                        slug=f"admin-members-concurrent-guard-{self.marker}",
                    ),
                )
        target_membership_id = await self._add_membership(
            target_id,
            community_id=guarded_community_id,
            role="admin",
            status="active",
        )
        await self._add_membership(
            candidate_id,
            community_id=guarded_community_id,
            role="admin",
            status="active",
        )
        request_id = uuid4()

        async def run_guard() -> None:
            async with AsyncSessionLocal() as guard_session:
                async with guard_session.begin():
                    target_membership = await guard_session.get(
                        CommunityMembership,
                        target_membership_id,
                        with_for_update=True,
                    )
                    await admin_members._ensure_other_active_admin_remains(
                        guard_session,
                        community_id=guarded_community_id,
                        target_user_id=target_id,
                        target_membership=target_membership,
                    )

        guard_task: asyncio.Task[None] | None = None
        async with AsyncSessionLocal() as transition_session:
            try:
                await transition_session.begin()
                transition_session.add(
                    PrivacyRequest(
                        id=request_id,
                        user_id=candidate_id,
                        community_id=guarded_community_id,
                        request_type="deletion",
                        status="open",
                        origin="self_service",
                        identity_verified_at=self.now,
                        created_at=self.now,
                        updated_at=self.now,
                    ),
                )
                await transition_session.flush()
                await privacy_erasure._confirm_in_transaction(
                    transition_session,
                    request_id=request_id,
                    user_id=candidate_id,
                )

                guard_task = asyncio.create_task(run_guard())
                await asyncio.sleep(0.1)
                self.assertFalse(guard_task.done())

                await transition_session.commit()
                with self.assertRaises(HTTPException) as raised:
                    await asyncio.wait_for(guard_task, timeout=2)
            finally:
                if transition_session.in_transaction():
                    await transition_session.rollback()
                if guard_task is not None and not guard_task.done():
                    guard_task.cancel()
                    await asyncio.gather(guard_task, return_exceptions=True)

        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(
            raised.exception.detail["code"],
            "cannot_delete_last_admin",
        )
        async with AsyncSessionLocal() as session:
            target = await session.get(AppUser, target_id)
            candidate = await session.get(AppUser, candidate_id)
            target_request_count = await session.scalar(
                select(func.count())
                .select_from(PrivacyRequest)
                .where(PrivacyRequest.user_id == target_id),
            )
        self.assertEqual(target.status, "active")
        self.assertEqual(candidate.status, "deletion_pending")
        self.assertEqual(target_request_count, 0)

    async def test_concurrent_cross_delete_cannot_leave_zero_active_admins(self) -> None:
        admin_a_id = await self._add_admin()
        admin_b_id = await self._add_admin()

        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
        ) as client_a, httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
        ) as client_b:
            responses = await asyncio.gather(
                client_a.post(
                    f"/admin/members/{admin_b_id}/deletion",
                    headers=self._headers(admin_a_id),
                    json={
                        "community_id": str(self.community_id),
                        "confirmation": "DELETE",
                    },
                ),
                client_b.post(
                    f"/admin/members/{admin_a_id}/deletion",
                    headers=self._headers(admin_b_id),
                    json={
                        "community_id": str(self.community_id),
                        "confirmation": "DELETE",
                    },
                ),
            )

        self.assertEqual(sorted(response.status_code for response in responses), [200, 401])
        async with AsyncSessionLocal() as session:
            users = list(
                await session.scalars(
                    select(AppUser).where(AppUser.id.in_([admin_a_id, admin_b_id])),
                ),
            )
            request_count = await session.scalar(
                select(func.count())
                .select_from(PrivacyRequest)
                .where(PrivacyRequest.user_id.in_([admin_a_id, admin_b_id])),
            )
        self.assertEqual(sum(user.status == "active" for user in users), 1)
        self.assertEqual(sum(user.status == "deletion_pending" for user in users), 1)
        self.assertEqual(request_count, 1)

    async def test_unrelated_active_member_is_not_in_selected_scope(self) -> None:
        admin_id = await self._add_admin()
        target_id = await self._add_user()
        await self._add_membership(
            target_id,
            community_id=self.other_community_id,
            status="active",
        )

        response = await self._delete_member(admin_id, target_id)

        self.assertEqual(response.status_code, 404, response.text)
        self.assertNotIn(str(self.other_community_id), response.text)
        async with AsyncSessionLocal() as session:
            user = await session.get(AppUser, target_id)
        self.assertEqual(user.status, "active")

    async def test_lifecycle_failure_rolls_back_request_and_user_transition(self) -> None:
        admin_id = await self._add_admin()
        target_id = await self._add_target()

        with patch(
            "app.services.privacy_erasure._revoke_credentials",
            new=AsyncMock(side_effect=RuntimeError("synthetic lifecycle failure")),
        ):
            with self.assertRaisesRegex(RuntimeError, "synthetic lifecycle failure"):
                await self._delete_member(admin_id, target_id)

        async with AsyncSessionLocal() as session:
            user = await session.get(AppUser, target_id)
            request_count = await session.scalar(
                select(func.count())
                .select_from(PrivacyRequest)
                .where(PrivacyRequest.user_id == target_id),
            )
        self.assertEqual(user.status, "active")
        self.assertIsNone(user.deletion_requested_at)
        self.assertEqual(user.auth_token_version, 0)
        self.assertEqual(request_count, 0)

    async def test_member_detail_separates_account_and_contact_email(self) -> None:
        admin_id = await self._add_admin()
        target_id = await self._add_target()
        async with AsyncSessionLocal() as session:
            async with session.begin():
                account = await session.get(AppUser, target_id)
                profile = await session.scalar(
                    select(Profile).where(Profile.user_id == target_id),
                )
                account.email = "login@example.invalid"
                profile.email = "contact@example.invalid"

        response = await self._get_member_detail(admin_id, target_id)

        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()["data"]
        self.assertEqual(data["account_email"], "login@example.invalid")
        self.assertEqual(data["email"], "contact@example.invalid")

    async def test_contact_email_update_does_not_change_account_email(self) -> None:
        admin_id = await self._add_admin()
        target_id = await self._add_target()
        async with AsyncSessionLocal() as session:
            async with session.begin():
                account = await session.get(AppUser, target_id)
                profile = await session.scalar(
                    select(Profile).where(Profile.user_id == target_id),
                )
                account.email = "login@example.invalid"
                profile.email = "contact@example.invalid"

        response = await self._update_member_profile(
            admin_id,
            target_id,
            email="new-contact@example.invalid",
        )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(
            response.json()["data"]["email"],
            "new-contact@example.invalid",
        )
        async with AsyncSessionLocal() as session:
            account = await session.get(AppUser, target_id)
            profile = await session.scalar(
                select(Profile).where(Profile.user_id == target_id),
            )
        self.assertEqual(account.email, "login@example.invalid")
        self.assertEqual(profile.email, "new-contact@example.invalid")

    async def test_first_and_last_names_are_normalized_and_derive_names(self) -> None:
        admin_id = await self._add_admin()
        target_id = await self._add_target()

        response = await self._update_member_profile(
            admin_id,
            target_id,
            first_name=" Иван ",
            last_name=" Петров ",
        )

        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()["data"]
        self.assertEqual(data["first_name"], "Иван")
        self.assertEqual(data["last_name"], "Петров")
        self.assertEqual(data["full_name"], "Иван Петров")
        self.assertEqual(data["display_name"], "Иван Петров")
        async with AsyncSessionLocal() as session:
            profile = await session.scalar(
                select(Profile).where(Profile.user_id == target_id),
            )
        self.assertEqual(profile.first_name, "Иван")
        self.assertEqual(profile.last_name, "Петров")
        self.assertEqual(profile.full_name, "Иван Петров")
        self.assertEqual(profile.display_name, "Иван Петров")

    async def test_partial_first_name_update_uses_persisted_last_name(self) -> None:
        admin_id = await self._add_admin()
        target_id = await self._add_target()
        async with AsyncSessionLocal() as session:
            async with session.begin():
                profile = await session.scalar(
                    select(Profile).where(Profile.user_id == target_id),
                )
                profile.first_name = "Иван"
                profile.last_name = "Петров"
                profile.full_name = "Иван Петров"
                profile.display_name = "Иван Петров"

        response = await self._update_member_profile(
            admin_id,
            target_id,
            first_name="Пётр",
        )

        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()["data"]
        self.assertEqual(data["first_name"], "Пётр")
        self.assertEqual(data["last_name"], "Петров")
        self.assertEqual(data["full_name"], "Пётр Петров")
        self.assertEqual(data["display_name"], "Пётр Петров")

    async def test_derived_and_technical_profile_fields_are_rejected(self) -> None:
        admin_id = await self._add_admin()
        target_id = await self._add_target()

        for field_name, value in (
            ("full_name", "Injected Full Name"),
            ("display_name", "Injected Display Name"),
            ("onboarding_completed", True),
            ("account_email", "injected@example.invalid"),
        ):
            with self.subTest(field_name=field_name):
                response = await self._update_member_profile(
                    admin_id,
                    target_id,
                    **{field_name: value},
                )
                self.assertEqual(response.status_code, 422, response.text)

    async def test_approved_profile_fields_still_save(self) -> None:
        admin_id = await self._add_admin()
        target_id = await self._add_target()
        hebrew_birth_date = {
            "day": 10,
            "monthNameRu": "Хешван",
            "year": 5746,
            "labelRu": "10 Хешван 5746",
            "source": {"uncertainty": True},
        }

        response = await self._update_member_profile(
            admin_id,
            target_id,
            hebrew_name="Моше",
            email="contact-updated@example.invalid",
            phone="+79990000000",
            city="Москва",
            birth_date="1985-10-23",
            hebrew_birth_date=hebrew_birth_date,
            birth_time_context="after_sunset",
            nusach="ashkenaz",
            tribe_status="israel",
            marital_status="married",
            about="Synthetic profile update",
        )

        self.assertEqual(response.status_code, 200, response.text)
        async with AsyncSessionLocal() as session:
            profile = await session.scalar(
                select(Profile).where(Profile.user_id == target_id),
            )
        self.assertEqual(profile.hebrew_name, "Моше")
        self.assertEqual(profile.email, "contact-updated@example.invalid")
        self.assertEqual(profile.phone, "+79990000000")
        self.assertEqual(profile.city, "Москва")
        self.assertEqual(str(profile.birth_date), "1985-10-23")
        self.assertEqual(profile.hebrew_birth_date, hebrew_birth_date)
        self.assertEqual(profile.birth_time_context, "after_sunset")
        self.assertEqual(profile.nusach, "ashkenaz")
        self.assertEqual(profile.tribe_status, "israel")
        self.assertEqual(profile.marital_status, "married")
        self.assertEqual(profile.about, "Synthetic profile update")

    async def test_profile_and_membership_updates_remain_separate(self) -> None:
        admin_id = await self._add_admin()
        target_id = await self._add_target()

        profile_response = await self._update_member_profile(
            admin_id,
            target_id,
            first_name="Updated",
        )
        self.assertEqual(profile_response.status_code, 200, profile_response.text)
        membership_response = await self.client.patch(
            f"/admin/members/{target_id}/membership",
            headers=self._headers(admin_id),
            json={
                "community_id": str(self.community_id),
                "role": "member",
                "status": "left",
            },
        )
        self.assertEqual(membership_response.status_code, 200, membership_response.text)

        async with AsyncSessionLocal() as session:
            user = await session.get(AppUser, target_id)
            profile = await session.scalar(select(Profile).where(Profile.user_id == target_id))
            membership = await session.scalar(
                select(CommunityMembership).where(
                    CommunityMembership.user_id == target_id,
                    CommunityMembership.community_id == self.community_id,
                ),
            )
            request_count = await session.scalar(
                select(func.count())
                .select_from(PrivacyRequest)
                .where(PrivacyRequest.user_id == target_id),
            )
        self.assertEqual(user.status, "active")
        self.assertEqual(profile.first_name, "Updated")
        self.assertEqual(membership.status, "left")
        self.assertEqual(request_count, 0)


if __name__ == "__main__":
    unittest.main()
