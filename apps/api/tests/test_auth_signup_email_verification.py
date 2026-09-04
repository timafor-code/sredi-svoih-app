from __future__ import annotations

import unittest
from unittest.mock import patch
from uuid import UUID, uuid4

import httpx
from sqlalchemy import delete, select

from app.core.passwords import hash_password
from app.db.models.auth import AuthEmailVerificationCode
from app.db.models.core import AppUser
from app.db.session import AsyncSessionLocal, engine
from app.main import app

# All addresses and credentials in this module are synthetic.
TEST_PASSWORD = "Synthetic-password-1"


class AuthSignupEmailVerificationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.created_user_ids: list[UUID] = []

    async def asyncTearDown(self) -> None:
        try:
            if self.created_user_ids:
                async with AsyncSessionLocal() as session:
                    async with session.begin():
                        await session.execute(
                            delete(AppUser).where(AppUser.id.in_(self.created_user_ids)),
                        )
        finally:
            await engine.dispose()

    def _email(self) -> str:
        return f"signup-verify-{uuid4().hex[:12]}@example.invalid"

    async def _post(self, path: str, json: dict[str, object]) -> httpx.Response:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver",
        ) as client:
            return await client.post(path, json=json)

    async def _register(
        self, email: str, password: str = TEST_PASSWORD,
    ) -> tuple[httpx.Response, UUID, object]:
        with patch("app.services.auth.send_email_verification_email") as verify_email:
            response = await self._post(
                "/auth/register", {"email": email, "password": password},
            )
        self.assertEqual(response.status_code, 201, response.text)
        user_id = UUID(response.json()["user"]["id"])
        self.created_user_ids.append(user_id)
        return response, user_id, verify_email

    async def _get_user(self, user_id: UUID) -> AppUser:
        async with AsyncSessionLocal() as session:
            user = await session.get(AppUser, user_id)
        assert user is not None
        return user

    async def test_register_creates_unverified_password_signup_user(self) -> None:
        email = self._email()
        response, user_id, _ = await self._register(email)

        self.assertIsNone(response.json()["user"]["email_verified_at"])
        user = await self._get_user(user_id)
        self.assertEqual(user.account_origin, "password_signup")
        self.assertIsNone(user.email_verified_at)

    async def test_register_sends_verification_code(self) -> None:
        email = self._email()
        _, _, verify_email = await self._register(email)

        verify_email.assert_called_once()
        self.assertEqual(verify_email.call_args.kwargs["to_address"], email)
        self.assertTrue(verify_email.call_args.kwargs["code"])

    async def test_login_rejected_before_verification(self) -> None:
        email = self._email()
        await self._register(email)

        response = await self._post(
            "/auth/login", {"email": email, "password": TEST_PASSWORD},
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"]["message"], "Email not confirmed")

    async def test_wrong_password_stays_invalid_credentials(self) -> None:
        email = self._email()
        await self._register(email)

        response = await self._post(
            "/auth/login", {"email": email, "password": "wrong-password-1"},
        )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["error"]["message"], "Invalid email or password")

    async def test_invalid_code_does_not_verify(self) -> None:
        email = self._email()
        _, user_id, _ = await self._register(email)

        response = await self._post(
            "/auth/confirm-email-verification", {"code": "not-a-real-code-000000"},
        )

        self.assertEqual(response.status_code, 400)
        user = await self._get_user(user_id)
        self.assertIsNone(user.email_verified_at)

    async def test_valid_code_verifies_and_enables_login(self) -> None:
        email = self._email()
        _, user_id, verify_email = await self._register(email)
        code = verify_email.call_args.kwargs["code"]

        confirm = await self._post("/auth/confirm-email-verification", {"code": code})
        self.assertEqual(confirm.status_code, 200)
        self.assertTrue(confirm.json()["ok"])

        user = await self._get_user(user_id)
        self.assertIsNotNone(user.email_verified_at)

        login = await self._post(
            "/auth/login", {"email": email, "password": TEST_PASSWORD},
        )
        self.assertEqual(login.status_code, 200)
        self.assertTrue(login.json()["access_token"])

    async def test_no_plaintext_code_or_password_persisted(self) -> None:
        email = self._email()
        _, user_id, verify_email = await self._register(email)
        code = verify_email.call_args.kwargs["code"]

        async with AsyncSessionLocal() as session:
            user = await session.get(AppUser, user_id)
            assert user is not None
            self.assertNotEqual(user.password_hash, TEST_PASSWORD)

            stored_code = await session.scalar(
                select(AuthEmailVerificationCode).where(
                    AuthEmailVerificationCode.user_id == user_id,
                ),
            )
        self.assertIsNotNone(stored_code)
        self.assertNotEqual(stored_code.code_hash, code)

    async def test_invite_origin_login_unaffected_by_verification_guard(self) -> None:
        user_id = uuid4()
        email = self._email()
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    AppUser(
                        id=user_id,
                        email=email,
                        password_hash=hash_password(TEST_PASSWORD),
                        account_origin="invite",
                        claim_state="claimed",
                    ),
                )
        self.created_user_ids.append(user_id)

        login = await self._post(
            "/auth/login", {"email": email, "password": TEST_PASSWORD},
        )

        self.assertEqual(login.status_code, 200)

    async def test_resend_still_issues_a_new_code(self) -> None:
        email = self._email()
        _, _, first_send = await self._register(email)

        with patch("app.services.auth.send_email_verification_email") as resend_send:
            resend = await self._post(
                "/auth/request-email-verification", {"email": email},
            )

        self.assertEqual(resend.status_code, 200)
        resend_send.assert_called_once()
        self.assertNotEqual(
            first_send.call_args.kwargs["code"],
            resend_send.call_args.kwargs["code"],
        )


if __name__ == "__main__":
    unittest.main()
