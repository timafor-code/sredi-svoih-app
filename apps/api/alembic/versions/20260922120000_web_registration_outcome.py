"""Persist web registration completion outcomes.

Revision ID: 20260922120000
Revises: 20260911150000
Create Date: 2026-09-22 12:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260922120000"
down_revision: str | Sequence[str] | None = "20260911150000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("web_registration_intents", sa.Column("registration_outcome", sa.Text(), nullable=True))
    op.create_check_constraint("web_registration_intents_outcome_check", "web_registration_intents", "registration_outcome IS NULL OR registration_outcome IN ('created', 'already_registered')")
    op.add_column("web_registration_intents", sa.Column("registration_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "web_registration_intents_registration_id_fkey",
        "web_registration_intents",
        "event_registrations",
        ["registration_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("web_registration_intents_registration_id_fkey", "web_registration_intents", type_="foreignkey")
    op.drop_column("web_registration_intents", "registration_id")
    op.drop_constraint("web_registration_intents_outcome_check", "web_registration_intents", type_="check")
    op.drop_column("web_registration_intents", "registration_outcome")
