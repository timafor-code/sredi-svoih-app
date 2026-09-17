from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import httpx
from sqlalchemy import delete, select

from app.core.passwords import hash_password, verify_password
from app.core.tokens import create_access_token, create_refresh_token
from app.db.models.auth import AuthSession, AuthSetPasswordCode, PasswordResetCode
from app.db.models.core import AppUser, Community, CommunityMembership
from app.db.session import AsyncSessionLocal, engine
from app.main import app
from app.services.auth_tokens import hash_token


CURRENT_PASSWORD = "Synthetic-current-password-1"
NEW_PASSWORD = "Synthetic-new-password-2"


class AuthChangePasswordApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.marker = uuid4().hex[:12]
        self.now = datetime.now(UTC).replace(microsecond=0)
        self.community_id = uuid4()
        self.user_ids: list[UUID] = []
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
        )
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    Community(
                        id=self.community_id,
                        name="Synthetic password change community",
                        city="Moscow",
                        slug=f"password-change-{self.marker}",
                    ),
                )

    async def asyncTearDown(self) -> None:
        await self.client.aclose()
        try:
            async with AsyncSessionLocal() as session:
                async with session.begin():
                    await session.execute(
                        delete(Community).where(Community.id == self.community_id),
                    )
                    if self.user_ids:
                        await session.execute(
                            delete(AppUser).where(AppUser.id.in_(self.user_ids)),
                        )
        finally:
            await engine.dispose()

    async def _add_user(self, role: str = "admin") -> UUID:
        user_id = uuid4()
        self.user_ids.append(user_id)
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    AppUser(
                        id=user_id,
                        email=f"password-change-{self.marker}-{len(self.user_ids)}@example.invalid",
                        password_hash=hash_password(CURRENT_PASSWORD),
                        account_origin="migration",
                        claim_state="legacy_external",
                        status="active",
                    ),
                )
                session.add(
                    CommunityMembership(
                        id=uuid4(),
                        community_id=self.community_id,
                        user_id=user_id,
                        role=role,
                        status="active",
                        joined_at=self.now,
                    ),
                )
        return user_id

    @staticmethod
    def _headers(user_id: UUID, auth_token_version: int = 0) -> dict[str, str]:
        return {
            "Authorization": (
                "Bearer "
                f"{create_access_token(user_id, auth_token_version=auth_token_version)}"
            ),
        }

    async def _change_password(
        self,
        user_id: UUID,
        payload: dict[str, object],
    ) -> httpx.Response:
        return await self.client.post(
            "/auth/change-password",
            headers=self._headers(user_id),
            json=payload,
        )

    async def _add_existing_credentials(
        self,
        user_id: UUID,
    ) -> tuple[str, list[UUID], list[UUID]]:
        refresh_token = create_refresh_token()
        other_refresh_token = create_refresh_token()
        session_ids = [uuid4(), uuid4()]
        code_ids = [uuid4(), uuid4()]
        expires_at = self.now + timedelta(hours=1)
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add_all(
                    [
                        AuthSession(
                            id=session_ids[0],
                            user_id=user_id,
                            refresh_token_hash=hash_token(refresh_token),
                            expires_at=expires_at,
                            created_at=self.now,
                            updated_at=self.now,
                        ),
                        AuthSession(
                            id=session_ids[1],
                            user_id=user_id,
                            refresh_token_hash=hash_token(other_refresh_token),
                            expires_at=expires_at,
                            created_at=self.now,
                            updated_at=self.now,
                        ),
                        PasswordResetCode(
                            id=code_ids[0],
                            user_id=user_id,
                            code_hash=f"reset-{uuid4().hex}",
                            expires_at=expires_at,
                            created_at=self.now,
                            updated_at=self.now,
                        ),
                        AuthSetPasswordCode(
                            id=code_ids[1],
                            user_id=user_id,
                            code_hash=f"set-password-{uuid4().hex}",
                            expires_at=expires_at,
                            created_at=self.now,
                            updated_at=self.now,
                        ),
                    ],
                )
        return refresh_token, session_ids, code_ids

    async def test_active_admin_changes_password_and_invalidates_credentials(self) -> None:
        user_id = await self._add_user()
        refresh_token, session_ids, code_ids = await self._add_existing_credentials(user_id)
        async with AsyncSessionLocal() as session:
            before = await session.get(AppUser, user_id)
        self.assertIsNotNone(before)
        assert before is not None
        previous_password_hash = before.password_hash

        changed = await self._change_password(
            user_id,
            {
                "current_password": CURRENT_PASSWORD,
                "new_password": NEW_PASSWORD,
            },
        )

        self.assertEqual(changed.status_code, 200, changed.text)
        self.assertEqual(changed.json(), {"ok": True})
        async with AsyncSessionLocal() as session:
            user = await session.get(AppUser, user_id)
            sessions = [await session.get(AuthSession, session_id) for session_id in session_ids]
            reset_code = await session.get(PasswordResetCode, code_ids[0])
            set_password_code = await session.get(AuthSetPasswordCode, code_ids[1])

        self.assertIsNotNone(user)
        assert user is not None
        self.assertNotEqual(user.password_hash, previous_password_hash)
        self.assertTrue(verify_password(NEW_PASSWORD, user.password_hash))
        self.assertFalse(verify_password(CURRENT_PASSWORD, user.password_hash))
        self.assertEqual(user.auth_token_version, 1)
        self.assertTrue(all(item is not None and item.revoked_at is not None for item in sessions))
        self.assertIsNotNone(reset_code)
        self.assertIsNotNone(set_password_code)
        assert reset_code is not None
        assert set_password_code is not None
        self.assertIsNotNone(reset_code.consumed_at)
        self.assertIsNotNone(set_password_code.consumed_at)

        old_access = await self.client.get("/auth/me", headers=self._headers(user_id))
        self.assertEqual(old_access.status_code, 401)
        old_refresh = await self.client.post(
            "/auth/refresh",
            json={"refresh_token": refresh_token},
        )
        self.assertEqual(old_refresh.status_code, 401)

        old_login = await self.client.post(
            "/auth/login",
            json={
                "email": user.email,
                "password": CURRENT_PASSWORD,
            },
        )
        self.assertEqual(old_login.status_code, 401)
        new_login = await self.client.post(
            "/auth/login",
            json={
                "email": user.email,
                "password": NEW_PASSWORD,
            },
        )
        self.assertEqual(new_login.status_code, 200, new_login.text)

    async def test_wrong_current_password_leaves_credentials_unchanged(self) -> None:
        user_id = await self._add_user()
        _, session_ids, code_ids = await self._add_existing_credentials(user_id)
        async with AsyncSessionLocal() as session:
            before = await session.get(AppUser, user_id)
            assert before is not None
            password_hash = before.password_hash
            token_version = before.auth_token_version

        rejected = await self._change_password(
            user_id,
            {
                "current_password": "wrong-current-password",
                "new_password": NEW_PASSWORD,
            },
        )

        self.assertEqual(rejected.status_code, 400)
        async with AsyncSessionLocal() as session:
            user = await session.get(AppUser, user_id)
            sessions = [await session.get(AuthSession, session_id) for session_id in session_ids]
            codes = [
                await session.get(PasswordResetCode, code_ids[0]),
                await session.get(AuthSetPasswordCode, code_ids[1]),
            ]

        self.assertIsNotNone(user)
        assert user is not None
        self.assertEqual(user.password_hash, password_hash)
        self.assertEqual(user.auth_token_version, token_version)
        self.assertTrue(all(item is not None and item.revoked_at is None for item in sessions))
        self.assertTrue(all(item is not None and item.consumed_at is None for item in codes))

    async def test_non_admin_roles_are_forbidden(self) -> None:
        for role in ("event_manager", "rabbi", "member"):
            user_id = await self._add_user(role=role)

            rejected = await self._change_password(
                user_id,
                {
                    "current_password": CURRENT_PASSWORD,
                    "new_password": NEW_PASSWORD,
                },
            )

            self.assertEqual(rejected.status_code, 403, role)
            async with AsyncSessionLocal() as session:
                user = await session.get(AppUser, user_id)
            self.assertIsNotNone(user)
            assert user is not None
            self.assertTrue(verify_password(CURRENT_PASSWORD, user.password_hash))
            self.assertEqual(user.auth_token_version, 0)

    async def test_unauthenticated_request_is_rejected(self) -> None:
        response = await self.client.post(
            "/auth/change-password",
            json={
                "current_password": CURRENT_PASSWORD,
                "new_password": NEW_PASSWORD,
            },
        )

        self.assertEqual(response.status_code, 401)

    async def test_target_user_fields_are_rejected(self) -> None:
        user_id = await self._add_user()
        response = await self._change_password(
            user_id,
            {
                "current_password": CURRENT_PASSWORD,
                "new_password": NEW_PASSWORD,
                "target_user_id": str(uuid4()),
            },
        )

        self.assertEqual(response.status_code, 422)
        async with AsyncSessionLocal() as session:
            user = await session.scalar(select(AppUser).where(AppUser.id == user_id))
        self.assertIsNotNone(user)
        assert user is not None
        self.assertTrue(verify_password(CURRENT_PASSWORD, user.password_hash))
        self.assertEqual(user.auth_token_version, 0)


if __name__ == "__main__":
    unittest.main()
