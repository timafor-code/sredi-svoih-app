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
from app.services import admin_members
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

    async def test_last_admin_guard_rejects_without_destructive_state(self) -> None:
        guarded_community_id = uuid4()
        self.community_ids.append(guarded_community_id)
        target_id = await self._add_user()
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

    async def test_profile_and_membership_updates_remain_separate(self) -> None:
        admin_id = await self._add_admin()
        target_id = await self._add_target()

        profile_response = await self.client.patch(
            f"/admin/members/{target_id}/profile",
            headers=self._headers(admin_id),
            json={
                "community_id": str(self.community_id),
                "first_name": "Updated",
            },
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
