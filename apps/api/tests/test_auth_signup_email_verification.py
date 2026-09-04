from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta
from unittest.mock import patch
from uuid import UUID, uuid4

import httpx
from sqlalchemy import delete, func, select, update

from app.core.passwords import hash_password
from app.core.rate_limits import RateLimitDecision
from app.core.tokens import create_refresh_token
from app.db.models.auth import AuthEmailVerificationCode, AuthSession
from app.db.models.core import AppUser, Profile
from app.db.session import AsyncSessionLocal, engine
from app.main import app
from app.services import auth as auth_service
from app.services.auth_email_service import AuthEmailDeliveryError
from app.services.auth_tokens import hash_token
from app.services.email_delivery import EmailSendResult

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

    async def _table_counts(self) -> tuple[int, int, int]:
        async with AsyncSessionLocal() as session:
            users = await session.scalar(select(func.count()).select_from(AppUser))
            profiles = await session.scalar(select(func.count()).select_from(Profile))
            codes = await session.scalar(
                select(func.count()).select_from(AuthEmailVerificationCode),
            )
        return users, profiles, codes

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

    async def test_registration_rate_limit_rejection_does_not_persist_anything(
        self,
    ) -> None:
        email = self._email()
        before = await self._table_counts()

        decision = RateLimitDecision(
            allowed=False,
            remaining=0,
            retry_after_seconds=30,
            reset_at=datetime.now(UTC) + timedelta(seconds=30),
        )
        with patch.object(
            auth_service._auth_email_rate_limiter, "consume", return_value=decision,
        ):
            response = await self._post(
                "/auth/register", {"email": email, "password": TEST_PASSWORD},
            )

        self.assertEqual(response.status_code, 429)
        self.assertEqual(await self._table_counts(), before)

    async def test_registration_delivery_disabled_returns_503_and_rolls_back(
        self,
    ) -> None:
        email = self._email()
        before = await self._table_counts()

        with patch(
            "app.services.auth.send_email_verification_email",
            return_value=EmailSendResult(
                sent=False, disabled=True, reason="email_delivery_disabled",
            ),
        ):
            response = await self._post(
                "/auth/register", {"email": email, "password": TEST_PASSWORD},
            )

        self.assertEqual(response.status_code, 503)
        self.assertIn("email_delivery_unavailable", response.text)
        self.assertEqual(await self._table_counts(), before)

    async def test_registration_delivery_error_returns_503_and_rolls_back(
        self,
    ) -> None:
        email = self._email()
        before = await self._table_counts()

        with patch(
            "app.services.auth.send_email_verification_email",
            side_effect=AuthEmailDeliveryError("synthetic provider detail"),
        ):
            response = await self._post(
                "/auth/register", {"email": email, "password": TEST_PASSWORD},
            )

        self.assertEqual(response.status_code, 503)
        self.assertIn("email_delivery_unavailable", response.text)
        self.assertNotIn("synthetic provider detail", response.text)
        self.assertEqual(await self._table_counts(), before)

    async def test_registration_unexpected_send_exception_returns_503_and_rolls_back(
        self,
    ) -> None:
        email = self._email()
        before = await self._table_counts()

        with self.assertLogs("app.services.auth", level="WARNING") as captured:
            with patch(
                "app.services.auth.send_email_verification_email",
                side_effect=ValueError("synthetic template detail"),
            ):
                response = await self._post(
                    "/auth/register", {"email": email, "password": TEST_PASSWORD},
                )

        self.assertEqual(response.status_code, 503)
        self.assertIn("email_delivery_unavailable", response.text)
        self.assertNotIn("synthetic template detail", response.text)
        self.assertEqual(await self._table_counts(), before)

        log_text = "\n".join(captured.output)
        self.assertNotIn("synthetic template detail", log_text)

    async def test_registration_successful_delivery_still_returns_201(self) -> None:
        email = self._email()
        response, user_id, verify_email = await self._register(email)

        self.assertEqual(response.status_code, 201)
        verify_email.assert_called_once()
        user = await self._get_user(user_id)
        self.assertEqual(user.account_origin, "password_signup")
        self.assertIsNone(user.email_verified_at)
        async with AsyncSessionLocal() as session:
            profile = await session.scalar(
                select(Profile).where(Profile.user_id == user_id),
            )
            code_row = await session.scalar(
                select(AuthEmailVerificationCode).where(
                    AuthEmailVerificationCode.user_id == user_id,
                ),
            )
        self.assertIsNotNone(profile)
        self.assertIsNotNone(code_row)

    async def test_resend_delivery_failure_rolls_back_and_preserves_previous_code(
        self,
    ) -> None:
        email = self._email()
        _, user_id, first_send = await self._register(email)
        original_code = first_send.call_args.kwargs["code"]

        with patch(
            "app.services.auth.send_email_verification_email",
            return_value=EmailSendResult(
                sent=False, disabled=True, reason="email_delivery_disabled",
            ),
        ):
            response = await self._post(
                "/auth/request-email-verification", {"email": email},
            )

        # Fail-open on the public response: a resend delivery failure must not
        # be distinguishable from the generic response for an unknown email.
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True})

        user = await self._get_user(user_id)
        self.assertIsNone(user.email_verified_at)

        confirm = await self._post(
            "/auth/confirm-email-verification", {"code": original_code},
        )
        self.assertEqual(confirm.status_code, 200)

    async def test_resend_delivery_failure_matches_unknown_email_response(
        self,
    ) -> None:
        email = self._email()
        _, user_id, first_send = await self._register(email)
        original_code = first_send.call_args.kwargs["code"]

        with self.assertLogs("app.services.auth", level="WARNING"):
            with patch(
                "app.services.auth.send_email_verification_email",
                side_effect=AuthEmailDeliveryError("synthetic detail"),
            ):
                existing_unverified_response = await self._post(
                    "/auth/request-email-verification", {"email": email},
                )

        unknown_response = await self._post(
            "/auth/request-email-verification", {"email": self._email()},
        )

        self.assertEqual(existing_unverified_response.status_code, 200)
        self.assertEqual(unknown_response.status_code, 200)
        self.assertEqual(
            existing_unverified_response.json(), unknown_response.json(),
        )

        # The previously valid code must still confirm despite the failed resend.
        confirm = await self._post(
            "/auth/confirm-email-verification", {"code": original_code},
        )
        self.assertEqual(confirm.status_code, 200)

        user = await self._get_user(user_id)
        self.assertIsNotNone(user.email_verified_at)

    async def test_expired_code_returns_400_and_stays_unverified(self) -> None:
        email = self._email()
        _, user_id, verify_email = await self._register(email)
        code = verify_email.call_args.kwargs["code"]

        past_created = datetime.now(UTC) - timedelta(hours=1)
        past_expiry = past_created + timedelta(minutes=1)
        async with AsyncSessionLocal() as session:
            async with session.begin():
                await session.execute(
                    update(AuthEmailVerificationCode)
                    .where(AuthEmailVerificationCode.user_id == user_id)
                    .values(created_at=past_created, expires_at=past_expiry),
                )

        response = await self._post(
            "/auth/confirm-email-verification", {"code": code},
        )

        self.assertEqual(response.status_code, 400)
        user = await self._get_user(user_id)
        self.assertIsNone(user.email_verified_at)

        login = await self._post(
            "/auth/login", {"email": email, "password": TEST_PASSWORD},
        )
        self.assertEqual(login.status_code, 403)

    async def test_registration_failure_log_safety(self) -> None:
        email = self._email()
        password = "Synthetic-password-log-1"

        with self.assertLogs("app.services.auth", level="WARNING") as captured:
            with patch(
                "app.services.auth.send_email_verification_email",
                side_effect=AuthEmailDeliveryError("synthetic provider detail"),
            ):
                response = await self._post(
                    "/auth/register", {"email": email, "password": password},
                )

        self.assertEqual(response.status_code, 503)
        self.assertNotIn(email, response.text)
        self.assertNotIn(password, response.text)
        self.assertNotIn("synthetic provider detail", response.text)

        log_text = "\n".join(captured.output)
        self.assertNotIn(email, log_text)
        self.assertNotIn(password, log_text)
        self.assertNotIn("synthetic provider detail", log_text)

    async def test_refresh_rejected_for_unverified_password_signup(self) -> None:
        email = self._email()
        _, user_id, _ = await self._register(email)

        raw_refresh_token = create_refresh_token()
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    AuthSession(
                        user_id=user_id,
                        refresh_token_hash=hash_token(raw_refresh_token),
                        expires_at=datetime.now(UTC) + timedelta(days=1),
                    ),
                )

        response = await self._post(
            "/auth/refresh", {"refresh_token": raw_refresh_token},
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"]["message"], "Email not confirmed")


if __name__ == "__main__":
    unittest.main()
