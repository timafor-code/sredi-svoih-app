from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from html import escape
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from app.services.transactional_email_branding import (
    render_branded_informational_html,
)


@dataclass(frozen=True)
class RenderedWebRegistrationEmail:
    subject: str
    text_body: str
    html_body: str | None = None


@dataclass(frozen=True)
class RegistrationConfirmationOption:
    title: str
    description: str | None
    option_type: str
    quantity: int
    unit_price_amount: int
    total_amount: int
    currency: str
    is_donation: bool
    option_id: str | None


@dataclass(frozen=True)
class RegistrationConfirmationProgrammeItem:
    time: str | None
    title: str
    note: str | None
    selected: bool


@dataclass(frozen=True)
class RegistrationConfirmationProgrammeDay:
    date: str | None
    label: str | None
    note: str | None
    items: tuple[RegistrationConfirmationProgrammeItem, ...]


@dataclass(frozen=True)
class RegistrationConfirmationEmailContext:
    to_address: str
    participant_name: str
    event_title: str
    occurrence_title: str | None
    event_kind: str
    starts_at: datetime | None
    ends_at: datetime | None
    timezone: str
    location_name: str | None
    address: str | None
    registration_status: str
    payment_status: str
    seats_count: int
    options: tuple[RegistrationConfirmationOption, ...]
    total_amount: int | None
    total_currency: str | None
    programme: tuple[RegistrationConfirmationProgrammeDay, ...]
    public_event_url: str | None
    privacy_url: str | None
    privacy_title: str | None
    event_image_object_key: str | None


EVENT_IMAGE_CONTENT_ID = "sredi-svoih-event-image"


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


def render_registration_confirmation_email(
    *, context: RegistrationConfirmationEmailContext, has_event_image: bool,
) -> RenderedWebRegistrationEmail:
    """Render only immutable registration data; no ORM/session access is allowed here."""
    event_name = context.occurrence_title or context.event_title
    details = _confirmation_details(context)
    options_html = _options_html(context.options, context.total_amount, context.total_currency)
    programme_html = _programme_html(context.programme)
    image_html = (
        f'<img src="cid:{EVENT_IMAGE_CONTENT_ID}" alt="{escape(event_name)}" '
        'style="display:block;width:100%;max-width:512px;height:auto;border-radius:12px;">'
        if has_event_image else ""
    )
    cta = (f'<tr><td align="center" style="padding-top:28px"><a href="{escape(context.public_event_url, quote=True)}" '
           'style="display:block;background:#2E6B45;color:#fff;padding:14px;text-decoration:none;border-radius:10px;font-weight:700">Открыть регистрацию</a></td></tr>'
           if _safe_url(context.public_event_url) else "")
    privacy = (f'<br><a href="{escape(context.privacy_url, quote=True)}" style="color:#8E8D96">{escape(context.privacy_title or "Политика обработки персональных данных")}</a>'
               if _safe_url(context.privacy_url) else "")
    html = f'''<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Регистрация подтверждена</title></head>
<body style="margin:0;background:#F3F1EC"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="600" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden" cellspacing="0" cellpadding="0">
<tr><td width="50%" height="5" bgcolor="#E52C36"></td><td width="50%" height="5" bgcolor="#F6A400"></td></tr><tr><td colspan="2" style="padding:34px 44px;font-family:Arial,sans-serif;color:#1F2126">
<img src="cid:sredi-svoih-logo" width="100" height="40" alt="Среди своих" style="display:block"><h1 style="font-size:26px">Регистрация подтверждена</h1><p>Здравствуйте, {escape(context.participant_name)}!</p><p>Ваша регистрация подтверждена. Вы в списке участников, ждём вас.</p>{image_html}
<h2>{escape(event_name)}</h2><table role="presentation" width="100%">{details}</table>{options_html}{programme_html}<table role="presentation" width="100%">{cta}</table><p style="border-top:1px solid #ECEAE4;padding-top:18px;color:#7A7D85;font-size:13px">Это транзакционное уведомление, а не маркетинговая рассылка.</p>
</td></tr></table><p style="font:12px Arial;color:#A6A5AE">«Среди своих» — автоматическое письмо, отвечать на него не нужно.{privacy}</p></td></tr></table></body></html>'''
    return RenderedWebRegistrationEmail("Регистрация подтверждена", _confirmation_text(context), html)


