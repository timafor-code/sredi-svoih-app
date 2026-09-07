"""Add nullable structured event schedule.

Revision ID: 20260904180000
Revises: 20260816184500
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260904180000"
down_revision: str | Sequence[str] | None = "20260816184500"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("events", sa.Column("schedule", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("events", "schedule")
