from __future__ import annotations

import smtplib
import unittest
from email import policy
from email.message import EmailMessage as StdlibEmailMessage
from email.parser import BytesParser
from io import BytesIO
from unittest.mock import patch

import httpx
import pytest
from PIL import Image
from sqlalchemy import func, select

from app.core.config import Settings
from app.db.models.auth import WebRegistrationVerificationCode
from app.db.models.core import WebRegistrationIntent
from app.db.session import AsyncSessionLocal
from app.main import app
from app.services import auth_email_service, privacy_email_service
from app.services import email_delivery as delivery
from app.services import web_registration_email_service as service
from app.services.web_registration_email_templates import (
    render_registration_result_email,
    render_verification_code_email,
)
from tests import test_web_registration_email_finalize as finalize_tests


# All addresses, codes, and credentials in this module are synthetic.
TEST_CODE = "123456"
TEST_ADDRESS = "email-test@example.invalid"


@pytest.fixture(autouse=True)
def smtp_transport():
    with patch.object(delivery.smtplib, "SMTP") as transport:
        yield transport


def email_settings(**overrides) -> Settings:
    return Settings(
        _env_file=None,
        **{
            "api_email_enabled": True,
            "api_email_from_address": "sender@example.invalid",
            "api_email_from_name": "Synthetic sender",
            "api_email_smtp_host": "smtp.example.invalid",
            "api_email_smtp_port": 587,
            "api_email_smtp_starttls": True,
            "api_email_smtp_username": "synthetic-user",
            "api_email_smtp_password": "synthetic-password",
            **overrides,
        },
    )


def test_text_only_payload_is_unchanged(smtp_transport):
    settings = email_settings()
    message = delivery.EmailMessage(
        to_address=TEST_ADDRESS,
        to_name="Synthetic recipient",
        subject="Тестовое письмо",
        text_body="Текст письма\nВторая строка",
        reply_to="reply@example.invalid",
    )
    legacy = StdlibEmailMessage()
    legacy["From"] = delivery._format_address(
        settings.api_email_from_address, settings.api_email_from_name,
    )
    legacy["To"] = delivery._format_address(message.to_address, message.to_name)
    legacy["Subject"] = message.subject
    legacy["Message-ID"] = "<synthetic@example.invalid>"
    legacy["Reply-To"] = message.reply_to
    legacy.set_content(message.text_body)

    with patch.object(delivery, "make_msgid", return_value=legacy["Message-ID"]):
        result = delivery.send_email(message, settings=settings)
    smtp = smtp_transport.return_value.__enter__.return_value
    sent = smtp.send_message.call_args.args[0]
    assert sent.as_bytes() == legacy.as_bytes()
    assert not sent.is_multipart()
    assert result.sent and not result.disabled
    smtp_transport.assert_called_once_with("smtp.example.invalid", 587, timeout=10)
    smtp.starttls.assert_called_once()
    smtp.login.assert_called_once_with("synthetic-user", "synthetic-password")


def test_disabled_delivery_does_not_open_smtp(smtp_transport):
    result = delivery.send_email(
        delivery.EmailMessage(TEST_ADDRESS, "Synthetic", "Plain fallback"),
        settings=email_settings(api_email_enabled=False),
    )
    assert result.disabled and not result.sent
    smtp_transport.assert_not_called()


def test_html_cid_mime_survives_serialization(smtp_transport):
    rendered = render_verification_code_email(code=TEST_CODE, expiration_minutes=7)
    result = service.send_web_registration_verification_code(
        to_address=TEST_ADDRESS, code=TEST_CODE, expiration_minutes=7,
        settings=email_settings(),
    )
    sent = smtp_transport.return_value.__enter__.return_value.send_message.call_args.args[0]
    parsed = BytesParser(policy=policy.default).parsebytes(sent.as_bytes())
    assert result.sent
    assert parsed.get_content_type() == "multipart/alternative"
    plain, related = list(parsed.iter_parts())
    assert plain.get_content_type() == "text/plain"
    assert plain.get_content() == rendered.text_body + "\n"
    assert related.get_content_type() == "multipart/related"
    html, logo = list(related.iter_parts())
    assert html.get_content_type() == "text/html"
    assert html.get_content() == rendered.html_body
    assert 'src="cid:sredi-svoih-logo"' in html.get_content()
    assert logo.get_content_type() == "image/png"
    assert logo["Content-ID"] == "<sredi-svoih-logo>"
    assert logo.get_content_disposition() == "inline"
    assert logo.get_filename() is None
    assert logo.get_payload(decode=True) == service._load_verification_logo()
    assert all(part.get_content_disposition() != "attachment" for part in parsed.walk())


