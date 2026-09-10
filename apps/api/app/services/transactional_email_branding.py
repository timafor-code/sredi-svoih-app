from __future__ import annotations

from functools import lru_cache
from html import escape
from pathlib import Path

from app.services.email_delivery import InlineEmailImage

LOGO_CONTENT_ID = "sredi-svoih-logo"
_SECURITY_WARNING = (
    "Никому не передавайте этот код — команда «Среди своих» никогда его не спрашивает."
)
_AUTOMATIC_EMAIL_FOOTER = (
    "«Среди своих» — автоматическое письмо, отвечать на него не нужно."
)


@lru_cache(maxsize=1)
def load_branded_logo() -> bytes:
    return (Path(__file__).resolve().parent.parent / "assets/email/logo.png").read_bytes()


def branded_logo_image() -> InlineEmailImage:
    return InlineEmailImage(
        data=load_branded_logo(),
        subtype="png",
        content_id=LOGO_CONTENT_ID,
    )


def render_branded_code_text(
    *,
    primary_copy: str,
    code: str,
    expiration_minutes: int,
    ignored_request_copy: str,
) -> str:
    expiration = _render_expiration_minutes(expiration_minutes)
    return "\n".join(
        (
            primary_copy,
            "",
            code,
            "",
            f"Код действует {expiration} минут.",
            _SECURITY_WARNING,
            ignored_request_copy,
            "",
            _AUTOMATIC_EMAIL_FOOTER,
        ),
    )


def render_branded_code_html(
    *,
    heading: str,
    primary_copy: str,
    code: str,
    expiration_minutes: int,
    ignored_request_copy: str,
) -> str:
    """Render the shared, self-contained visual shell for code emails."""
    return _BRANDED_CODE_HTML.format(
        heading=escape(heading),
        primary_copy=escape(primary_copy),
        code=escape(code),
        expiration_minutes=_render_expiration_minutes(expiration_minutes),
        security_warning=escape(_SECURITY_WARNING),
        ignored_request_copy=escape(ignored_request_copy),
        footer=escape(_AUTOMATIC_EMAIL_FOOTER),
    )


def render_branded_informational_html(
    *,
    heading: str,
    paragraphs: tuple[str, ...],
    preheader: str | None = None,
) -> str:
    """Render the shared, self-contained visual shell for informational emails."""
    escaped_paragraphs = "".join(
        f'<div style="font-family:-apple-system,\'Segoe UI\',Roboto,Arial,sans-serif; font-size:15px; color:#3C3C4A; line-height:1.6; padding-top:12px;">{escape(paragraph)}</div>'
        for paragraph in paragraphs
    )
    return _BRANDED_INFORMATIONAL_HTML.format(
        heading=escape(heading),
        paragraphs=escaped_paragraphs,
        preheader=escape(preheader or ""),
        footer=escape(_AUTOMATIC_EMAIL_FOOTER),
    )


def _render_expiration_minutes(expiration_minutes: int) -> str:
    return str(int(expiration_minutes))


_BRANDED_CODE_HTML = """<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>{heading}</title>
</head>
<body style="margin:0; padding:0; background-color:#F3F1EC; -webkit-text-size-adjust:100%;" bgcolor="#F3F1EC">
<div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">
Код действует {expiration_minutes} минут. Никому не передавайте его.&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F3F1EC" style="background-color:#F3F1EC;">
<tr><td align="center" style="padding:36px 16px 24px 16px;">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px; max-width:100%; background-color:#FFFFFF; border-radius:16px; overflow:hidden;" bgcolor="#FFFFFF">
    <tr><td width="50%" height="5" bgcolor="#E52C36" style="height:5px; line-height:5px; font-size:0;">&nbsp;</td><td width="50%" height="5" bgcolor="#F6A400" style="height:5px; line-height:5px; font-size:0;">&nbsp;</td></tr>
    <tr><td colspan="2" style="padding:36px 44px 40px 44px;">
      <img src="cid:sredi-svoih-logo" width="100" height="40" alt="Среди своих" style="display:block; border:0; outline:none; width:100px; height:40px;">
      <div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif; font-size:26px; font-weight:700; color:#0D0D1A; line-height:1.25; padding-top:28px;">{heading}</div>
      <div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif; font-size:15px; color:#3C3C4A; line-height:1.6; padding-top:12px;">{primary_copy}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;"><tr><td align="center" bgcolor="#FDF4E1" style="background-color:#FDF4E1; border:1px solid #F1DFB4; border-radius:12px; padding:26px 12px;">
        <div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif; font-size:40px; font-weight:800; color:#0D0D1A; letter-spacing:10px; line-height:1; text-indent:10px;">{code}</div>
        <div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif; font-size:12px; color:#A08C5E; line-height:1.4; padding-top:12px;">Нажмите и удерживайте код, чтобы скопировать</div>
      </td></tr></table>
      <div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif; font-size:14px; color:#3C3C4A; line-height:1.6; padding-top:16px;" align="center">Код действует <span style="font-weight:700; color:#0D0D1A;">{expiration_minutes} минут</span>.</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:32px;"><tr><td height="1" bgcolor="#ECEAE4" style="height:1px; line-height:1px; font-size:0;">&nbsp;</td></tr></table>
      <div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif; font-size:13px; color:#8A8A96; line-height:1.65; padding-top:20px;">{security_warning} {ignored_request_copy}</div>
    </td></tr>
  </table>
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px; max-width:100%;"><tr><td align="center" style="padding:20px 24px 8px 24px;"><div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif; font-size:12px; color:#A6A5AE; line-height:1.6;">{footer}</div></td></tr></table>
</td></tr>
</table>
</body>
</html>
"""


_BRANDED_INFORMATIONAL_HTML = """<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>{heading}</title>
</head>
<body style="margin:0; padding:0; background-color:#F3F1EC; -webkit-text-size-adjust:100%;" bgcolor="#F3F1EC">
<div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">
{preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F3F1EC" style="background-color:#F3F1EC;">
<tr><td align="center" style="padding:36px 16px 24px 16px;">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px; max-width:100%; background-color:#FFFFFF; border-radius:16px; overflow:hidden;" bgcolor="#FFFFFF">
    <tr><td width="50%" height="5" bgcolor="#E52C36" style="height:5px; line-height:5px; font-size:0;">&nbsp;</td><td width="50%" height="5" bgcolor="#F6A400" style="height:5px; line-height:5px; font-size:0;">&nbsp;</td></tr>
    <tr><td colspan="2" style="padding:36px 44px 40px 44px;">
      <img src="cid:sredi-svoih-logo" width="100" height="40" alt="Среди своих" style="display:block; border:0; outline:none; width:100px; height:40px;">
      <div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif; font-size:26px; font-weight:700; color:#0D0D1A; line-height:1.25; padding-top:28px;">{heading}</div>
      {paragraphs}
    </td></tr>
  </table>
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px; max-width:100%;"><tr><td align="center" style="padding:20px 24px 8px 24px;"><div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif; font-size:12px; color:#A6A5AE; line-height:1.6;">{footer}</div></td></tr></table>
</td></tr>
</table>
</body>
</html>
"""
