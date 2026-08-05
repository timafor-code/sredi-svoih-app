"""Add public web registration intents and identity conflicts.

Revision ID: 20260805160000
Revises: 20260805120000
Create Date: 2026-08-05 16:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260805160000"
down_revision: str | Sequence[str] | None = "20260805120000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "web_registration_intents",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("flow_token_hash", sa.Text(), nullable=False),
        sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("occurrence_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("matched_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("first_name", sa.Text(), nullable=False),
        sa.Column("last_name", sa.Text(), nullable=False),
        sa.Column("email_normalized", sa.Text(), nullable=False),
        sa.Column("phone_normalized", sa.Text(), nullable=False),
        sa.Column("seats_count", sa.Integer(), nullable=False),
        sa.Column("option_payload", postgresql.JSONB(), nullable=False),
        sa.Column("answer_payload", postgresql.JSONB(), nullable=True),
        sa.Column("legal_acceptance_payload", postgresql.JSONB(), nullable=False),
        sa.Column("account_choice", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("idempotency_key_hash", sa.Text(), nullable=False),
        sa.Column("request_fingerprint_hash", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("btrim(flow_token_hash) <> ''", name="web_registration_intents_flow_hash_not_empty"),
        sa.CheckConstraint("btrim(first_name) <> ''", name="web_registration_intents_first_name_not_empty"),
        sa.CheckConstraint("btrim(last_name) <> ''", name="web_registration_intents_last_name_not_empty"),
        sa.CheckConstraint("btrim(email_normalized) <> ''", name="web_registration_intents_email_not_empty"),
        sa.CheckConstraint("btrim(phone_normalized) <> ''", name="web_registration_intents_phone_not_empty"),
        sa.CheckConstraint("seats_count > 0", name="web_registration_intents_seats_positive"),
        sa.CheckConstraint("account_choice IN ('without_password', 'create_account')", name="web_registration_intents_account_choice_check"),
        sa.CheckConstraint("status IN ('email_verification_required', 'confirmed', 'expired', 'failed')", name="web_registration_intents_status_check"),
        sa.CheckConstraint("btrim(idempotency_key_hash) <> ''", name="web_registration_intents_idempotency_hash_not_empty"),
        sa.CheckConstraint("btrim(request_fingerprint_hash) <> ''", name="web_registration_intents_fingerprint_not_empty"),
        sa.CheckConstraint("expires_at > created_at", name="web_registration_intents_expiry_check"),
        sa.CheckConstraint("confirmed_at IS NULL OR status = 'confirmed'", name="web_registration_intents_confirmed_at_check"),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["occurrence_id"], ["event_occurrences.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["matched_user_id"], ["app_users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("flow_token_hash", name="web_registration_intents_flow_token_hash_key"),
        sa.UniqueConstraint("idempotency_key_hash", name="web_registration_intents_idempotency_key_hash_key"),
    )
    for name, columns in (
        ("web_registration_intents_expires_at_idx", ["expires_at"]),
        ("web_registration_intents_event_id_idx", ["event_id"]),
        ("web_registration_intents_occurrence_id_idx", ["occurrence_id"]),
        ("web_registration_intents_status_idx", ["status"]),
    ):
        op.create_index(name, "web_registration_intents", columns)

    op.create_table(
        "web_registration_identity_conflicts",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("registration_intent_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("category", sa.Text(), nullable=False),
        sa.Column("email_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("phone_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.Text(), server_default=sa.text("'open'"), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("category = 'email_phone_different_users'", name="web_registration_identity_conflicts_category_check"),
        sa.CheckConstraint("status IN ('open', 'resolved')", name="web_registration_identity_conflicts_status_check"),
        sa.CheckConstraint("resolved_at IS NULL OR status = 'resolved'", name="web_registration_identity_conflicts_resolved_at_check"),
        sa.ForeignKeyConstraint(["registration_intent_id"], ["web_registration_intents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["email_user_id"], ["app_users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["phone_user_id"], ["app_users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("registration_intent_id", name="web_registration_identity_conflicts_intent_key"),
    )
    op.create_index("web_registration_identity_conflicts_status_idx", "web_registration_identity_conflicts", ["status"])


def downgrade() -> None:
    op.drop_index("web_registration_identity_conflicts_status_idx", table_name="web_registration_identity_conflicts")
    op.drop_table("web_registration_identity_conflicts")
    for name in (
        "web_registration_intents_status_idx", "web_registration_intents_occurrence_id_idx",
        "web_registration_intents_event_id_idx", "web_registration_intents_expires_at_idx",
    ):
        op.drop_index(name, table_name="web_registration_intents")
    op.drop_table("web_registration_intents")
