from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RenderedPrivacyErasureEmail:
    subject: str
    text_body: str


def render_privacy_erasure_accepted_email() -> RenderedPrivacyErasureEmail:
    return RenderedPrivacyErasureEmail(
        subject="Data deletion request accepted",
        text_body="\n".join(
            (
                "Your data deletion request has been accepted.",
                "New processing has been stopped and future free event "
                "registrations have been cancelled.",
                "You may cancel the deletion request only before irreversible "
                "execution begins.",
                "Cancelled event registrations are not restored automatically; "
                "you must register again after cancelling the request.",
                "This notice does not confirm that final deletion is complete.",
            ),
        ),
    )
