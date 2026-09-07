"""Default eligible events to direct-link web registration.

Revision ID: 20260907200000
Revises: 20260907190000
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260907200000"
down_revision: str | Sequence[str] | None = "20260907190000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE events
        SET web_visibility = 'unlisted'
        WHERE registration_mode IN ('internal_free', 'internal_paid')
          AND web_visibility = 'disabled'
        """,
    )


def downgrade() -> None:
    # This data backfill is intentionally irreversible: pre-existing unlisted
    # rows cannot be distinguished safely from rows changed by this revision.
    pass
