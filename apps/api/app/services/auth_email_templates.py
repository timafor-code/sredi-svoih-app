from __future__ import annotations

from dataclasses import dataclass

from app.services.transactional_email_branding import (
    render_branded_code_html,
    render_branded_code_text,
)


@dataclass(frozen=True)
class RenderedAuthEmail:
    subject: str
    text_body: str
    html_body: str


def _render(
    *,
    subject: str,
    heading: str,
    primary_copy: str,
    code: str,
    expiration_minutes: int,
) -> RenderedAuthEmail:
    ignored_request_copy = "Если вы не запрашивали это действие, просто проигнорируйте письмо."
    return RenderedAuthEmail(
        subject=subject,
        text_body=render_branded_code_text(
            primary_copy=primary_copy,
            code=code,
            expiration_minutes=expiration_minutes,
            ignored_request_copy=ignored_request_copy,
        ),
        html_body=render_branded_code_html(
            heading=heading,
            primary_copy=primary_copy,
            code=code,
            expiration_minutes=expiration_minutes,
            ignored_request_copy=ignored_request_copy,
        ),
    )


def render_email_verification_email(
    *,
    verification_code: str,
    expiration_minutes: int,
) -> RenderedAuthEmail:
    return _render(
        subject="Подтверждение email",
        heading="Подтверждение email",
        primary_copy="Введите этот код, чтобы подтвердить адрес электронной почты в «Среди своих».",
        code=verification_code,
        expiration_minutes=expiration_minutes,
    )


def render_password_reset_email(
    *,
    reset_code: str,
    expiration_minutes: int,
) -> RenderedAuthEmail:
    return _render(
        subject="Сброс пароля",
        heading="Сброс пароля",
        primary_copy="Введите этот код, чтобы подтвердить сброс пароля в «Среди своих».",
        code=reset_code,
        expiration_minutes=expiration_minutes,
    )


def render_set_password_email(
    *,
    set_password_code: str,
    expiration_minutes: int,
) -> RenderedAuthEmail:
    return _render(
        subject="Создание пароля",
        heading="Создание пароля",
        primary_copy="Введите этот код, чтобы задать пароль для вашего аккаунта в «Среди своих».",
        code=set_password_code,
        expiration_minutes=expiration_minutes,
    )
