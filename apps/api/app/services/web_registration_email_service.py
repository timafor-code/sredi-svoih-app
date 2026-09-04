from __future__ import annotations

from collections.abc import Callable
from functools import lru_cache
from pathlib import Path

from app.core.config import Settings, get_settings
from app.services.email_delivery import (
    EmailMessage,
    EmailSendResult,
    InlineEmailImage,
    send_email,
)
from app.services.web_registration_email_templates import (
    RenderedWebRegistrationEmail,
    render_registration_result_email,
    render_verification_code_email,
)


class WebRegistrationEmailDeliveryError(RuntimeError):
    pass


@lru_cache(maxsize=1)
def _load_verification_logo() -> bytes:
    return (Path(__file__).resolve().parent.parent / "assets/email/logo.png").read_bytes()


def send_web_registration_verification_code(
    *,
    to_address: str,
    code: str,
    expiration_minutes: int,
    settings: Settings | None = None,
) -> EmailSendResult:
    return _send_required(
        to_address=to_address,
        render=lambda: render_verification_code_email(
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
        render=lambda: render_registration_result_email(
            registration_status=registration_status,
        ),
        settings=settings or get_settings(),
    )


def _send_required(
    *,
    to_address: str,
    render: Callable[[], RenderedWebRegistrationEmail],
    settings: Settings,
) -> EmailSendResult:
    try:
        rendered = render()
        inline_images = (
            (
                InlineEmailImage(
                    data=_load_verification_logo(),
                    subtype="png",
                    content_id="sredi-svoih-logo",
                ),
            )
            if rendered.html_body
            else ()
        )
        result = send_email(
            EmailMessage(
                to_address=to_address,
                subject=rendered.subject,
                text_body=rendered.text_body,
                html_body=rendered.html_body,
                inline_images=inline_images,
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
