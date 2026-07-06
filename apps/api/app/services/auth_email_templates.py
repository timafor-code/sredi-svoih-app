from __future__ import annotations

from dataclasses import dataclass

_PRODUCT_NAME = "Sredi Svoih"


@dataclass(frozen=True)
class RenderedAuthEmail:
    subject: str
    text_body: str


def _require_link_or_code(email_kind: str, link: str | None, code: str | None) -> None:
    if not link and not code:
        raise ValueError(f"{email_kind} requires a link or code")


def _secret_lines(
    *,
    link_label: str,
    link: str | None,
    code_label: str,
    code: str | None,
) -> list[str]:
    lines: list[str] = []
    if link:
        lines.append(f"{link_label}: {link}")
    if code:
        lines.append(f"{code_label}: {code}")
    return lines


def _render(
    *,
    subject: str,
    intro: str,
    link_label: str,
    link: str | None,
    code_label: str,
    code: str | None,
    expiration_minutes: int | None,
    product_name: str,
) -> RenderedAuthEmail:
    lines = [
        intro,
        "",
        *_secret_lines(
            link_label=link_label,
            link=link,
            code_label=code_label,
            code=code,
        ),
    ]
    if expiration_minutes is not None:
        lines.extend(
            [
                "",
                f"This request expires in {expiration_minutes} minutes.",
            ],
        )

    lines.extend(
        [
            "",
            "If you did not request this, you can ignore this email.",
            "",
            product_name,
        ],
    )
    return RenderedAuthEmail(subject=subject, text_body="\n".join(lines))


def render_email_verification_email(
    *,
    verification_link: str | None = None,
    verification_code: str | None = None,
    expiration_minutes: int | None = None,
    product_name: str = _PRODUCT_NAME,
) -> RenderedAuthEmail:
    _require_link_or_code(
        "email verification",
        verification_link,
        verification_code,
    )
    return _render(
        subject="Verify your email address",
        intro="Use the link or code below to verify your email address.",
        link_label="Verification link",
        link=verification_link,
        code_label="Verification code",
        code=verification_code,
        expiration_minutes=expiration_minutes,
        product_name=product_name,
    )


def render_password_reset_email(
    *,
    reset_link: str | None = None,
    reset_code: str | None = None,
    expiration_minutes: int | None = None,
    product_name: str = _PRODUCT_NAME,
) -> RenderedAuthEmail:
    _require_link_or_code("password reset", reset_link, reset_code)
    return _render(
        subject="Reset your password",
        intro="Use the link or code below to reset your password.",
        link_label="Password reset link",
        link=reset_link,
        code_label="Password reset code",
        code=reset_code,
        expiration_minutes=expiration_minutes,
        product_name=product_name,
    )


def render_set_password_email(
    *,
    set_password_link: str | None = None,
    set_password_code: str | None = None,
    expiration_minutes: int | None = None,
    product_name: str = _PRODUCT_NAME,
) -> RenderedAuthEmail:
    _require_link_or_code(
        "set password",
        set_password_link,
        set_password_code,
    )
    return _render(
        subject="Set your password",
        intro=(
            "Use the link or code below to set a password for your migrated "
            "account."
        ),
        link_label="Set-password link",
        link=set_password_link,
        code_label="Set-password code",
        code=set_password_code,
        expiration_minutes=expiration_minutes,
        product_name=product_name,
    )
