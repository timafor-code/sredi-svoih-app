from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RenderedWebRegistrationEmail:
    subject: str
    text_body: str


def render_verification_code_email(
    *,
    code: str,
    expiration_minutes: int,
) -> RenderedWebRegistrationEmail:
    return RenderedWebRegistrationEmail(
        subject="Подтверждение регистрации",
        text_body="\n".join(
            (
                "Используйте этот код, чтобы подтвердить регистрацию на мероприятие:",
                "",
                code,
                "",
                f"Код действует {expiration_minutes} минут.",
                "Никому не передавайте этот код.",
                "Если вы не отправляли форму регистрации, проигнорируйте это письмо.",
            ),
        ),
    )


def render_registration_result_email(
    *,
    registration_status: str,
) -> RenderedWebRegistrationEmail:
    if registration_status == "confirmed":
        outcome = "Ваша регистрация подтверждена."
    elif registration_status == "pending":
        outcome = "Ваша заявка получена и ожидает решения организатора."
    else:
        raise ValueError("unsupported web registration status")

    return RenderedWebRegistrationEmail(
        subject="Результат регистрации",
        text_body="\n".join(
            (
                "Ваш email подтверждён.",
                outcome,
                "Пароль не требуется, чтобы регистрация сохранилась.",
                "Это транзакционное уведомление, а не маркетинговая рассылка.",
            ),
        ),
    )
