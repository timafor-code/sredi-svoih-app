from __future__ import annotations

from app.core.config import Settings, get_settings
from app.services.email_delivery import EmailMessage, EmailSendResult, send_email
from app.services.privacy_email_templates import render_privacy_access_code_email


class PrivacyEmailDeliveryError(RuntimeError):
    pass


def send_privacy_access_code(
    *,
    to_address: str,
    code: str,
    expiration_minutes: int,
    settings: Settings | None = None,
) -> EmailSendResult:
    resolved_settings = settings or get_settings()
    rendered = render_privacy_access_code_email(
        code=code,
        expiration_minutes=expiration_minutes,
    )
    try:
        return send_email(
            EmailMessage(
                to_address=to_address,
                subject=rendered.subject,
                text_body=rendered.text_body,
            ),
            settings=resolved_settings,
        )
    except Exception as exc:  # noqa: BLE001 - provider details stay internal.
        raise PrivacyEmailDeliveryError("Privacy email delivery failed") from exc
