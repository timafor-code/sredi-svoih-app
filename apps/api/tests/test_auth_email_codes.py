from __future__ import annotations

import asyncio
import unittest
from datetime import UTC, datetime
from unittest.mock import patch
from uuid import UUID, uuid4

import httpx
from sqlalchemy import delete, select, text

from app.core.passwords import hash_password
from app.db.models.auth import (
    AuthEmailVerificationCode,
    AuthSetPasswordCode,
    PasswordResetCode,
)
from app.db.models.core import AppUser
from app.db.session import AsyncSessionLocal, engine
from app.main import app
from app.services import auth as auth_service


TEST_PASSWORD = "Synthetic-password-1"
TEST_CODE = "012345"


class AuthEmailCodeTests(unittest.IsolatedAsyncioTestCase):
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
        return f"auth-code-{uuid4().hex[:12]}@example.invalid"

    async def _post(self, path: str, json: dict[str, object]) -> httpx.Response:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            return await client.post(path, json=json)

    async def _create_user(
        self,
        *,
        email: str,
        password_hash: str | None = TEST_PASSWORD,
        email_verified: bool = True,
    ) -> AppUser:
        user = AppUser(
            id=uuid4(),
            email=email,
            password_hash=(hash_password(password_hash) if password_hash else None),
            account_origin="password_signup",
            claim_state="claimed" if password_hash else "unclaimed",
            email_verified_at=datetime.now(UTC) if email_verified else None,
        )
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(user)
        self.created_user_ids.append(user.id)
        return user

    async def _issue_email_code(
        self,
        model: type[AuthEmailVerificationCode]
        | type[PasswordResetCode]
        | type[AuthSetPasswordCode],
        user: AppUser,
    ) -> str:
        with patch.object(auth_service, "_new_manual_email_code", return_value=TEST_CODE):
            async with AsyncSessionLocal() as session:
                return await auth_service._create_auth_code_for_user(
                    session,
                    model,
                    user=user,
                )

    async def _code_row(
        self,
        model: type[AuthEmailVerificationCode]
        | type[PasswordResetCode]
        | type[AuthSetPasswordCode],
        user_id: UUID,
    ) -> AuthEmailVerificationCode | PasswordResetCode | AuthSetPasswordCode:
        async with AsyncSessionLocal() as session:
            row = await session.scalar(select(model).where(model.user_id == user_id))
        assert row is not None
        return row

    async def _code_rows(
        self,
        model: type[AuthEmailVerificationCode]
        | type[PasswordResetCode]
        | type[AuthSetPasswordCode],
        user_id: UUID,
    ) -> list[AuthEmailVerificationCode | PasswordResetCode | AuthSetPasswordCode]:
        async with AsyncSessionLocal() as session:
            return list(
                await session.scalars(
                    select(model)
                    .where(model.user_id == user_id)
                    .order_by(model.created_at),
                ),
            )

    async def test_email_codes_are_six_digits_and_scoped_hashes(self) -> None:
        first = await self._create_user(email=self._email())
        second = await self._create_user(email=self._email())

        verification_code = await self._issue_email_code(AuthEmailVerificationCode, first)
        second_verification_code = await self._issue_email_code(
            AuthEmailVerificationCode,
            second,
        )
        reset_code = await self._issue_email_code(PasswordResetCode, first)
        set_password_code = await self._issue_email_code(AuthSetPasswordCode, second)

        for code in (
            verification_code,
            second_verification_code,
            reset_code,
            set_password_code,
        ):
            self.assertRegex(code, r"^[0-9]{6}$")
        self.assertEqual(verification_code, TEST_CODE)
        self.assertEqual(reset_code, TEST_CODE)
        self.assertEqual(set_password_code, TEST_CODE)

        verification_row = await self._code_row(AuthEmailVerificationCode, first.id)
        second_verification_row = await self._code_row(
            AuthEmailVerificationCode,
            second.id,
        )
        reset_row = await self._code_row(PasswordResetCode, first.id)
        set_password_row = await self._code_row(AuthSetPasswordCode, second.id)
        self.assertNotIn(TEST_CODE, verification_row.code_hash)
        self.assertNotEqual(verification_row.code_hash, second_verification_row.code_hash)
        self.assertNotEqual(verification_row.code_hash, reset_row.code_hash)
        self.assertNotEqual(verification_row.code_hash, set_password_row.code_hash)
        self.assertEqual(verification_row.attempt_count, 0)
        self.assertEqual(reset_row.attempt_count, 0)
        self.assertEqual(set_password_row.attempt_count, 0)

    async def test_wrong_attempts_persist_then_fifth_attempt_burns_code(self) -> None:
        email = self._email()
        user = await self._create_user(email=email)
        code = await self._issue_email_code(AuthEmailVerificationCode, user)

        for expected_attempt_count in range(1, 5):
            response = await self._post(
                "/auth/confirm-email-verification",
                {"email": email, "code": "999999"},
            )
            self.assertEqual(response.status_code, 400)
            row = await self._code_row(AuthEmailVerificationCode, user.id)
            self.assertEqual(row.attempt_count, expected_attempt_count)
            self.assertIsNone(row.consumed_at)

        fifth = await self._post(
            "/auth/confirm-email-verification",
            {"email": email, "code": "999999"},
        )
        self.assertEqual(fifth.status_code, 400)
        exhausted = await self._code_row(AuthEmailVerificationCode, user.id)
        self.assertEqual(exhausted.attempt_count, 5)
        self.assertIsNotNone(exhausted.consumed_at)

        correct_after_exhaustion = await self._post(
            "/auth/confirm-email-verification",
            {"email": email, "code": code},
        )
        self.assertEqual(correct_after_exhaustion.status_code, 400)

    async def test_configured_attempt_limit_burns_code(self) -> None:
        email = self._email()
        user = await self._create_user(email=email)
        settings = auth_service.get_settings().model_copy(
            update={"api_auth_code_max_attempts": 2},
        )
        with patch.object(auth_service, "get_settings", return_value=settings):
            code = await self._issue_email_code(AuthEmailVerificationCode, user)
            first = await self._post(
                "/auth/confirm-email-verification",
                {"email": email, "code": "999999"},
            )
            self.assertEqual(first.status_code, 400)
            second = await self._post(
                "/auth/confirm-email-verification",
                {"email": email, "code": "999999"},
            )
            self.assertEqual(second.status_code, 400)

        exhausted = await self._code_row(AuthEmailVerificationCode, user.id)
        self.assertEqual(exhausted.attempt_count, 2)
        self.assertIsNotNone(exhausted.consumed_at)
        correct_after_exhaustion = await self._post(
            "/auth/confirm-email-verification",
            {"email": email, "code": code},
        )
        self.assertEqual(correct_after_exhaustion.status_code, 400)

    async def test_concurrent_issuance_leaves_one_active_code(self) -> None:
        user = await self._create_user(email=self._email())

        async def issue_in_separate_session() -> str:
            async with AsyncSessionLocal() as session:
                current_user = await session.get(AppUser, user.id)
                assert current_user is not None
                return await auth_service._create_auth_code_for_user(
                    session,
                    AuthEmailVerificationCode,
                    user=current_user,
                )

        codes = await asyncio.gather(
            issue_in_separate_session(),
            issue_in_separate_session(),
        )
        self.assertEqual(len(codes), 2)
        rows = await self._code_rows(AuthEmailVerificationCode, user.id)
        active_rows = [row for row in rows if row.consumed_at is None]
        self.assertEqual(len(active_rows), 1)
        self.assertEqual(active_rows[0].attempt_count, 0)

    async def test_resend_replaces_old_code_and_resets_attempts(self) -> None:
        email = self._email()
        user = await self._create_user(email=email, email_verified=False)
        old_code = await self._issue_email_code(AuthEmailVerificationCode, user)

        with (
            patch.object(
                auth_service,
                "_new_manual_email_code",
                return_value="654321",
            ),
            patch.object(auth_service, "_send_required_email_verification_code"),
        ):
            async with AsyncSessionLocal() as session:
                await auth_service.create_email_verification_code(session, email=email)

        rows = await self._code_rows(AuthEmailVerificationCode, user.id)
        self.assertEqual(len(rows), 2)
        old_row, new_row = rows
        self.assertEqual(old_code, TEST_CODE)
        self.assertIsNotNone(old_row.consumed_at)
        self.assertIsNone(new_row.consumed_at)
        self.assertEqual(new_row.attempt_count, 0)

        for expected_attempt_count in range(1, 6):
            attempted_code = old_code if expected_attempt_count == 1 else "999999"
            response = await self._post(
                "/auth/confirm-email-verification",
                {"email": email, "code": attempted_code},
            )
            self.assertEqual(response.status_code, 400)
            new_row = next(
                row
                for row in await self._code_rows(AuthEmailVerificationCode, user.id)
                if row.id == new_row.id
            )
            self.assertEqual(new_row.attempt_count, expected_attempt_count)

        self.assertIsNotNone(new_row.consumed_at)

    async def test_migration_adds_attempt_metadata_and_direct_handoff_index(self) -> None:
        code_tables = (
            "auth_email_verification_codes",
            "password_reset_codes",
            "auth_set_password_codes",
        )
        async with AsyncSessionLocal() as session:
            for table_name in code_tables:
                has_attempt_count = await session.scalar(
                    text(
                        """
                        SELECT EXISTS (
                            SELECT 1
                            FROM information_schema.columns
                            WHERE table_schema = current_schema()
                              AND table_name = :table_name
                              AND column_name = 'attempt_count'
                        )
                        """,
                    ),
                    {"table_name": table_name},
                )
                self.assertTrue(has_attempt_count)
                has_attempt_check = await session.scalar(
                    text(
                        """
                        SELECT EXISTS (
                            SELECT 1
                            FROM pg_constraint
                            WHERE conname = :constraint_name
                        )
                        """,
                    ),
                    {"constraint_name": f"{table_name}_attempt_count_check"},
                )
                self.assertTrue(has_attempt_check)

            has_direct_handoff_index = await session.scalar(
                text(
                    """
                    SELECT to_regclass('auth_set_password_codes_code_hash_idx')
                        IS NOT NULL
                    """,
                ),
            )
        self.assertTrue(has_direct_handoff_index)

    async def test_email_confirmation_is_bound_to_email_and_consumes_code(self) -> None:
        email = self._email()
        user = await self._create_user(email=email)
        code = await self._issue_email_code(AuthEmailVerificationCode, user)

        wrong_email = await self._post(
            "/auth/confirm-email-verification",
            {"email": self._email(), "code": code},
        )
        self.assertEqual(wrong_email.status_code, 400)

        correct = await self._post(
            "/auth/confirm-email-verification",
            {"email": email, "code": code},
        )
        self.assertEqual(correct.status_code, 200)
        replay = await self._post(
            "/auth/confirm-email-verification",
            {"email": email, "code": code},
        )
        self.assertEqual(replay.status_code, 400)

    async def test_password_reset_and_emailed_set_password_require_email(self) -> None:
        reset_email = self._email()
        reset_user = await self._create_user(email=reset_email)
        reset_code = await self._issue_email_code(PasswordResetCode, reset_user)
        reset = await self._post(
            "/auth/confirm-password-reset",
            {
                "email": reset_email,
                "code": reset_code,
                "new_password": "Synthetic-password-2",
            },
        )
        self.assertEqual(reset.status_code, 200)

        set_password_email = self._email()
        set_password_user = await self._create_user(
            email=set_password_email,
            password_hash=None,
        )
        set_password_code = await self._issue_email_code(
            AuthSetPasswordCode,
            set_password_user,
        )
        no_email = await self._post(
            "/auth/confirm-set-password",
            {"code": set_password_code, "new_password": "Synthetic-password-2"},
        )
        self.assertEqual(no_email.status_code, 422)
        emailed = await self._post(
            "/auth/confirm-set-password",
            {
                "email": set_password_email,
                "code": set_password_code,
                "new_password": "Synthetic-password-2",
            },
        )
        self.assertEqual(emailed.status_code, 200)

    async def test_direct_set_password_handoff_remains_opaque_and_works(self) -> None:
        user = await self._create_user(email=self._email(), password_hash=None)
        async with AsyncSessionLocal() as session:
            async with session.begin():
                code, _ = await auth_service.issue_set_password_handoff(
                    session,
                    user=user,
                )

        self.assertGreaterEqual(len(code), 16)
        self.assertNotRegex(code, r"^[0-9]{6}$")
        response = await self._post(
            "/auth/confirm-set-password",
            {"code": code, "new_password": "Synthetic-password-2"},
        )
        self.assertEqual(response.status_code, 200)


if __name__ == "__main__":
    unittest.main()
