from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models.base import Base
from app.db.models.core import timestamptz_now, uuid_pk


class ProfileAvatar(Base):
    __tablename__ = "profile_avatars"
    __table_args__ = (
        CheckConstraint(
            "content_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')",
            name="profile_avatars_content_type_check",
        ),
        CheckConstraint(
            "size_bytes IS NULL OR size_bytes > 0",
            name="profile_avatars_size_positive_check",
        ),
        CheckConstraint(
            "status IN ('pending', 'active', 'deleted')",
            name="profile_avatars_status_check",
        ),
        UniqueConstraint("object_key", name="profile_avatars_object_key_key"),
        Index("profile_avatars_user_status_idx", "user_id", "status"),
        Index("profile_avatars_user_created_idx", "user_id", text("created_at DESC")),
        Index(
            "profile_avatars_active_user_key",
            "user_id",
            unique=True,
            postgresql_where=text("status = 'active' AND deleted_at IS NULL"),
        ),
    )

    id: Mapped[UUID] = uuid_pk()
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("app_users.id", ondelete="CASCADE"),
        nullable=False,
    )
    object_key: Mapped[str] = mapped_column(Text, nullable=False)
    content_type: Mapped[str] = mapped_column(Text, nullable=False)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger)
    etag: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'pending'"),
    )
    created_at: Mapped[datetime] = timestamptz_now()
    updated_at: Mapped[datetime] = timestamptz_now()
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
