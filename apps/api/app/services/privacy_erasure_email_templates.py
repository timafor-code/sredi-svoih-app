from __future__ import annotations

from dataclasses import dataclass

from app.services.transactional_email_branding import (
    render_branded_informational_html,
)


@dataclass(frozen=True)
class RenderedPrivacyErasureEmail:
    subject: str
    text_body: str
    html_body: str | None = None


def render_privacy_erasure_accepted_email() -> RenderedPrivacyErasureEmail:
    paragraphs = (
        "Ваш запрос на удаление персональных данных принят.",
        "Новая обработка данных остановлена, а будущие бесплатные "
        "регистрации на мероприятия отменены.",
        "Отменить запрос можно только до начала необратимого исполнения.",
        "Отменённые регистрации автоматически не восстанавливаются.",
        "Это письмо не подтверждает окончательное удаление данных.",
    )
    return RenderedPrivacyErasureEmail(
        subject="Запрос на удаление данных принят",
        text_body="\n".join(paragraphs),
        html_body=render_branded_informational_html(
            heading="Запрос на удаление данных принят",
            paragraphs=paragraphs,
            preheader=paragraphs[0],
        ),
    )


def render_privacy_erasure_completed_email() -> RenderedPrivacyErasureEmail:
    paragraphs = (
        "Ваш запрос на удаление персональных данных выполнен.",
        "Применимые персональные данные удалены либо необратимо обезличены.",
        "Активные доступы прекращены.",
        "Прежние регистрации и учётная запись не восстанавливаются.",
        "При повторном использовании сервиса потребуется новая регистрация "
        "или новая техническая запись.",
        "Вопросы можно направить оператору по контактам, указанным в "
        "политике обработки персональных данных.",
    )
    return RenderedPrivacyErasureEmail(
        subject="Удаление персональных данных завершено",
        text_body="\n".join(paragraphs),
        html_body=render_branded_informational_html(
            heading="Удаление персональных данных завершено",
            paragraphs=paragraphs,
            preheader=paragraphs[0],
        ),
    )


def render_privacy_erasure_completed_with_retention_email(
) -> RenderedPrivacyErasureEmail:
    paragraphs = (
        "Основная обработка ваших персональных данных прекращена.",
        "Применимые персональные данные удалены.",
        "Отдельные сведения могут ограниченно сохраняться только при "
        "наличии законного основания.",
        "Это письмо не перечисляет конкретные сохраняемые сведения.",
        "Подробности можно запросить у оператора по контактам, указанным "
        "в политике обработки персональных данных.",
    )
    return RenderedPrivacyErasureEmail(
        subject="Основная обработка персональных данных прекращена",
        text_body="\n".join(paragraphs),
        html_body=render_branded_informational_html(
            heading="Основная обработка персональных данных прекращена",
            paragraphs=paragraphs,
            preheader=paragraphs[0],
        ),
    )
