"""Harden manually entered auth email codes.

Revision ID: 20260910190000
Revises: 20260908120000
Create Date: 2026-09-10 19:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260910190000"
down_revision: str | Sequence[str] | None = "20260908120000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_TABLES = (
    "auth_email_verification_codes",
    "password_reset_codes",
    "auth_set_password_codes",
)


def upgrade() -> None:
    for table_name in _TABLES:
        op.add_column(
            table_name,
            sa.Column(
                "attempt_count",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("0"),
            ),
        )
        op.create_check_constraint(
            f"{table_name}_attempt_count_check",
            table_name,
            "attempt_count >= 0",
        )
        op.drop_constraint(f"{table_name}_code_hash_key", table_name, type_="unique")


def downgrade() -> None:
    for table_name in _TABLES:
        op.execute(
            sa.text(
                f"""
                DO $$
                BEGIN
                    IF EXISTS (
                        SELECT 1
                        FROM {table_name}
                        GROUP BY code_hash
                        HAVING count(*) > 1
                    ) THEN
                        RAISE EXCEPTION
                            'Cannot restore %: duplicate code_hash values exist',
                            '{table_name}';
                    END IF;
                END $$;
                """,
            ),
        )
        op.create_unique_constraint(
            f"{table_name}_code_hash_key",
            table_name,
            ["code_hash"],
        )
        op.drop_constraint(f"{table_name}_attempt_count_check", table_name, type_="check")
        op.drop_column(table_name, "attempt_count")
