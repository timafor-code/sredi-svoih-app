from __future__ import annotations

from app.core.config import Settings, get_settings
from app.services.email_delivery import EmailMessage, EmailSendResult, send_email
from app.services.web_registration_email_templates import (
    RenderedWebRegistrationEmail,
    render_registration_result_email,
    render_verification_code_email,
)


class WebRegistrationEmailDeliveryError(RuntimeError):
    pass


def send_web_registration_verification_code(
    *,
    to_address: str,
    code: str,
    expiration_minutes: int,
    settings: Settings | None = None,
) -> EmailSendResult:
    return _send_required(
        to_address=to_address,
        rendered=render_verification_code_email(
            code=code,
            expiration_minutes=expiration_minutes,
        ),
        settings=settings or get_settings(),
    )


def send_web_registration_result(
    *,
    to_address: str,
    registration_status: str,
    settings: Settings | None = None,
) -> EmailSendResult:
    return _send_required(
        to_address=to_address,
        rendered=render_registration_result_email(
            registration_status=registration_status,
        ),
        settings=settings or get_settings(),
    )


def _send_required(
    *,
    to_address: str,
    rendered: RenderedWebRegistrationEmail,
    settings: Settings,
) -> EmailSendResult:
    try:
        result = send_email(
            EmailMessage(
                to_address=to_address,
                subject=rendered.subject,
                text_body=rendered.text_body,
            ),
            settings=settings,
        )
    except Exception as exc:  # noqa: BLE001 - provider details stay at this boundary.
        raise WebRegistrationEmailDeliveryError(
            "Web registration email delivery failed",
        ) from exc
    if not result.sent:
        raise WebRegistrationEmailDeliveryError(
            "Web registration email delivery unavailable",
        )
    return result
