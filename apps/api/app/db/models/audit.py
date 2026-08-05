from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, Index, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models.base import Base
from app.db.models.core import timestamptz_now, uuid_pk


class AdminEventAuditEntry(Base):
    __tablename__ = "admin_event_audit_entries"
    __table_args__ = (
        CheckConstraint(
            "action = 'event_web_visibility_changed'",
            name="admin_event_audit_entries_action_check",
        ),
        CheckConstraint(
            "old_state IN ('disabled', 'unlisted', 'listed')",
            name="admin_event_audit_entries_old_state_check",
        ),
        CheckConstraint(
            "new_state IN ('disabled', 'unlisted', 'listed')",
            name="admin_event_audit_entries_new_state_check",
        ),
        CheckConstraint(
            "old_state <> new_state",
            name="admin_event_audit_entries_state_changed_check",
        ),
        Index("admin_event_audit_entries_actor_user_id_idx", "actor_user_id"),
        Index("admin_event_audit_entries_event_id_idx", "event_id"),
        Index("admin_event_audit_entries_created_at_idx", "created_at"),
        Index(
            "admin_event_audit_entries_event_created_at_idx",
            "event_id",
            "created_at",
        ),
    )

    id: Mapped[UUID] = uuid_pk()
    actor_user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        nullable=False,
    )
    event_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        nullable=False,
    )
    action: Mapped[str] = mapped_column(Text, nullable=False)
    old_state: Mapped[str] = mapped_column(Text, nullable=False)
    new_state: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = timestamptz_now()
