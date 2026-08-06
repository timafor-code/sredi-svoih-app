from __future__ import annotations

from app.core.config import Settings, get_settings
from app.services.email_delivery import EmailMessage, EmailSendResult, send_email
from app.services.privacy_erasure_email_templates import (
    RenderedPrivacyErasureEmail,
    render_privacy_erasure_accepted_email,
    render_privacy_erasure_completed_email,
    render_privacy_erasure_completed_with_retention_email,
)


class PrivacyErasureEmailDeliveryError(RuntimeError):
    pass


def send_privacy_erasure_accepted(
    *,
    to_address: str,
    settings: Settings | None = None,
) -> EmailSendResult:
    rendered = render_privacy_erasure_accepted_email()
    try:
        result = send_email(
            EmailMessage(
                to_address=to_address,
                subject=rendered.subject,
                text_body=rendered.text_body,
            ),
            settings=settings or get_settings(),
        )
    except Exception as exc:  # noqa: BLE001 - provider details remain internal.
        raise PrivacyErasureEmailDeliveryError(
            "Privacy erasure email delivery failed",
        ) from exc
    if not result.sent:
        raise PrivacyErasureEmailDeliveryError(
            "Privacy erasure email delivery unavailable",
        )
    return result


def send_privacy_erasure_completed(
    *,
    to_address: str,
    settings: Settings | None = None,
) -> EmailSendResult:
    return _send_rendered(
        to_address=to_address,
        rendered=render_privacy_erasure_completed_email(),
        settings=settings,
    )


def send_privacy_erasure_completed_with_retention(
    *,
    to_address: str,
    settings: Settings | None = None,
) -> EmailSendResult:
    return _send_rendered(
        to_address=to_address,
        rendered=render_privacy_erasure_completed_with_retention_email(),
        settings=settings,
    )


def _send_rendered(
    *,
    to_address: str,
    rendered: RenderedPrivacyErasureEmail,
    settings: Settings | None,
) -> EmailSendResult:
    try:
        result = send_email(
            EmailMessage(
                to_address=to_address,
                subject=rendered.subject,
                text_body=rendered.text_body,
            ),
            settings=settings or get_settings(),
        )
    except Exception as exc:  # noqa: BLE001 - provider details remain internal.
        raise PrivacyErasureEmailDeliveryError(
            "Privacy erasure email delivery failed",
        ) from exc
    if not result.sent:
        raise PrivacyErasureEmailDeliveryError(
            "Privacy erasure email delivery unavailable",
        )
    return result
