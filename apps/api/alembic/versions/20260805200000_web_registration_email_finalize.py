"""Add hash-only web registration verification codes.

Revision ID: 20260805200000
Revises: 20260805160000
Create Date: 2026-08-05 20:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260805200000"
down_revision: str | Sequence[str] | None = "20260805160000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "web_registration_verification_codes",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "registration_intent_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column("code_hash", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "attempt_count",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "btrim(code_hash) <> ''",
            name="web_registration_verification_codes_hash_not_empty",
        ),
        sa.CheckConstraint(
            "attempt_count >= 0",
            name="web_registration_verification_codes_attempt_count_check",
        ),
        sa.CheckConstraint(
            "expires_at > created_at",
            name="web_registration_verification_codes_expiry_check",
        ),
        sa.CheckConstraint(
            "consumed_at IS NULL OR consumed_at >= created_at",
            name="web_registration_verification_codes_consumed_check",
        ),
        sa.ForeignKeyConstraint(
            ["registration_intent_id"],
            ["web_registration_intents.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "code_hash",
            name="web_registration_verification_codes_hash_key",
        ),
    )
    op.create_index(
        "web_registration_verification_codes_intent_id_idx",
        "web_registration_verification_codes",
        ["registration_intent_id"],
    )
    op.create_index(
        "web_registration_verification_codes_expires_at_idx",
        "web_registration_verification_codes",
        ["expires_at"],
    )
    op.create_index(
        "web_registration_verification_codes_consumed_at_idx",
        "web_registration_verification_codes",
        ["consumed_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "web_registration_verification_codes_consumed_at_idx",
        table_name="web_registration_verification_codes",
    )
    op.drop_index(
        "web_registration_verification_codes_expires_at_idx",
        table_name="web_registration_verification_codes",
    )
    op.drop_index(
        "web_registration_verification_codes_intent_id_idx",
        table_name="web_registration_verification_codes",
    )
    op.drop_table("web_registration_verification_codes")
