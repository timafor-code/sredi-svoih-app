from __future__ import annotations

from dataclasses import dataclass

from app.services.transactional_email_branding import (
    render_branded_code_html,
    render_branded_code_text,
)


@dataclass(frozen=True)
class RenderedPrivacyEmail:
    subject: str
    text_body: str
    html_body: str


def render_privacy_access_code_email(
    *,
    code: str,
    expiration_minutes: int,
) -> RenderedPrivacyEmail:
    primary_copy = (
        "Введите этот код, чтобы получить доступ к информации о ваших "
        "персональных данных в «Среди своих»."
    )
    ignored_request_copy = "Если вы не запрашивали это действие, просто проигнорируйте письмо."
    return RenderedPrivacyEmail(
        subject="Код доступа к вашим данным",
        text_body=render_branded_code_text(
            primary_copy=primary_copy,
            code=code,
            expiration_minutes=expiration_minutes,
            ignored_request_copy=ignored_request_copy,
        ),
        html_body=render_branded_code_html(
            heading="Доступ к вашим данным",
            primary_copy=primary_copy,
            code=code,
            expiration_minutes=expiration_minutes,
            ignored_request_copy=ignored_request_copy,
        ),
    )