def test_html_without_images_and_mandatory_plain_fallback():
    message = delivery.EmailMessage(
        TEST_ADDRESS, "Synthetic", "Plain fallback", html_body="<p>HTML</p>",
    )
    built = delivery._build_stdlib_message(message, email_settings())
    assert [part.get_content_type() for part in built.iter_parts()] == [
        "text/plain", "text/html",
    ]
    with pytest.raises(delivery.EmailConfigurationError, match="text body"):
        delivery._build_stdlib_message(
            delivery.EmailMessage(TEST_ADDRESS, "Synthetic", "", html_body="<p>HTML</p>"),
            email_settings(),
        )
    with pytest.raises(delivery.EmailConfigurationError, match="require an HTML body"):
        delivery._build_stdlib_message(
            delivery.EmailMessage(
                TEST_ADDRESS, "Synthetic", "Plain fallback",
                inline_images=(delivery.InlineEmailImage(b"synthetic", "png", "test"),),
            ),
            email_settings(),
        )


@pytest.mark.parametrize("minutes", [7, 30])
def test_verification_copy_has_dynamic_code_and_ttl_without_remote_resources(minutes):
    rendered = render_verification_code_email(code=TEST_CODE, expiration_minutes=minutes)
    assert rendered.text_body == "\n".join((
        "Используйте этот код, чтобы подтвердить регистрацию на мероприятие:",
        "", TEST_CODE, "", f"Код действует {minutes} минут.",
        "Никому не передавайте этот код.",
        "Если вы не отправляли форму регистрации, проигнорируйте это письмо.",
    ))
    html = rendered.html_body
    assert TEST_CODE in html
    assert f"Код действует {minutes} минут." in html
    assert f">{minutes} минут</span>" in html
    assert "15 минут" not in html
    for forbidden in ("http://", "https://", "<script", "<link", "<style", "<a ", "url("):
        assert forbidden not in html.lower()
    assert 'name="color-scheme" content="light"' in html
    assert 'width="560"' in html
    assert "display:none; max-height:0; overflow:hidden; mso-hide:all;" in html


def test_verification_code_is_html_escaped():
    rendered = render_verification_code_email(code="<synthetic&>", expiration_minutes=7)
    assert "&lt;synthetic&amp;&gt;" in rendered.html_body
    assert "<synthetic&>" not in rendered.html_body


def test_service_passes_html_and_cached_png_to_generic_mailer():
    service._load_verification_logo.cache_clear()
    try:
        with patch.object(service.Path, "read_bytes", autospec=True, return_value=b"png") as read:
            with patch.object(service, "send_email", return_value=delivery.EmailSendResult(True, False)) as send:
                for _ in range(2):
                    service.send_web_registration_verification_code(
                        to_address=TEST_ADDRESS, code=TEST_CODE, expiration_minutes=7,
                        settings=email_settings(),
                    )
                message = send.call_args.args[0]
            read.assert_called_once()
            assert read.call_args.args[0].as_posix().endswith("/app/assets/email/logo.png")
        assert message.html_body == render_verification_code_email(
            code=TEST_CODE, expiration_minutes=7,
        ).html_body
        assert message.inline_images == (
            delivery.InlineEmailImage(b"png", "png", "sredi-svoih-logo"),
        )
    finally:
        service._load_verification_logo.cache_clear()


def test_committed_logo_is_small_transparent_png():
    with Image.open(BytesIO(service._load_verification_logo())) as logo:
        assert logo.format == "PNG"
        assert logo.size == (200, 80)
        assert logo.mode == "RGBA"
        assert logo.getextrema()[3][0] == 0
        assert logo.getextrema()[3][1] == 255


@pytest.mark.parametrize("status", ["confirmed", "pending"])
def test_registration_result_stays_text_only(status):
    with patch.object(service, "_load_verification_logo") as read:
        with patch.object(service, "send_email", return_value=delivery.EmailSendResult(True, False)) as send:
            service.send_web_registration_result(
                to_address=TEST_ADDRESS, registration_status=status, settings=email_settings(),
            )
        read.assert_not_called()
    message = send.call_args.args[0]
    assert message.html_body is None
    assert message.inline_images == ()
    assert message.text_body == render_registration_result_email(
        registration_status=status,
    ).text_body


