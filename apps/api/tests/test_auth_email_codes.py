from __future__ import annotations

import asyncio
import hashlib
import logging
import unittest
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import httpx
from sqlalchemy import delete, select, text

from app.core.passwords import hash_password
from app.core.config import Settings
from app.db.models.auth import (
    AuthEmailVerificationCode,
    AuthSession,
    AuthSetPasswordCode,
    PasswordResetCode,
)
from app.db.models.core import (
    AppUser,
    Community,
    Event,
    EventCategory,
    EventRegistration,
    Profile,
    WebParticipantSession,
)
from app.db.session import AsyncSessionLocal, engine
from app.main import app
from app.services import auth as auth_service
from app.services import auth_email_service
from app.services import web_participant_sessions
from app.services.auth_email_service import AuthEmailDeliveryError
from app.services.auth_email_templates import render_account_created_email
from app.services.auth_tokens import hash_token
from app.services.email_delivery import EmailSendResult
from app.services.transactional_email_branding import (
    render_branded_informational_html,
)


TEST_PASSWORD = "Synthetic-password-1"
TEST_CODE = "012345"


class AuthEmailCodeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.created_user_ids: list[UUID] = []
        self.created_community_ids: list[UUID] = []

    async def asyncTearDown(self) -> None:
        try:
            if self.created_user_ids:
                async with AsyncSessionLocal() as session:
                    async with session.begin():
                        await session.execute(
                            delete(AppUser).where(AppUser.id.in_(self.created_user_ids)),
                        )
                        if self.created_community_ids:
                            await session.execute(
                                delete(Community).where(
                                    Community.id.in_(self.created_community_ids),
                                ),
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
        email = self._email()
        user = await self._create_user(email=email, password_hash=None)
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(Profile(user_id=user.id, first_name="Иван"))
        async with AsyncSessionLocal() as session:
            async with session.begin():
                code, _ = await auth_service.issue_set_password_handoff(
                    session,
                    user=user,
                )

        self.assertGreaterEqual(len(code), 16)
        self.assertNotRegex(code, r"^[0-9]{6}$")
        with patch.object(auth_service, "send_account_created_email") as sender:
            response = await self._post(
                "/auth/confirm-set-password",
                {"code": code, "new_password": "Synthetic-password-2"},
            )
        self.assertEqual(response.status_code, 200)
        sender.assert_called_once_with(to_address=email, first_name="Иван")

    def test_account_created_email_template_and_sender_are_branded_and_safe(self) -> None:
        first_name = "  Ирина <Иванова>  "
        handoff_code = "opaque-handoff-secret"
        password = "Synthetic-password-2"
        rendered = render_account_created_email(first_name=first_name)
        unnamed = render_account_created_email(first_name="   ")

        self.assertEqual(rendered.subject, "Ваш аккаунт «Среди своих» создан")
        self.assertIn("Здравствуйте, Ирина <Иванова>!", rendered.text_body)
        self.assertIn("Здравствуйте, Ирина &lt;Иванова&gt;!", rendered.html_body)
        self.assertIn("Здравствуйте! Вы задали пароль", unnamed.text_body)
        self.assertEqual(
            rendered.text_body,
            "Ваш аккаунт «Среди своих» создан\n\n"
            "Здравствуйте, Ирина <Иванова>! Вы задали пароль и завершили создание аккаунта.\n\n"
            "Вход по email и паролю\n"
            "Используйте адрес, на который пришло это письмо, и пароль, который вы только что задали.\n\n"
            "Регистрации уже в аккаунте\n"
            "Ваши уже созданные регистрации на мероприятия остаются привязаны к этому аккаунту.\n\n"
            "Как удалить свои данные\n"
            "Это можно сделать самостоятельно, без обращения в поддержку.\n"
            "1. Войдите в аккаунт на странице мероприятия «Среди своих» — кнопка «Войти».\n"
            "2. Откройте «Управление аккаунтом» и выберите «Удалить аккаунт». В мобильном приложении — в профиле.\n"
            "3. Подтвердите email кодом из письма.\n"
            "4. Подтвердите удаление.\n\n"
            "Что происходит после подтверждения\n"
            "Доступ к аккаунту прекращается; дальнейшее удаление данных выполняется по установленной процедуре. Если отдельные сведения должны временно сохраняться по закону, это не сохраняет активный аккаунт и возможность входа.\n\n"
            "Это транзакционное уведомление, а не маркетинговая рассылка.\n\n"
            "«Среди своих» — автоматическое письмо, отвечать на него не нужно.",
        )
        for body in (rendered.text_body, rendered.html_body):
            block_positions = [
                body.index("Ваш аккаунт «Среди своих» создан"),
                body.index("Здравствуйте,"),
                body.index("Вход по email и паролю"),
                body.index("Регистрации уже в аккаунте"),
                body.index("Как удалить свои данные"),
                body.index("Подтвердите удаление"),
                body.index("Что происходит после подтверждения"),
                body.index("Это транзакционное уведомление"),
                body.index("«Среди своих» — автоматическое письмо"),
            ]
            self.assertEqual(block_positions, sorted(block_positions))
            self.assertNotIn("http://", body)
            self.assertNotIn("https://", body)
            self.assertNotIn(handoff_code, body)
            self.assertNotIn(password, body)
            self.assertNotRegex(body, r"\b\d{6}\b")
        self.assertEqual(rendered.html_body.count("<img"), 1)
        self.assertIn('src="cid:sredi-svoih-logo"', rendered.html_body)
        self.assertNotIn("{", rendered.html_body)
        self.assertNotIn("}", rendered.html_body)
        self.assertIn("max-width:560px", rendered.html_body)

        with patch.object(
            auth_email_service,
            "send_email",
            return_value=EmailSendResult(sent=True, disabled=False),
        ) as send:
            result = auth_email_service.send_account_created_email(
                to_address="account-created@example.invalid",
                first_name="Ирина",
                settings=Settings(api_email_enabled=False),
            )
        message = send.call_args.args[0]
        self.assertTrue(result.sent)
        self.assertEqual(message.html_body, render_account_created_email(first_name="Ирина").html_body)
        self.assertEqual(len(message.inline_images), 1)
        self.assertEqual(message.inline_images[0].content_id, "sredi-svoih-logo")

    def test_informational_html_without_sections_is_byte_stable(self) -> None:
        rendered = render_branded_informational_html(
            heading="Уведомление",
            paragraphs=("Первый абзац.", "Второй абзац."),
            preheader="Первый абзац.",
        )
        self.assertEqual(
            hashlib.sha256(rendered.encode()).hexdigest(),
            "f0310e1db7cdd7941bc957e46c810a01a0c9127959974ab16c8332ae2ced9bc8",
        )

    async def test_account_created_delivery_failure_preserves_password_and_redacts_log(self) -> None:
        email = self._email()
        user = await self._create_user(email=email, password_hash=None)
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(Profile(user_id=user.id, first_name="Секретное имя"))
        async with AsyncSessionLocal() as session:
            async with session.begin():
                code, _ = await auth_service.issue_set_password_handoff(session, user=user)

        with (
            patch.object(
                auth_service,
                "send_account_created_email",
                side_effect=AuthEmailDeliveryError("synthetic"),
            ),
            self.assertLogs("app.services.auth", level=logging.WARNING) as captured,
        ):
            response = await self._post(
                "/auth/confirm-set-password",
                {"code": code, "new_password": "Synthetic-password-2"},
            )
        self.assertEqual(response.status_code, 200)
        async with AsyncSessionLocal() as session:
            stored = await session.get(AppUser, user.id)
        self.assertIsNotNone(stored.password_hash)
        self.assertEqual(stored.claim_state, "claimed")
        warnings = "\n".join(captured.output)
        self.assertIn("account_created", warnings)
        self.assertNotIn(email, warnings)
        self.assertNotIn("Секретное имя", warnings)

    async def test_account_created_email_is_not_sent_for_other_password_flows(self) -> None:
        reset_email = self._email()
        reset_user = await self._create_user(email=reset_email)
        reset_code = await self._issue_email_code(PasswordResetCode, reset_user)
        set_password_email = self._email()
        set_password_user = await self._create_user(
            email=set_password_email,
            password_hash=None,
        )
        set_password_code = await self._issue_email_code(
            AuthSetPasswordCode,
            set_password_user,
        )
        with patch.object(auth_service, "send_account_created_email") as sender:
            reset = await self._post(
                "/auth/confirm-password-reset",
                {
                    "email": reset_email,
                    "code": reset_code,
                    "new_password": "Synthetic-password-2",
                },
            )
            emailed = await self._post(
                "/auth/confirm-set-password",
                {
                    "email": set_password_email,
                    "code": set_password_code,
                    "new_password": "Synthetic-password-2",
                },
            )
        self.assertEqual(reset.status_code, 200)
        self.assertEqual(emailed.status_code, 200)
        sender.assert_not_called()

        async with AsyncSessionLocal() as session:
            current_user = await session.get(AppUser, reset_user.id)
            assert current_user is not None
            with (
                patch.object(auth_service, "send_account_created_email") as sender,
                patch.object(
                    auth_service.authorization_service,
                    "require_active_admin_membership",
                    new_callable=AsyncMock,
                ),
            ):
                await auth_service.change_password(
                    session,
                    current_user=current_user,
                    current_password="Synthetic-password-2",
                    new_password="Synthetic-password-3",
                )
        sender.assert_not_called()

    async def test_direct_set_password_handoff_replay_sends_once(self) -> None:
        user = await self._create_user(email=self._email(), password_hash=None)
        async with AsyncSessionLocal() as session:
            async with session.begin():
                code, _ = await auth_service.issue_set_password_handoff(session, user=user)
        with patch.object(auth_service, "send_account_created_email") as sender:
            first = await self._post(
                "/auth/confirm-set-password",
                {"code": code, "new_password": "Synthetic-password-2"},
            )
            replay = await self._post(
                "/auth/confirm-set-password",
                {"code": code, "new_password": "Synthetic-password-2"},
            )
        self.assertEqual(first.status_code, 200)
        self.assertNotEqual(replay.status_code, 200)
        self.assertEqual(sender.call_count, 1)

    async def test_set_password_revokes_remembered_sessions_and_clears_cookie(self) -> None:
        email = self._email()
        user = await self._create_user(email=email, password_hash=None)
        async with AsyncSessionLocal() as session:
            current_user = await session.get(AppUser, user.id)
            assert current_user is not None
            issued = await web_participant_sessions.issue(session, user=current_user)
            await session.commit()
        code = await self._issue_email_code(AuthSetPasswordCode, user)
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            client.cookies.set(web_participant_sessions.COOKIE_NAME, issued.token)
            response = await client.post(
                "/auth/confirm-set-password",
                json={"email": email, "code": code, "new_password": "Synthetic-password-2"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertIn("HttpOnly", response.headers["set-cookie"])
        async with AsyncSessionLocal() as session:
            current_user = await session.get(AppUser, user.id)
            row = await session.scalar(
                select(WebParticipantSession).where(
                    WebParticipantSession.token_hash == hash_token(issued.token),
                ),
            )
        self.assertIsNotNone(current_user.password_hash)
        self.assertIsNotNone(row.revoked_at)

    async def test_logout_revokes_auth_and_remembered_sessions_and_clears_cookie(self) -> None:
        user = await self._create_user(email=self._email(), password_hash=None)
        community_id = uuid4()
        event_id = uuid4()
        self.created_community_ids.append(community_id)
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(Community(id=community_id, name="Logout test", city="Moscow"))
                session.add(EventCategory(
                    community_id=community_id,
                    slug="community",
                    title="Community",
                    color="#123456",
                    icon="*",
                ))
                await session.flush()
                session.add(Event(
                    id=event_id,
                    community_id=community_id,
                    title="Logout test event",
                    starts_at=datetime.now(UTC) + timedelta(days=1),
                    category="community",
                ))
                session.add(Profile(user_id=user.id, first_name="Existing", last_name="User"))
        async with AsyncSessionLocal() as session:
            current_user = await session.get(AppUser, user.id)
            assert current_user is not None
            remembered = await web_participant_sessions.issue(session, user=current_user)
            # Construct a legacy stale state: issuance predates the password.
            current_user.password_hash = hash_password(TEST_PASSWORD)
            current_user.claim_state = "claimed"
            current_user.claimed_at = datetime.now(UTC)
            await session.commit()
        async with AsyncSessionLocal() as session:
            async with session.begin():
                registration = EventRegistration(
                    event_id=event_id,
                    user_id=user.id,
                    status="confirmed",
                    source_channel="public_web",
                    seats_count=1,
                    guest_names=[],
                    payment_status="not_required",
                )
                session.add(registration)
                await session.flush()
                registration_id = registration.id
        async with AsyncSessionLocal() as session:
            tokens = await auth_service.login_password_user(
                session,
                email=user.email,
                password=TEST_PASSWORD,
            )
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            client.cookies.set(web_participant_sessions.COOKIE_NAME, remembered.token)
            response = await client.post("/auth/logout", json={"refresh_token": tokens.refresh_token})
            after = await client.get("/web/participant-session")
        self.assertEqual(response.status_code, 200)
        self.assertIn("HttpOnly", response.headers["set-cookie"])
        self.assertIn("Max-Age=0", response.headers["set-cookie"])
        self.assertEqual(after.json()["data"], {"state": "anonymous", "participant": None})
        async with AsyncSessionLocal() as session:
            auth_row = await session.scalar(
                select(AuthSession).where(AuthSession.user_id == user.id),
            )
            remembered_row = await session.scalar(
                select(WebParticipantSession).where(
                    WebParticipantSession.token_hash == hash_token(remembered.token),
                ),
            )
            surviving_user = await session.get(AppUser, user.id)
            surviving_profile = await session.scalar(
                select(Profile).where(Profile.user_id == user.id),
            )
            surviving_registration = await session.get(EventRegistration, registration_id)
        self.assertIsNotNone(auth_row.revoked_at)
        self.assertIsNotNone(remembered_row.revoked_at)
        self.assertIsNotNone(surviving_user)
        self.assertIsNotNone(surviving_profile)
        self.assertIsNotNone(surviving_registration)


if __name__ == "__main__":
    unittest.main()
