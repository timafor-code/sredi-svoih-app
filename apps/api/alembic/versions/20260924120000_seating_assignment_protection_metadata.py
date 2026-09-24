"""Persist seating assignment protection metadata.

Revision ID: 20260924120000
Revises: 20260923120000
Create Date: 2026-09-24 12:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260924120000"
down_revision: str | Sequence[str] | None = "20260923120000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "event_seating_assignments",
        sa.Column(
            "locked",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "event_seating_assignments",
        sa.Column("placement_source", sa.Text(), nullable=True),
    )
    op.create_check_constraint(
        "event_seating_assignments_placement_source_check",
        "event_seating_assignments",
        "placement_source IS NULL OR placement_source IN ('manual', 'auto', 'reserve')",
    )


def downgrade() -> None:
    op.drop_constraint(
        "event_seating_assignments_placement_source_check",
        "event_seating_assignments",
        type_="check",
    )
    op.drop_column("event_seating_assignments", "placement_source")
    op.drop_column("event_seating_assignments", "locked")
