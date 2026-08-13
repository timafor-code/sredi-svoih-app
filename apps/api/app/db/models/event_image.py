from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models.base import Base
from app.db.models.core import timestamptz_now, uuid_pk


class EventImage(Base):
    __tablename__ = "event_images"
    __table_args__ = (
        CheckConstraint(
            "content_type = 'image/webp'",
            name="event_images_content_type_check",
        ),
        CheckConstraint(
            "size_bytes > 0",
            name="event_images_size_positive_check",
        ),
        CheckConstraint(
            "width > 0 AND height > 0",
            name="event_images_dimensions_positive_check",
        ),
        CheckConstraint(
            "content_sha256 ~ '^[0-9a-f]{64}$'",
            name="event_images_content_sha256_check",
        ),
        CheckConstraint(
            "status IN ('pending', 'active', 'delete_pending', 'deleted')",
            name="event_images_status_check",
        ),
        CheckConstraint(
            "status <> 'active' OR (activated_at IS NOT NULL AND deleted_at IS NULL)",
            name="event_images_active_lifecycle_check",
        ),
        CheckConstraint(
            "status <> 'deleted' OR deleted_at IS NOT NULL",
            name="event_images_deleted_lifecycle_check",
        ),
        UniqueConstraint("object_key", name="event_images_object_key_key"),
        Index("event_images_event_id_idx", "event_id"),
        Index("event_images_community_id_idx", "community_id"),
        Index("event_images_status_updated_idx", "status", "updated_at"),
        Index(
            "event_images_one_active_per_event_idx",
            "event_id",
            unique=True,
            postgresql_where=text("status = 'active' AND deleted_at IS NULL"),
        ),
    )

    id: Mapped[UUID] = uuid_pk()
    event_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("events.id", ondelete="CASCADE"),
        nullable=False,
    )
    community_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("communities.id", ondelete="CASCADE"),
        nullable=False,
    )
    object_key: Mapped[str] = mapped_column(Text, nullable=False)
    content_type: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'image/webp'"),
    )
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    content_sha256: Mapped[str] = mapped_column(Text, nullable=False)
    etag: Mapped[str | None] = mapped_column(Text)
    version_token: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        nullable=False,
        server_default=text("gen_random_uuid()"),
    )
    status: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'pending'"),
    )
    created_by: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("app_users.id", ondelete="SET NULL"),
    )
    created_at: Mapped[datetime] = timestamptz_now()
    updated_at: Mapped[datetime] = timestamptz_now()
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