def _safe_url(value: str | None) -> bool:
    if not value:
        return False
    parsed = urlsplit(value)
    return parsed.scheme in {"https", "http"} and bool(parsed.netloc) and not parsed.username and not parsed.password


def _confirmation_details(context: RegistrationConfirmationEmailContext) -> str:
    rows: list[tuple[str, str]] = []
    if context.starts_at:
        try:
            local = context.starts_at.astimezone(ZoneInfo(context.timezone))
            value = local.strftime("%d.%m.%Y, %H:%M")
            if context.ends_at: value += " — " + context.ends_at.astimezone(ZoneInfo(context.timezone)).strftime("%H:%M")
            rows.append(("Дата и время", value))
        except Exception: pass
    if context.location_name: rows.append(("Место", context.location_name))
    if context.address: rows.append(("Адрес", context.address))
    if context.participant_name: rows.append(("Участник", context.participant_name))
    return "".join(f'<tr><td style="padding:8px 12px 8px 0;color:#7A7D85">{escape(label)}</td><td>{escape(value)}</td></tr>' for label,value in rows)


def _money(amount: int, currency: str) -> str:
    symbol = {"RUB": "₽", "USD": "$", "EUR": "€"}.get(currency, currency)
    return f"{amount:,.2f}".replace(",", "\u00a0").replace(".", ",") + "\u00a0" + symbol


def _options_html(options: tuple[RegistrationConfirmationOption, ...], total: int | None, currency: str | None) -> str:
    if not options: return ""
    rows = "".join(f'<tr><td style="padding:10px">{escape(option.title)}{(" × " + str(option.quantity)) if option.quantity > 1 else ""}{("<br><span style=\"color:#7A7D85\">Пожертвование</span>") if option.is_donation else ""}</td><td align="right">{escape(_money(option.total_amount, option.currency))}</td></tr>' for option in options)
    total_row = f'<tr><td style="padding:10px;font-weight:bold">Итого</td><td align="right" style="font-weight:bold">{escape(_money(total, currency))}</td></tr>' if total is not None and currency else ""
    return f'<h3>Ваше участие</h3><table role="presentation" width="100%" style="background:#FAF8F4">{rows}{total_row}</table>'


def _programme_html(days: tuple[RegistrationConfirmationProgrammeDay, ...]) -> str:
    chunks=[]
    for day in days:
        if not day.items: continue
        title = " · ".join(part for part in (day.label, day.date, day.note) if part) or "Программа"
        items="".join(f'<tr><td valign="top" style="padding:7px;color:#A35A00">{escape(item.time or "")}</td><td style="padding:7px">{escape(item.title)}{("<br><span style=\"color:#7A7D85\">"+escape(item.note)+"</span>") if item.note else ""}{("<br><span style=\"color:#8A5000\">Ваш вариант</span>") if item.selected else ""}</td></tr>' for item in day.items)
        chunks.append(f'<h3>{escape(title)}</h3><table role="presentation" width="100%">{items}</table>')
    return "".join(chunks)


def _confirmation_text(context: RegistrationConfirmationEmailContext) -> str:
    lines=["Регистрация подтверждена", "", f"Здравствуйте, {context.participant_name}!", "Ваша регистрация подтверждена. Вы в списке участников, ждём вас.", "", context.occurrence_title or context.event_title]
    if context.starts_at:
        lines.append(context.starts_at.astimezone(ZoneInfo(context.timezone)).strftime("%d.%m.%Y, %H:%M"))
    lines.extend(value for value in (context.location_name, context.address) if value)
    for option in context.options: lines.append(f"{option.title}: {_money(option.total_amount, option.currency)}")
    if context.total_amount is not None and context.total_currency: lines.append(f"Итого: {_money(context.total_amount, context.total_currency)}")
    if context.payment_status == "pending": lines.append("Оплата ещё не выполнена.")
    for day in context.programme:
        if day.items: lines.append(day.label or day.date or "Программа"); lines.extend(f"{item.time or ''} {item.title}".strip() for item in day.items)
    if _safe_url(context.public_event_url): lines.append(context.public_event_url or "")
    if _safe_url(context.privacy_url): lines.append(context.privacy_url or "")
    return "\n".join(lines)


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
