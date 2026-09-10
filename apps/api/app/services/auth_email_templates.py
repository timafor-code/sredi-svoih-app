from __future__ import annotations

from dataclasses import dataclass

_PRODUCT_NAME = "Sredi Svoih"


@dataclass(frozen=True)
class RenderedAuthEmail:
    subject: str
    text_body: str


def _render(
    *,
    subject: str,
    intro: str,
    code_label: str,
    code: str,
    expiration_minutes: int | None,
    product_name: str,
) -> RenderedAuthEmail:
    lines = [
        intro,
        "",
        f"{code_label}: {code}",
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
    verification_code: str,
    expiration_minutes: int | None = None,
    product_name: str = _PRODUCT_NAME,
) -> RenderedAuthEmail:
    return _render(
        subject="Verify your email address",
        intro="Use the code below to verify your email address.",
        code_label="Verification code",
        code=verification_code,
        expiration_minutes=expiration_minutes,
        product_name=product_name,
    )


def render_password_reset_email(
    *,
    reset_code: str,
    expiration_minutes: int | None = None,
    product_name: str = _PRODUCT_NAME,
) -> RenderedAuthEmail:
    return _render(
        subject="Reset your password",
        intro="Use the code below to reset your password.",
        code_label="Password reset code",
        code=reset_code,
        expiration_minutes=expiration_minutes,
        product_name=product_name,
    )


def render_set_password_email(
    *,
    set_password_code: str,
    expiration_minutes: int | None = None,
    product_name: str = _PRODUCT_NAME,
) -> RenderedAuthEmail:
    return _render(
        subject="Set your password",
        intro=(
            "Use the code below to set a password for your migrated "
            "account."
        ),
        code_label="Set-password code",
        code=set_password_code,
        expiration_minutes=expiration_minutes,
        product_name=product_name,
    )
