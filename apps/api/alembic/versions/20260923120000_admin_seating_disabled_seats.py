"""Persist disabled seating parts.

Revision ID: 20260923120000
Revises: 20260922120000
Create Date: 2026-09-23 12:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260923120000"
down_revision: str | Sequence[str] | None = "20260922120000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_ALLOWED_DISABLED_SEAT_PARTS = (
    "ARRAY['side:a:0', 'side:a:1', 'side:a:2', 'side:b:0', "
    "'side:b:1', 'side:b:2', 'end:a', 'end:b']::text[]"
)


def upgrade() -> None:
    op.add_column(
        "event_seating_tables",
        sa.Column(
            "disabled_seat_parts",
            postgresql.ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::text[]"),
        ),
    )
    op.create_check_constraint(
        "event_seating_tables_disabled_seat_parts_check",
        "event_seating_tables",
        "array_position(disabled_seat_parts, NULL) IS NULL "
        f"AND disabled_seat_parts <@ {_ALLOWED_DISABLED_SEAT_PARTS}",
    )


def downgrade() -> None:
    op.drop_constraint(
        "event_seating_tables_disabled_seat_parts_check",
        "event_seating_tables",
        type_="check",
    )
    op.drop_column("event_seating_tables", "disabled_seat_parts")
