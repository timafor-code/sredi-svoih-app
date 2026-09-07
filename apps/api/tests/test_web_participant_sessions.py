from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import httpx
from sqlalchemy import delete, select

from app.core.tokens import create_access_token
from app.db.models.core import AppUser, Profile, WebParticipantSession
from app.db.session import AsyncSessionLocal, engine
from app.main import app
from app.services import privacy_erasure
from app.services import web_participant_sessions as service
from app.services.auth_tokens import hash_token


class WebParticipantSessionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.marker = uuid4().hex[:12]
        self.user_id = uuid4()
        self.email = f"remembered-{self.marker}@example.invalid"
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    AppUser(
                        id=self.user_id,
                        email=self.email,
                        phone=f"+7900{int(self.marker[:8], 16) % 10**7:07d}",
                        password_hash="stored-password-hash",
                        account_origin="password_signup",
                        claim_state="claimed",
                        status="active",
                        email_verified_at=datetime.now(UTC),
                    ),
                )
                session.add(
                    Profile(
                        user_id=self.user_id,
                        first_name="Каноническое",
                        last_name="Имя",
                        full_name="Каноническое Имя",
                        display_name="Каноническое Имя",
                        email=self.email,
                        phone=f"+7900{int(self.marker[:8], 16) % 10**7:07d}",
                    ),
                )

    async def asyncTearDown(self) -> None:
        async with AsyncSessionLocal() as session:
            async with session.begin():
                await session.execute(delete(AppUser).where(AppUser.id == self.user_id))
        await engine.dispose()

    async def _issue(self) -> service.IssuedWebParticipantSession:
        async with AsyncSessionLocal() as session:
            user = await session.get(AppUser, self.user_id)
            issued = await service.issue(session, user=user)
            await session.commit()
            return issued

    async def test_hash_only_resolution_and_current_browser_delete(self) -> None:
        issued = await self._issue()
        async with AsyncSessionLocal() as session:
            row = await session.scalar(select(WebParticipantSession))
            self.assertNotEqual(row.token_hash, issued.token)
            self.assertNotIn(issued.token, row.token_hash)

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            anonymous = await client.get("/web/participant-session")
            self.assertEqual(anonymous.status_code, 200)
            self.assertEqual(anonymous.json()["data"], {"state": "anonymous", "participant": None})

            client.cookies.set(service.COOKIE_NAME, issued.token)
            remembered = await client.get("/web/participant-session")
            self.assertEqual(remembered.status_code, 200)
            self.assertEqual(
                remembered.json()["data"],
                {
                    "state": "remembered",
                    "participant": {
                        "first_name": "Каноническое",
                        "last_name": "Имя",
                        "phone": f"+7900{int(self.marker[:8], 16) % 10**7:07d}",
                        "email": self.email,
                    },
                },
            )
            deleted = await client.delete("/web/participant-session")
            self.assertEqual(deleted.status_code, 204)
            self.assertIn("HttpOnly", deleted.headers["set-cookie"])
            self.assertIn("SameSite=lax", deleted.headers["set-cookie"])
            self.assertIn("Path=/", deleted.headers["set-cookie"])

        async with AsyncSessionLocal() as session:
            row = await session.scalar(select(WebParticipantSession))
            self.assertIsNotNone(row.revoked_at)

    async def test_expired_revoked_and_unavailable_users_fail_closed(self) -> None:
        expired = await self._issue()
        revoked = await self._issue()
        inactive = await self._issue()
        async with AsyncSessionLocal() as session:
            expired_row = await session.scalar(
                select(WebParticipantSession).where(
                    WebParticipantSession.token_hash == hash_token(expired.token),
                ),
            )
            revoked_row = await session.scalar(
                select(WebParticipantSession).where(
                    WebParticipantSession.token_hash == hash_token(revoked.token),
                ),
            )
            expired_row.created_at = datetime.now(UTC) - timedelta(days=2)
            expired_row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
            revoked_row.revoked_at = datetime.now(UTC)
            await session.commit()

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            for token in (expired.token, revoked.token):
                client.cookies.set(service.COOKIE_NAME, token)
                response = await client.get("/web/participant-session")
                self.assertEqual(response.json()["data"]["state"], "anonymous")
            async with AsyncSessionLocal() as session:
                user = await session.get(AppUser, self.user_id)
                user.status = "inactive"
                await session.commit()
            client.cookies.set(service.COOKIE_NAME, inactive.token)
            response = await client.get("/web/participant-session")
            self.assertEqual(response.json()["data"]["state"], "anonymous")

    async def test_multiple_sessions_and_privacy_revocation_are_independent(self) -> None:
        first = await self._issue()
        second = await self._issue()
        async with AsyncSessionLocal() as session:
            await service.revoke_current(session, token=first.token)
        async with AsyncSessionLocal() as session:
            self.assertIsNone(await service.resolve(session, token=first.token))
            self.assertIsNotNone(await service.resolve(session, token=second.token))
        async with AsyncSessionLocal() as session:
            await privacy_erasure._revoke_credentials(
                session,
                user_id=self.user_id,
                now=datetime.now(UTC),
            )
            await session.commit()
        async with AsyncSessionLocal() as session:
            rows = list(await session.scalars(select(WebParticipantSession)))
            self.assertTrue(all(row.revoked_at is not None for row in rows))

    async def test_authenticated_web_issuance_sets_cookie_without_account_bearer_access(self) -> None:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            issued = await client.post(
                "/web/participant-session",
                headers={"Authorization": f"Bearer {create_access_token(self.user_id)}"},
            )
            self.assertEqual(issued.status_code, 200)
            cookie = issued.headers["set-cookie"]
            self.assertIn("HttpOnly", cookie)
            self.assertIn("SameSite=lax", cookie)
            self.assertIn("Path=/", cookie)
            self.assertNotIn("Каноническое", issued.text)
            no_bearer_access = await client.get("/auth/me")
            self.assertEqual(no_bearer_access.status_code, 401)
