"""Add API credential version to app users.

Revision ID: 20260806170000
Revises: 20260806160000
Create Date: 2026-08-06 17:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260806170000"
down_revision: str | Sequence[str] | None = "20260806160000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "app_users",
        sa.Column(
            "auth_token_version",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
    )
    op.create_check_constraint(
        "app_users_auth_token_version_nonnegative_check",
        "app_users",
        "auth_token_version >= 0",
    )


def downgrade() -> None:
    op.drop_constraint(
        "app_users_auth_token_version_nonnegative_check",
        "app_users",
        type_="check",
    )
    op.drop_column("app_users", "auth_token_version")
