"""Repair unambiguous Jewish category/event-kind mismatches.

Revision ID: 20260908120000
Revises: 20260907210000
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260908120000"
down_revision: str | Sequence[str] | None = "20260907210000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE events
        SET event_kind = 'holiday'
        WHERE category = 'holiday' AND event_kind = 'single'
        """,
    )
    op.execute(
        """
        UPDATE events
        SET event_kind = 'shabbat'
        WHERE category = 'shabbat' AND event_kind = 'single'
        """,
    )


def downgrade() -> None:
    # This data repair is intentionally irreversible: existing canonical rows
    # cannot be distinguished safely from rows repaired by this revision.
    pass
