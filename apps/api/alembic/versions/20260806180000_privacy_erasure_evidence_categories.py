"""Extend privacy-erasure destruction-evidence categories.

Revision ID: 20260806180000
Revises: 20260806170000
Create Date: 2026-08-06 18:00:00.000000
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260806180000"
down_revision: str | Sequence[str] | None = "20260806170000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_OLD_CATEGORIES = (
    "account",
    "profile",
    "contact",
    "membership",
    "registration",
    "credential",
    "session",
    "device",
    "synced_contact",
    "avatar",
    "privacy_request_content",
)
_NEW_CATEGORIES = _OLD_CATEGORIES + (
    "prayer_activity",
    "legal_acceptance",
    "feedback",
    "web_registration_intent",
)


def _constraint_expression(categories: tuple[str, ...]) -> str:
    values = ", ".join(f'"{category}"' for category in categories)
    return (
        "jsonb_typeof({column}) = 'array' "
        f"AND {{column}} <@ '[{values}]'::jsonb"
    )


def _replace_constraints(categories: tuple[str, ...]) -> None:
    for column in ("categories_deleted", "categories_retained"):
        name = f"privacy_destruction_evidence_{column}_check"
        op.drop_constraint(
            name,
            "privacy_destruction_evidence",
            type_="check",
        )
        op.create_check_constraint(
            name,
            "privacy_destruction_evidence",
            _constraint_expression(categories).format(column=column),
        )


def upgrade() -> None:
    _replace_constraints(_NEW_CATEGORIES)


def downgrade() -> None:
    _replace_constraints(_OLD_CATEGORIES)
