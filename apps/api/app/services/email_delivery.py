from __future__ import annotations

import logging
import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage as StdlibEmailMessage
from email.utils import formataddr, make_msgid, parseaddr

from app.core.config import Settings, get_settings
from app.core.redaction import redact_email_address, redact_for_log

logger = logging.getLogger(__name__)


class EmailConfigurationError(RuntimeError):
    pass


@dataclass(frozen=True)
class EmailMessage:
    to_address: str
    subject: str
    text_body: str
    to_name: str | None = None
    reply_to: str | None = None


@dataclass(frozen=True)
class EmailSendResult:
    sent: bool
    disabled: bool
    reason: str | None = None
    message_id: str | None = None


def send_email(
    message: EmailMessage,
    *,
    settings: Settings | None = None,
) -> EmailSendResult:
    resolved_settings = settings or get_settings()
    redacted_recipient = redact_email_address(message.to_address)

    if not resolved_settings.api_email_enabled:
        logger.info(
            "Email delivery disabled; skipped outbound email to %s subject=%s",
            redacted_recipient,
            redact_for_log(message.subject),
        )
        return EmailSendResult(
            sent=False,
            disabled=True,
            reason="email_delivery_disabled",
        )

    _validate_enabled_settings(resolved_settings)
    stdlib_message = _build_stdlib_message(message, resolved_settings)

    with smtplib.SMTP(
        resolved_settings.api_email_smtp_host,
        resolved_settings.api_email_smtp_port,
        timeout=10,
    ) as smtp:
        if resolved_settings.api_email_smtp_starttls:
            smtp.starttls(context=ssl.create_default_context())
        if resolved_settings.api_email_smtp_username:
            smtp.login(
                resolved_settings.api_email_smtp_username,
                resolved_settings.api_email_smtp_password,
            )
        smtp.send_message(stdlib_message)

    logger.info(
        "Email delivery sent outbound email to %s subject=%s",
        redacted_recipient,
        redact_for_log(message.subject),
    )
    return EmailSendResult(
        sent=True,
        disabled=False,
        message_id=stdlib_message["Message-ID"],
    )


def _validate_enabled_settings(settings: Settings) -> None:
    if not settings.api_email_smtp_host:
        raise EmailConfigurationError(
            "API_EMAIL_SMTP_HOST must be configured when API_EMAIL_ENABLED=true",
        )
    if not settings.api_email_from_address:
        raise EmailConfigurationError(
            "API_EMAIL_FROM_ADDRESS must be configured when API_EMAIL_ENABLED=true",
        )
    if settings.api_email_smtp_username and not settings.api_email_smtp_password:
        raise EmailConfigurationError(
            "API_EMAIL_SMTP_PASSWORD must be configured when SMTP username is set",
        )
    if settings.api_email_smtp_password and not settings.api_email_smtp_username:
        raise EmailConfigurationError(
            "API_EMAIL_SMTP_USERNAME must be configured when SMTP password is set",
        )


def _build_stdlib_message(
    message: EmailMessage,
    settings: Settings,
) -> StdlibEmailMessage:
    if not message.to_address:
        raise EmailConfigurationError("email recipient must not be empty")
    if not message.subject:
        raise EmailConfigurationError("email subject must not be empty")
    if not message.text_body:
        raise EmailConfigurationError("email text body must not be empty")

    stdlib_message = StdlibEmailMessage()
    stdlib_message["From"] = _format_address(
        settings.api_email_from_address,
        settings.api_email_from_name,
    )
    stdlib_message["To"] = _format_address(message.to_address, message.to_name)
    stdlib_message["Subject"] = message.subject
    stdlib_message["Message-ID"] = make_msgid(domain=_message_id_domain(settings))
    if message.reply_to:
        stdlib_message["Reply-To"] = message.reply_to

    stdlib_message.set_content(message.text_body)
    return stdlib_message


def _format_address(address: str, name: str | None = None) -> str:
    parsed_name, parsed_address = parseaddr(address)
    resolved_address = parsed_address or address
    if not resolved_address or "@" not in resolved_address:
        raise EmailConfigurationError("email address must contain @")

    return formataddr((name or parsed_name or "", resolved_address))


def _message_id_domain(settings: Settings) -> str:
    _, from_address = parseaddr(settings.api_email_from_address)
    if "@" not in from_address:
        return "localhost"

    return from_address.rsplit("@", 1)[1]
