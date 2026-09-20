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
    EVENT_IMAGE_CONTENT_ID,
    RegistrationConfirmationEmailContext,
    RenderedWebRegistrationEmail,
    render_registration_confirmation_email,
    render_verification_code_email,
)
from app.services.transactional_email_branding import branded_logo_image


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


def send_web_registration_confirmation(
    *,
    context: RegistrationConfirmationEmailContext,
    event_image: bytes | None = None,
    settings: Settings | None = None,
) -> EmailSendResult:
    return _send_required(
        to_address=context.to_address,
        render=lambda: render_registration_confirmation_email(context=context, has_event_image=event_image is not None),
        settings=settings or get_settings(),
        inline_image_factory=lambda: (branded_logo_image(),) + ((InlineEmailImage(event_image, "webp", EVENT_IMAGE_CONTENT_ID),) if event_image else ()),
    )


def _send_required(
    *,
    to_address: str,
    render: Callable[[], RenderedWebRegistrationEmail],
    settings: Settings,
    inline_image_factory: Callable[[], tuple[InlineEmailImage, ...]] | None = None,
) -> EmailSendResult:
    try:
        rendered = render()
        inline_images = ()
        if rendered.html_body:
            inline_images = (
                *(inline_image_factory() if inline_image_factory else (InlineEmailImage(
                    data=_load_verification_logo(),
                    subtype="png",
                    content_id="sredi-svoih-logo",
                ),)),
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
