from __future__ import annotations

from dataclasses import dataclass

from app.services.transactional_email_branding import (
    automatic_email_footer,
    render_branded_code_html,
    render_branded_code_text,
    render_branded_informational_html,
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


def render_account_created_email(*, first_name: str | None) -> RenderedAuthEmail:
    subject = "Ваш аккаунт «Среди своих» создан"
    normalized_first_name = first_name.strip() if first_name is not None else ""
    greeting = (
        f"Здравствуйте, {normalized_first_name}!"
        if normalized_first_name
        else "Здравствуйте!"
    )
    paragraphs = (
        greeting,
        "Вы задали пароль и завершили создание аккаунта «Среди своих». Теперь вы можете входить с вашим email и паролем.",
        "Ваши уже созданные регистрации на мероприятия остаются привязаны к этому аккаунту.",
    )
    deletion_section = (
        "Как удалить свои данные",
        (
            "Войдите в аккаунт на странице мероприятия «Среди своих» (кнопка «Войти»), откройте «Управление аккаунтом» и выберите «Удалить аккаунт». В мобильном приложении удаление аккаунта доступно в профиле.",
            "Подтвердите свой email кодом из письма, а затем подтвердите удаление.",
            "После подтверждения доступ к аккаунту прекращается; дальнейшее удаление данных выполняется по установленной процедуре. Если отдельные сведения должны временно сохраняться по закону, это не сохраняет активный аккаунт и возможность входа.",
        ),
    )
    closing = "Это транзакционное уведомление, а не маркетинговая рассылка."
    text_body = "\n".join(
        (
            *paragraphs,
            "",
            deletion_section[0],
            *deletion_section[1],
            "",
            closing,
            "",
            automatic_email_footer(),
        ),
    )
    return RenderedAuthEmail(
        subject=subject,
        text_body=text_body,
        html_body=render_branded_informational_html(
            heading=subject,
            paragraphs=(*paragraphs, closing),
            preheader=paragraphs[1],
            sections=(deletion_section,),
        ),
    )
