"""Add event web publication visibility.

Revision ID: 20260805220000
Revises: 20260805210000
Create Date: 2026-08-05 22:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260805220000"
down_revision: str | Sequence[str] | None = "20260805210000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "events",
        sa.Column(
            "web_visibility",
            sa.Text(),
            server_default=sa.text("'disabled'"),
            nullable=False,
        ),
    )
    op.create_check_constraint(
        "events_web_visibility_check",
        "events",
        "web_visibility IN ('disabled', 'unlisted', 'listed')",
    )


def downgrade() -> None:
    op.drop_constraint(
        "events_web_visibility_check",
        "events",
        type_="check",
    )
    op.drop_column("events", "web_visibility")
