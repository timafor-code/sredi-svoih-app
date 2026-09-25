from __future__ import annotations

from dataclasses import dataclass
from html import escape

from app.services.transactional_email_branding import (
    automatic_email_footer,
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


def render_account_created_email(*, first_name: str | None) -> RenderedAuthEmail:
    subject = "Ваш аккаунт «Среди своих» создан"
    normalized_first_name = first_name.strip() if first_name is not None else ""
    greeting = (
        f"Здравствуйте, {normalized_first_name}!"
        if normalized_first_name
        else "Здравствуйте!"
    )
    return RenderedAuthEmail(
        subject=subject,
        text_body=(
            "Ваш аккаунт «Среди своих» создан\n\n"
            f"{greeting} Вы задали пароль и завершили создание аккаунта.\n\n"
            "Вход по email и паролю\n"
            "Используйте адрес, на который пришло это письмо, и пароль, который вы только что задали.\n\n"
            "Регистрации уже в аккаунте\n"
            "Ваши уже созданные регистрации на мероприятия остаются привязаны к этому аккаунту.\n\n"
            "Как удалить свои данные\n"
            "Это можно сделать самостоятельно, без обращения в поддержку.\n"
            "1. Войдите в аккаунт на странице мероприятия «Среди своих» — кнопка «Войти».\n"
            "2. Откройте «Управление аккаунтом» и выберите «Удалить аккаунт». В мобильном приложении — в профиле.\n"
            "3. Подтвердите email кодом из письма.\n"
            "4. Подтвердите удаление.\n\n"
            "Что происходит после подтверждения\n"
            "Доступ к аккаунту прекращается; дальнейшее удаление данных выполняется по установленной процедуре. Если отдельные сведения должны временно сохраняться по закону, это не сохраняет активный аккаунт и возможность входа.\n\n"
            "Это транзакционное уведомление, а не маркетинговая рассылка.\n\n"
            f"{automatic_email_footer()}"
        ),
        html_body=_ACCOUNT_CREATED_HTML.format(
            greeting=escape(greeting),
            footer=escape(automatic_email_footer()),
        ),
    )


_ACCOUNT_CREATED_HTML = """<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>Ваш аккаунт «Среди своих» создан</title>
</head>
<body style="margin:0; padding:0; background-color:#F3F1EC; -webkit-text-size-adjust:100%;" bgcolor="#F3F1EC">
<div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">
Вы задали пароль — теперь можно входить по email и паролю.&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F3F1EC" style="background-color:#F3F1EC;">
<tr><td align="center" style="padding:36px 16px 24px 16px;">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:560px; background-color:#FFFFFF; border-radius:16px; overflow:hidden;" bgcolor="#FFFFFF">
    <tr><td width="50%" height="5" bgcolor="#E52C36" style="height:5px; line-height:5px; font-size:0;">&nbsp;</td><td width="50%" height="5" bgcolor="#F6A400" style="height:5px; line-height:5px; font-size:0;">&nbsp;</td></tr>
    <tr><td colspan="2" style="padding:32px 36px 36px 36px;">

      <img src="cid:sredi-svoih-logo" width="100" height="40" alt="Среди своих" style="display:block; border:0; outline:none; width:100px; height:40px;">

      <!-- HERO -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;"><tr>
        <td align="center" bgcolor="#FDF4E1" style="background-color:#FDF4E1; border:1px solid #F1DFB4; border-radius:14px; padding:32px 24px 30px 24px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>
            <td align="center" valign="middle" width="56" height="56" bgcolor="#F6A400" style="width:56px; height:56px; background-color:#F6A400; border-radius:28px; font-family:Arial,sans-serif; font-size:30px; font-weight:700; line-height:56px; color:#FFFFFF;">&#10003;</td>
          </tr></table>
          <div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif; font-size:12px; font-weight:700; letter-spacing:1.5px; text-transform:uppercase; color:#A08C5E; line-height:1.4; padding-top:18px;">Аккаунт активирован</div>
          <div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif; font-size:26px; font-weight:800; color:#0D0D1A; line-height:1.25; padding-top:8px;">Ваш аккаунт «Среди своих» создан</div>
          <div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif; font-size:15px; color:#3C3C4A; line-height:1.6; padding-top:12px;">{greeting} Вы задали пароль и завершили создание аккаунта.</div>
        </td>
      </tr></table>

      <!-- WHAT CHANGED -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;">
        <tr><td style="border-left:3px solid #F6A400; padding:2px 0 2px 16px;">
          <div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif; font-size:15px; font-weight:700; color:#0D0D1A; line-height:1.4;">Вход по email и паролю</div>
          <div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif; font-size:14px; color:#3C3C4A; line-height:1.55; padding-top:4px;">Используйте адрес, на который пришло это письмо, и пароль, который вы только что задали.</div>
        </td></tr>
        <tr><td height="16" style="height:16px; line-height:16px; font-size:0;">&nbsp;</td></tr>
        <tr><td style="border-left:3px solid #E52C36; padding:2px 0 2px 16px;">
          <div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif; font-size:15px; font-weight:700; color:#0D0D1A; line-height:1.4;">Регистрации уже в аккаунте</div>
          <div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif; font-size:14px; color:#3C3C4A; line-height:1.55; padding-top:4px;">Ваши уже созданные регистрации на мероприятия остаются привязаны к этому аккаунту.</div>
        </td></tr>
      </table>

      <!-- DIVIDER -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:32px;"><tr><td height="1" bgcolor="#ECEAE4" style="height:1px; line-height:1px; font-size:0;">&nbsp;</td></tr></table>

      <!-- DELETION -->
      <div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif; font-size:19px; font-weight:700; color:#0D0D1A; line-height:1.35; padding-top:28px;">Как удалить свои данные</div>
      <div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif; font-size:14px; color:#6B6B78; line-height:1.55; padding-top:6px;">Это можно сделать самостоятельно, без обращения в поддержку.</div>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;">
        <tr>
          <td width="30" valign="top" style="width:30px; padding-top:1px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" width="28" height="28" bgcolor="#0D0D1A" style="width:28px; height:28px; background-color:#0D0D1A; border-radius:14px; font-family:Arial,sans-serif; font-size:13px; font-weight:700; line-height:28px; color:#FFFFFF;">1</td></tr></table></td>
          <td valign="top" style="padding:0 0 16px 12px; font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif; font-size:15px; color:#3C3C4A; line-height:1.55;"><span style="font-weight:700; color:#0D0D1A;">Войдите в аккаунт</span> на странице мероприятия «Среди своих» — кнопка «Войти».</td>
        </tr>
        <tr>
          <td width="30" valign="top" style="width:30px; padding-top:1px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" width="28" height="28" bgcolor="#0D0D1A" style="width:28px; height:28px; background-color:#0D0D1A; border-radius:14px; font-family:Arial,sans-serif; font-size:13px; font-weight:700; line-height:28px; color:#FFFFFF;">2</td></tr></table></td>
          <td valign="top" style="padding:0 0 16px 12px; font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif; font-size:15px; color:#3C3C4A; line-height:1.55;">Откройте <span style="font-weight:700; color:#0D0D1A;">«Управление аккаунтом»</span> и выберите <span style="font-weight:700; color:#0D0D1A;">«Удалить аккаунт»</span>. В мобильном приложении — в профиле.</td>
        </tr>
        <tr>
          <td width="30" valign="top" style="width:30px; padding-top:1px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" width="28" height="28" bgcolor="#0D0D1A" style="width:28px; height:28px; background-color:#0D0D1A; border-radius:14px; font-family:Arial,sans-serif; font-size:13px; font-weight:700; line-height:28px; color:#FFFFFF;">3</td></tr></table></td>
          <td valign="top" style="padding:0 0 16px 12px; font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif; font-size:15px; color:#3C3C4A; line-height:1.55;"><span style="font-weight:700; color:#0D0D1A;">Подтвердите email</span> кодом из письма.</td>
        </tr>
        <tr>
          <td width="30" valign="top" style="width:30px; padding-top:1px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" width="28" height="28" bgcolor="#0D0D1A" style="width:28px; height:28px; background-color:#0D0D1A; border-radius:14px; font-family:Arial,sans-serif; font-size:13px; font-weight:700; line-height:28px; color:#FFFFFF;">4</td></tr></table></td>
          <td valign="top" style="padding:0 0 0 12px; font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif; font-size:15px; color:#3C3C4A; line-height:1.55;"><span style="font-weight:700; color:#0D0D1A;">Подтвердите удаление.</span></td>
        </tr>
      </table>

      <!-- WHAT HAPPENS NEXT -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px;"><tr>
        <td bgcolor="#F7F6F3" style="background-color:#F7F6F3; border-radius:12px; padding:16px 18px;">
          <div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif; font-size:13px; font-weight:700; color:#0D0D1A; line-height:1.4;">Что происходит после подтверждения</div>
          <div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif; font-size:13px; color:#5A5A66; line-height:1.6; padding-top:6px;">Доступ к аккаунту прекращается; дальнейшее удаление данных выполняется по установленной процедуре. Если отдельные сведения должны временно сохраняться по закону, это не сохраняет активный аккаунт и возможность входа.</div>
        </td>
      </tr></table>

      <!-- CLOSING NOTE -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;"><tr><td height="1" bgcolor="#ECEAE4" style="height:1px; line-height:1px; font-size:0;">&nbsp;</td></tr></table>
      <div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif; font-size:13px; color:#8A8A96; line-height:1.65; padding-top:18px;">Это транзакционное уведомление, а не маркетинговая рассылка.</div>

    </td></tr>
  </table>
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:560px;"><tr><td align="center" style="padding:20px 24px 8px 24px;"><div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif; font-size:12px; color:#A6A5AE; line-height:1.6;">{footer}</div></td></tr></table>
</td></tr>
</table>
</body>
</html>
"""
