from __future__ import annotations

from app.core.config import Settings, get_settings
from app.services.auth_email_templates import (
    RenderedAuthEmail,
    render_email_verification_email,
    render_password_reset_email,
    render_set_password_email,
)
from app.services.email_delivery import EmailMessage, EmailSendResult, send_email


class AuthEmailDeliveryError(RuntimeError):
    pass


def send_password_reset_email(
    *,
    to_address: str,
    code: str,
    expiration_minutes: int,
    settings: Settings | None = None,
) -> EmailSendResult:
    resolved_settings = settings or get_settings()
    rendered = render_password_reset_email(
        reset_code=code,
        expiration_minutes=expiration_minutes,
    )
    return _send_auth_email(
        to_address=to_address,
        rendered=rendered,
        settings=resolved_settings,
    )


def send_email_verification_email(
    *,
    to_address: str,
    code: str,
    expiration_minutes: int,
    settings: Settings | None = None,
) -> EmailSendResult:
    resolved_settings = settings or get_settings()
    rendered = render_email_verification_email(
        verification_code=code,
        expiration_minutes=expiration_minutes,
    )
    return _send_auth_email(
        to_address=to_address,
        rendered=rendered,
        settings=resolved_settings,
    )


def send_set_password_email(
    *,
    to_address: str,
    code: str,
    expiration_minutes: int,
    settings: Settings | None = None,
) -> EmailSendResult:
    resolved_settings = settings or get_settings()
    rendered = render_set_password_email(
        set_password_code=code,
        expiration_minutes=expiration_minutes,
    )
    return _send_auth_email(
        to_address=to_address,
        rendered=rendered,
        settings=resolved_settings,
    )

def _send_auth_email(
    *,
    to_address: str,
    rendered: RenderedAuthEmail,
    settings: Settings,
) -> EmailSendResult:
    try:
        return send_email(
            EmailMessage(
                to_address=to_address,
                subject=rendered.subject,
                text_body=rendered.text_body,
            ),
            settings=settings,
        )
    except Exception as exc:  # noqa: BLE001 - hide provider details from callers/logs.
        raise AuthEmailDeliveryError("Auth email delivery failed") from exc
