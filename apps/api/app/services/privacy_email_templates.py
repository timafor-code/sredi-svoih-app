from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RenderedPrivacyEmail:
    subject: str
    text_body: str


def render_privacy_access_code_email(
    *,
    code: str,
    expiration_minutes: int,
) -> RenderedPrivacyEmail:
    return RenderedPrivacyEmail(
        subject="Privacy access code",
        text_body=(
            "Use this six-digit code to access your privacy information:\n\n"
            f"{code}\n\n"
            f"The code expires in {expiration_minutes} minutes.\n"
            "Do not share this code with anyone.\n"
            "If you did not request this email, you can ignore it.\n"
        ),
    )
