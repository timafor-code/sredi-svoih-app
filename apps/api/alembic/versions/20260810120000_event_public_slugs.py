"""Add canonical event public slugs and aliases.

Revision ID: 20260810120000
Revises: 20260807160000
Create Date: 2026-08-10 12:00:00.000000
"""

from collections.abc import Sequence
from uuid import UUID

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from app.services.event_public_slugs import iter_automatic_public_slug_candidates

revision: str = "20260810120000"
down_revision: str | Sequence[str] | None = "20260807160000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SLUG_AUDIT_COUNT = sa.text(
    """
    SELECT count(*)
    FROM admin_event_audit_entries
    WHERE action = 'event_public_slug_changed'
    """,
)


def _replace_audit_constraints(*, include_slug_action: bool) -> None:
    for name in (
        "admin_event_audit_entries_action_check",
        "admin_event_audit_entries_old_state_check",
        "admin_event_audit_entries_new_state_check",
    ):
        op.drop_constraint(name, "admin_event_audit_entries", type_="check")

    if include_slug_action:
        action_sql = (
            "action IN ('event_web_visibility_changed', "
            "'event_public_slug_changed')"
        )
        old_state_sql = (
            "(action = 'event_web_visibility_changed' AND "
            "old_state IN ('disabled', 'unlisted', 'listed')) OR "
            "(action = 'event_public_slug_changed' AND "
            "length(old_state) BETWEEN 2 AND 80 AND "
            "old_state ~ '^[a-z0-9]+(-[a-z0-9]+)*$')"
        )
        new_state_sql = (
            "(action = 'event_web_visibility_changed' AND "
            "new_state IN ('disabled', 'unlisted', 'listed')) OR "
            "(action = 'event_public_slug_changed' AND "
            "length(new_state) BETWEEN 2 AND 80 AND "
            "new_state ~ '^[a-z0-9]+(-[a-z0-9]+)*$')"
        )
    else:
        action_sql = "action = 'event_web_visibility_changed'"
        old_state_sql = "old_state IN ('disabled', 'unlisted', 'listed')"
        new_state_sql = "new_state IN ('disabled', 'unlisted', 'listed')"

    op.create_check_constraint(
        "admin_event_audit_entries_action_check",
        "admin_event_audit_entries",
        action_sql,
    )
    op.create_check_constraint(
        "admin_event_audit_entries_old_state_check",
        "admin_event_audit_entries",
        old_state_sql,
    )
    op.create_check_constraint(
        "admin_event_audit_entries_new_state_check",
        "admin_event_audit_entries",
        new_state_sql,
    )


def _backfill_event_public_slugs() -> None:
    bind = op.get_bind()
    events = bind.execute(
        sa.text(
            """
            SELECT id, title, created_at, created_by
            FROM events
            ORDER BY created_at, id
            """,
        ),
    ).mappings()

    used_slugs: set[str] = set()
    rows: list[dict[str, object]] = []
    for event in events:
        event_id = UUID(str(event["id"]))
        candidate = next(
            (
                value
                for value in iter_automatic_public_slug_candidates(
                    str(event["title"]),
                    event_id,
                )
                if value not in used_slugs
            ),
            None,
        )
        if candidate is None:
            raise RuntimeError("Could not allocate a public slug during backfill")
        used_slugs.add(candidate)
        rows.append(
            {
                "event_id": event_id,
                "slug": candidate,
                "is_canonical": True,
                "created_at": event["created_at"],
                "created_by": event["created_by"],
            },
        )

    if rows:
        slug_table = sa.table(
            "event_public_slugs",
            sa.column("event_id", postgresql.UUID(as_uuid=True)),
            sa.column("slug", sa.Text()),
            sa.column("is_canonical", sa.Boolean()),
            sa.column("created_at", sa.DateTime(timezone=True)),
            sa.column("created_by", postgresql.UUID(as_uuid=True)),
        )
        op.bulk_insert(slug_table, rows)


def upgrade() -> None:
    op.create_table(
        "event_public_slugs",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("slug", sa.Text(), nullable=False),
        sa.Column("is_canonical", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint(
            (
                "slug = lower(slug) AND length(slug) BETWEEN 2 AND 80 AND "
                "slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'"
            ),
            name="event_public_slugs_format_check",
        ),
        sa.CheckConstraint(
            (
                "slug !~ "
                "'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'"
            ),
            name="event_public_slugs_not_uuid_check",
        ),
        sa.CheckConstraint(
            (
                "slug NOT IN ('new', 'admin', 'api', 'auth', 'privacy', "
                "'support', 'assets', 'static', 'null', 'undefined')"
            ),
            name="event_public_slugs_reserved_check",
        ),
        sa.ForeignKeyConstraint(
            ["event_id"],
            ["events.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "event_public_slugs_lower_slug_key",
        "event_public_slugs",
        [sa.text("lower(slug)")],
        unique=True,
    )
    op.create_index(
        "event_public_slugs_one_canonical_per_event_idx",
        "event_public_slugs",
        ["event_id"],
        unique=True,
        postgresql_where=sa.text("is_canonical"),
    )
    op.create_index(
        "event_public_slugs_event_id_idx",
        "event_public_slugs",
        ["event_id"],
    )

    _backfill_event_public_slugs()
    _replace_audit_constraints(include_slug_action=True)


def downgrade() -> None:
    slug_audit_count = int(op.get_bind().scalar(_SLUG_AUDIT_COUNT) or 0)
    if slug_audit_count:
        raise RuntimeError(
            "event public slug downgrade blocked; "
            f"slug audit aggregate count: {slug_audit_count}",
        )

    _replace_audit_constraints(include_slug_action=False)
    op.drop_index(
        "event_public_slugs_event_id_idx",
        table_name="event_public_slugs",
    )
    op.drop_index(
        "event_public_slugs_one_canonical_per_event_idx",
        table_name="event_public_slugs",
    )
    op.drop_index(
        "event_public_slugs_lower_slug_key",
        table_name="event_public_slugs",
    )
    op.drop_table("event_public_slugs")
