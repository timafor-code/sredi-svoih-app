from __future__ import annotations

from dataclasses import dataclass
from html import escape


@dataclass(frozen=True)
class RenderedWebRegistrationEmail:
    subject: str
    text_body: str
    html_body: str | None = None


def render_verification_code_email(
    *,
    code: str,
    expiration_minutes: int,
) -> RenderedWebRegistrationEmail:
    return RenderedWebRegistrationEmail(
        subject="Подтверждение регистрации",
        html_body=_VERIFICATION_HTML.format(
            code=escape(code),
            expiration_minutes=expiration_minutes,
        ),
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


# Owner-provided email reference; all resources are embedded in the MIME message.
_VERIFICATION_HTML = """<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>Код подтверждения</title>
</head>
<body style="margin:0; padding:0; background-color:#F3F1EC; -webkit-text-size-adjust:100%;" bgcolor="#F3F1EC">
<div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">
Код действует {expiration_minutes} минут. Никому не передавайте его.&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F3F1EC" style="background-color:#F3F1EC;">
<tr>
<td align="center" style="padding:36px 16px 24px 16px;">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px; max-width:100%; background-color:#FFFFFF; border-radius:16px; overflow:hidden;" bgcolor="#FFFFFF">
    <tr>
      <td width="50%" height="5" bgcolor="#E52C36" style="height:5px; line-height:5px; font-size:0;">&nbsp;</td>
      <td width="50%" height="5" bgcolor="#F6A400" style="height:5px; line-height:5px; font-size:0;">&nbsp;</td>
    </tr>

    <tr>
      <td colspan="2" style="padding:36px 44px 40px 44px;">
        <img src="cid:sredi-svoih-logo" width="100" height="40" alt="Среди своих" style="display:block; border:0; outline:none; width:100px; height:40px;">
        <div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif; font-size:26px; font-weight:700; color:#0D0D1A; line-height:1.25; padding-top:28px;">
          Код подтверждения
        </div>
        <div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif; font-size:15px; color:#3C3C4A; line-height:1.6; padding-top:12px;">
          Вы регистрируетесь на мероприятие. Введите этот код в форме регистрации, чтобы подтвердить свою почту.
        </div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;">
          <tr>
            <td align="center" bgcolor="#FDF4E1" style="background-color:#FDF4E1; border:1px solid #F1DFB4; border-radius:12px; padding:26px 12px;">
              <div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif; font-size:40px; font-weight:800; color:#0D0D1A; letter-spacing:10px; line-height:1; text-indent:10px;">
                {code}
              </div>
              <div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif; font-size:12px; color:#A08C5E; line-height:1.4; padding-top:12px;">
                Нажмите и удерживайте код, чтобы скопировать
              </div>
            </td>
          </tr>
        </table>
        <div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif; font-size:14px; color:#3C3C4A; line-height:1.6; padding-top:16px;" align="center">
          Код действует <span style="font-weight:700; color:#0D0D1A;">{expiration_minutes} минут</span>.
        </div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:32px;">
          <tr>
            <td height="1" bgcolor="#ECEAE4" style="height:1px; line-height:1px; font-size:0;">&nbsp;</td>
          </tr>
        </table>
        <div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif; font-size:13px; color:#8A8A96; line-height:1.65; padding-top:20px;">
          Никому не передавайте этот код — команда «Среди своих» никогда его не спрашивает.
          Если вы не отправляли форму регистрации, просто проигнорируйте это письмо.
        </div>

      </td>
    </tr>
  </table>
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px; max-width:100%;">
    <tr>
      <td align="center" style="padding:20px 24px 8px 24px;">
        <div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif; font-size:12px; color:#A6A5AE; line-height:1.6;">
          «Среди своих» — автоматическое письмо, отвечать на него не нужно.
        </div>
      </td>
    </tr>
  </table>

</td>
</tr>
</table>

</body>
</html>
"""
