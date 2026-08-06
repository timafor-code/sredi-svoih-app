"""Make the admin event audit actor reference erasure-safe.

Revision ID: 20260806190000
Revises: 20260806180000
Create Date: 2026-08-06 19:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260806190000"
down_revision: str | Sequence[str] | None = "20260806180000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_ORPHAN_ACTOR_COUNT = sa.text(
    """
    SELECT count(*)
    FROM admin_event_audit_entries AS audit
    LEFT JOIN app_users AS users ON users.id = audit.actor_user_id
    WHERE audit.actor_user_id IS NOT NULL
      AND users.id IS NULL
    """,
)
_NULL_ACTOR_COUNT = sa.text(
    """
    SELECT count(*)
    FROM admin_event_audit_entries
    WHERE actor_user_id IS NULL
    """,
)


def _aggregate_count(statement: sa.TextClause) -> int:
    return int(op.get_bind().scalar(statement) or 0)


def upgrade() -> None:
    orphan_count = _aggregate_count(_ORPHAN_ACTOR_COUNT)
    if orphan_count:
        raise RuntimeError(
            "admin event audit actor FK preflight failed; "
            f"orphan actor aggregate count: {orphan_count}",
        )

    op.alter_column(
        "admin_event_audit_entries",
        "actor_user_id",
        existing_type=sa.UUID(),
        nullable=True,
    )
    op.create_foreign_key(
        "admin_event_audit_entries_actor_user_id_fkey",
        "admin_event_audit_entries",
        "app_users",
        ["actor_user_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    null_count = _aggregate_count(_NULL_ACTOR_COUNT)
    if null_count:
        raise RuntimeError(
            "admin event audit actor FK downgrade blocked; "
            f"null actor aggregate count: {null_count}",
        )

    op.drop_constraint(
        "admin_event_audit_entries_actor_user_id_fkey",
        "admin_event_audit_entries",
        type_="foreignkey",
    )
    op.alter_column(
        "admin_event_audit_entries",
        "actor_user_id",
        existing_type=sa.UUID(),
        nullable=False,
    )
