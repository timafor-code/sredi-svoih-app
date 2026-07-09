"""Create personal/privacy surfaces schema.

Revision ID: 20260709210000
Revises: 20260709191017
Create Date: 2026-07-09 21:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260709210000"
down_revision: str | Sequence[str] | None = "20260709191017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def id_pk() -> sa.Column:
    return sa.Column(
        "id",
        postgresql.UUID(as_uuid=True),
        server_default=sa.text("gen_random_uuid()"),
        nullable=False,
    )


def timestamptz_now(name: str) -> sa.Column:
    return sa.Column(
        name,
        sa.DateTime(timezone=True),
        server_default=sa.func.now(),
        nullable=False,
    )


def upgrade() -> None:
    op.create_table(
        "admin_feedback",
        id_pk(),
        sa.Column(
            "community_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("communities.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("section", sa.Text(), nullable=False),
        sa.Column("entity_type", sa.Text(), nullable=True),
        sa.Column("entity_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "severity",
            sa.Text(),
            server_default=sa.text("'note'"),
            nullable=False,
        ),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column(
            "status",
            sa.Text(),
            server_default=sa.text("'open'"),
            nullable=False,
        ),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column("url", sa.Text(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "resolved_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app_users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        timestamptz_now("created_at"),
        timestamptz_now("updated_at"),
        sa.CheckConstraint(
            "severity IN ('note', 'issue', 'blocker', 'idea')",
            name="admin_feedback_severity_check",
        ),
        sa.CheckConstraint(
            "status IN ('open', 'reviewed', 'resolved', 'closed')",
            name="admin_feedback_status_check",
        ),
        sa.CheckConstraint(
            "btrim(section) <> ''",
            name="admin_feedback_section_not_blank_check",
        ),
        sa.CheckConstraint(
            "btrim(message) <> ''",
            name="admin_feedback_message_not_blank_check",
        ),
        sa.CheckConstraint(
            "char_length(section) <= 80",
            name="admin_feedback_section_length_check",
        ),
        sa.CheckConstraint(
            "entity_type IS NULL OR char_length(entity_type) <= 80",
            name="admin_feedback_entity_type_length_check",
        ),
        sa.CheckConstraint(
            "char_length(message) <= 4000",
            name="admin_feedback_message_length_check",
        ),
        sa.CheckConstraint(
            "user_agent IS NULL OR char_length(user_agent) <= 500",
            name="admin_feedback_user_agent_length_check",
        ),
        sa.CheckConstraint(
            "url IS NULL OR char_length(url) <= 1000",
            name="admin_feedback_url_length_check",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "admin_feedback_community_created_idx",
        "admin_feedback",
        ["community_id", sa.text("created_at DESC")],
    )
    op.create_index(
        "admin_feedback_status_created_idx",
        "admin_feedback",
        ["status", sa.text("created_at DESC")],
    )
    op.create_index(
        "admin_feedback_user_created_idx",
        "admin_feedback",
        ["user_id", sa.text("created_at DESC")],
    )

    op.create_table(
        "community_contacts",
        id_pk(),
        sa.Column(
            "community_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("communities.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("full_name", sa.Text(), nullable=False),
        sa.Column("hebrew_name", sa.Text(), nullable=True),
        sa.Column("role", sa.Text(), nullable=True),
        sa.Column("city", sa.Text(), nullable=True),
        timestamptz_now("created_at"),
        sa.CheckConstraint(
            "btrim(full_name) <> ''",
            name="community_contacts_full_name_not_empty_check",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "community_contacts_community_id_idx",
        "community_contacts",
        ["community_id"],
    )

    op.create_table(
        "device_tokens",
        id_pk(),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "platform",
            sa.Text(),
            server_default=sa.text("'unknown'"),
            nullable=False,
        ),
        sa.Column(
            "push_provider",
            sa.Text(),
            server_default=sa.text("'expo'"),
            nullable=False,
        ),
        sa.Column("expo_push_token", sa.Text(), nullable=False),
        sa.Column("device_id", sa.Text(), nullable=True),
        sa.Column("app_version", sa.Text(), nullable=True),
        sa.Column("build_version", sa.Text(), nullable=True),
        sa.Column(
            "environment",
            sa.Text(),
            server_default=sa.text("'development'"),
            nullable=False,
        ),
        sa.Column(
            "is_active",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        timestamptz_now("last_seen_at"),
        timestamptz_now("created_at"),
        timestamptz_now("updated_at"),
        sa.CheckConstraint(
            "platform IN ('ios', 'android', 'web', 'unknown')",
            name="device_tokens_platform_check",
        ),
        sa.CheckConstraint(
            "push_provider IN ('expo')",
            name="device_tokens_push_provider_check",
        ),
        sa.CheckConstraint(
            "environment IN ('development', 'preview', 'production', 'unknown')",
            name="device_tokens_environment_check",
        ),
        sa.CheckConstraint(
            "btrim(expo_push_token) <> ''",
            name="device_tokens_expo_push_token_not_empty_check",
        ),
        sa.UniqueConstraint(
            "user_id",
            "expo_push_token",
            name="device_tokens_user_expo_push_token_key",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("device_tokens_user_id_idx", "device_tokens", ["user_id"])
    op.create_index(
        "device_tokens_active_user_idx",
        "device_tokens",
        ["user_id"],
        postgresql_where=sa.text("is_active = true"),
    )

    op.create_table(
        "prayer_activity_logs",
        id_pk(),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("activity_type", sa.Text(), nullable=False),
        sa.Column("activity_date", sa.Date(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "timezone",
            sa.Text(),
            server_default=sa.text("'Europe/Moscow'"),
            nullable=False,
        ),
        sa.Column("city", sa.Text(), nullable=True),
        sa.Column(
            "hebrew_date",
            postgresql.JSONB(),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "metadata",
            postgresql.JSONB(),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        timestamptz_now("created_at"),
        timestamptz_now("updated_at"),
        sa.CheckConstraint(
            (
                "activity_type IN ('shacharit', 'mincha', 'maariv', "
                "'shema_morning', 'shema_evening', 'omer_count')"
            ),
            name="prayer_activity_logs_activity_type_check",
        ),
        sa.CheckConstraint(
            "started_at IS NOT NULL OR completed_at IS NOT NULL",
            name="prayer_activity_logs_has_activity_timestamp_check",
        ),
        sa.UniqueConstraint(
            "user_id",
            "activity_date",
            "activity_type",
            name="prayer_activity_logs_user_date_type_key",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "prayer_activity_logs_user_activity_date_idx",
        "prayer_activity_logs",
        ["user_id", sa.text("activity_date DESC")],
    )
    op.create_index(
        "prayer_activity_logs_activity_type_idx",
        "prayer_activity_logs",
        ["activity_type"],
    )

    op.create_table(
        "profile_contact_visibility",
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "show_in_community_directory",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "share_phone",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "share_email",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "share_birth_date",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "share_hebrew_birth_date",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "share_city",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "share_hebrew_name",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "birthday_reminders_enabled",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        timestamptz_now("created_at"),
        timestamptz_now("updated_at"),
        sa.PrimaryKeyConstraint("user_id"),
    )
    op.create_index(
        "profile_contact_visibility_directory_user_idx",
        "profile_contact_visibility",
        ["user_id"],
        postgresql_where=sa.text("show_in_community_directory = true"),
    )

    op.create_table(
        "synced_contacts",
        id_pk(),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.Text(), nullable=True),
        sa.Column("phone_hash", sa.Text(), nullable=True),
        sa.Column("email_hash", sa.Text(), nullable=True),
        sa.Column("birthday", sa.Date(), nullable=True),
        sa.Column("consented_at", sa.DateTime(timezone=True), nullable=True),
        timestamptz_now("created_at"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("synced_contacts_user_id_idx", "synced_contacts", ["user_id"])

    op.create_table(
        "push_notification_jobs",
        id_pk(),
        sa.Column(
            "community_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("communities.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app_users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("notification_kind", sa.Text(), nullable=False),
        sa.Column("audience", sa.Text(), nullable=False),
        sa.Column(
            "event_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("events.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "occurrence_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("event_occurrences.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "registration_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("event_registrations.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "target_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app_users.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "data",
            postgresql.JSONB(),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Text(),
            server_default=sa.text("'queued'"),
            nullable=False,
        ),
        timestamptz_now("queued_at"),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        timestamptz_now("created_at"),
        timestamptz_now("updated_at"),
        sa.CheckConstraint(
            (
                "notification_kind IN ('event_created', 'event_updated', "
                "'event_cancelled', 'registration_confirmed', "
                "'registration_rejected', 'waitlist_available', 'news', 'manual')"
            ),
            name="push_notification_jobs_notification_kind_check",
        ),
        sa.CheckConstraint(
            (
                "audience IN ('event_registrants', 'community_members', "
                "'single_user', 'manual_tokens')"
            ),
            name="push_notification_jobs_audience_check",
        ),
        sa.CheckConstraint(
            (
                "status IN ('queued', 'processing', 'sent', 'partially_sent', "
                "'failed', 'cancelled')"
            ),
            name="push_notification_jobs_status_check",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "push_notification_jobs_community_created_at_idx",
        "push_notification_jobs",
        ["community_id", sa.text("created_at DESC")],
    )
    op.create_index(
        "push_notification_jobs_event_id_idx",
        "push_notification_jobs",
        ["event_id"],
    )
    op.create_index(
        "push_notification_jobs_status_queued_at_idx",
        "push_notification_jobs",
        ["status", "queued_at"],
    )
    op.create_index(
        "push_notification_jobs_created_by_idx",
        "push_notification_jobs",
        ["created_by"],
    )
    op.create_index(
        "push_notification_jobs_target_user_id_idx",
        "push_notification_jobs",
        ["target_user_id"],
        postgresql_where=sa.text("target_user_id IS NOT NULL"),
    )

    op.create_table(
        "push_notification_deliveries",
        id_pk(),
        sa.Column(
            "job_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("push_notification_jobs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "device_token_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("device_tokens.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("expo_push_token", sa.Text(), nullable=False),
        sa.Column(
            "status",
            sa.Text(),
            server_default=sa.text("'queued'"),
            nullable=False,
        ),
        sa.Column("expo_ticket_id", sa.Text(), nullable=True),
        sa.Column("expo_receipt_id", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        timestamptz_now("created_at"),
        timestamptz_now("updated_at"),
        sa.CheckConstraint(
            "status IN ('queued', 'sent', 'failed', 'skipped', 'receipt_checked')",
            name="push_notification_deliveries_status_check",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "push_notification_deliveries_job_id_idx",
        "push_notification_deliveries",
        ["job_id"],
    )
    op.create_index(
        "push_notification_deliveries_status_created_at_idx",
        "push_notification_deliveries",
        ["status", "created_at"],
    )
    op.create_index(
        "push_notification_deliveries_user_id_idx",
        "push_notification_deliveries",
        ["user_id"],
    )
    op.create_index(
        "push_notification_deliveries_device_token_id_idx",
        "push_notification_deliveries",
        ["device_token_id"],
        postgresql_where=sa.text("device_token_id IS NOT NULL"),
    )
    op.create_index(
        "push_notification_deliveries_job_device_token_key",
        "push_notification_deliveries",
        ["job_id", "device_token_id"],
        unique=True,
        postgresql_where=sa.text("device_token_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "push_notification_deliveries_job_device_token_key",
        table_name="push_notification_deliveries",
    )
    op.drop_index(
        "push_notification_deliveries_device_token_id_idx",
        table_name="push_notification_deliveries",
    )
    op.drop_index(
        "push_notification_deliveries_user_id_idx",
        table_name="push_notification_deliveries",
    )
    op.drop_index(
        "push_notification_deliveries_status_created_at_idx",
        table_name="push_notification_deliveries",
    )
    op.drop_index(
        "push_notification_deliveries_job_id_idx",
        table_name="push_notification_deliveries",
    )
    op.drop_table("push_notification_deliveries")

    op.drop_index(
        "push_notification_jobs_target_user_id_idx",
        table_name="push_notification_jobs",
    )
    op.drop_index(
        "push_notification_jobs_created_by_idx",
        table_name="push_notification_jobs",
    )
    op.drop_index(
        "push_notification_jobs_status_queued_at_idx",
        table_name="push_notification_jobs",
    )
    op.drop_index(
        "push_notification_jobs_event_id_idx",
        table_name="push_notification_jobs",
    )
    op.drop_index(
        "push_notification_jobs_community_created_at_idx",
        table_name="push_notification_jobs",
    )
    op.drop_table("push_notification_jobs")

    op.drop_index("synced_contacts_user_id_idx", table_name="synced_contacts")
    op.drop_table("synced_contacts")

    op.drop_index(
        "profile_contact_visibility_directory_user_idx",
        table_name="profile_contact_visibility",
    )
    op.drop_table("profile_contact_visibility")

    op.drop_index(
        "prayer_activity_logs_activity_type_idx",
        table_name="prayer_activity_logs",
    )
    op.drop_index(
        "prayer_activity_logs_user_activity_date_idx",
        table_name="prayer_activity_logs",
    )
    op.drop_table("prayer_activity_logs")

    op.drop_index("device_tokens_active_user_idx", table_name="device_tokens")
    op.drop_index("device_tokens_user_id_idx", table_name="device_tokens")
    op.drop_table("device_tokens")

    op.drop_index(
        "community_contacts_community_id_idx",
        table_name="community_contacts",
    )
    op.drop_table("community_contacts")

    op.drop_index("admin_feedback_user_created_idx", table_name="admin_feedback")
    op.drop_index("admin_feedback_status_created_idx", table_name="admin_feedback")
    op.drop_index("admin_feedback_community_created_idx", table_name="admin_feedback")
    op.drop_table("admin_feedback")