@pytest.mark.parametrize("sender", [
    auth_email_service.send_email_verification_email,
    auth_email_service.send_password_reset_email,
    auth_email_service.send_set_password_email,
    privacy_email_service.send_privacy_access_code,
])
def test_auth_and_privacy_callers_stay_text_only(sender, smtp_transport):
    sender(
        to_address=TEST_ADDRESS, code=TEST_CODE, expiration_minutes=7,
        settings=email_settings(),
    )
    sent = smtp_transport.return_value.__enter__.return_value.send_message.call_args.args[0]
    assert sent.get_content_type() == "text/plain"
    assert not sent.is_multipart()


@pytest.mark.parametrize("target,error", [
    ("render_verification_code_email", ValueError("synthetic formatting detail")),
    ("_load_verification_logo", FileNotFoundError("synthetic filesystem detail")),
    ("_load_verification_logo", PermissionError("synthetic filesystem detail")),
])
def test_formatting_and_logo_failures_stay_inside_delivery_boundary(target, error, smtp_transport):
    with patch.object(service, target, side_effect=error):
        with pytest.raises(service.WebRegistrationEmailDeliveryError) as caught:
            service.send_web_registration_verification_code(
                to_address=TEST_ADDRESS, code=TEST_CODE, expiration_minutes=7,
                settings=email_settings(),
            )
    assert str(caught.value) == "Web registration email delivery failed"
    smtp_transport.assert_not_called()


@pytest.mark.parametrize("failure", ["mime", "auth", "send", "disabled"])
def test_transport_failures_stay_inside_delivery_boundary(failure, smtp_transport):
    smtp = smtp_transport.return_value.__enter__.return_value
    if failure == "auth":
        smtp.login.side_effect = smtplib.SMTPAuthenticationError(535, b"synthetic detail")
    if failure == "send":
        smtp.send_message.side_effect = smtplib.SMTPException("synthetic detail")
    with patch.object(delivery, "_build_stdlib_message", wraps=delivery._build_stdlib_message) as build:
        if failure == "mime":
            build.side_effect = ValueError("synthetic MIME detail")
        with pytest.raises(service.WebRegistrationEmailDeliveryError) as caught:
            service.send_web_registration_verification_code(
                to_address=TEST_ADDRESS, code=TEST_CODE, expiration_minutes=7,
                settings=email_settings(api_email_enabled=failure != "disabled"),
            )
    assert "synthetic" not in str(caught.value)


class VerificationLogoRollbackTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.flow = finalize_tests.WebRegistrationEmailFinalizeTests()
        await self.flow.asyncSetUp()

    async def asyncTearDown(self):
        await self.flow.asyncTearDown()

    async def test_logo_failure_rolls_back_initial_code_with_safe_public_error(self):
        self.flow.verification_patcher.stop()
        with patch.object(service, "_load_verification_logo", side_effect=FileNotFoundError("synthetic private path")):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://testserver",
            ) as client:
                response = await client.post(
                    "/web/registration-intents",
                    json=self.flow.payload().model_dump(mode="json"),
                )
        self.assertEqual(response.status_code, 503)
        self.assertIn("email_delivery_unavailable", response.text)
        self.assertNotIn("synthetic private path", response.text)
        async with AsyncSessionLocal() as session:
            # The existing flow commits the intent before attempting code delivery.
            intent = await session.scalar(select(WebRegistrationIntent).where(
                WebRegistrationIntent.event_id == self.flow.event_id,
            ))
            self.assertIsNotNone(intent)
            self.assertIsNone(intent.confirmed_at)
            count = await session.scalar(select(func.count()).select_from(WebRegistrationVerificationCode).where(
                WebRegistrationVerificationCode.registration_intent_id == intent.id,
            ))
        self.assertEqual(count, 0)

    async def test_logo_failure_on_resend_preserves_previous_code(self):
        created, _ = await self.flow.create()
        async with AsyncSessionLocal() as session:
            intent = await session.scalar(select(WebRegistrationIntent).where(
                WebRegistrationIntent.event_id == self.flow.event_id,
            ))
            intent_id = intent.id
        await self.flow.backdate_latest_code(intent_id)
        self.flow.verification_patcher.stop()
        with patch.object(service, "_load_verification_logo", side_effect=PermissionError("synthetic private path")):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://testserver",
            ) as client:
                response = await client.post(f"/web/registration-intents/{created.flow_id}/resend-code")
        self.assertEqual(response.status_code, 503)
        self.assertIn("email_delivery_unavailable", response.text)
        self.assertNotIn("synthetic private path", response.text)
        async with AsyncSessionLocal() as session:
            codes = (await session.scalars(select(WebRegistrationVerificationCode).where(
                WebRegistrationVerificationCode.registration_intent_id == intent_id,
            ))).all()
        self.assertEqual(len(codes), 1)
        self.assertIsNone(codes[0].consumed_at)
