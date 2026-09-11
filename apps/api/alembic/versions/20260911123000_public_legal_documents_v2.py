"""Publish canonical v2.0 privacy and event-registration legal documents.

Revision ID: 20260911123000
Revises: 20260910190000
Create Date: 2026-09-11 12:30:00.000000
"""

from collections.abc import Sequence
from datetime import datetime

from alembic import op
import sqlalchemy as sa


revision: str = "20260911123000"
down_revision: str | Sequence[str] | None = "20260910190000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_EFFECTIVE_AT = datetime.fromisoformat("2026-09-11T00:00:00+03:00")
_DOCUMENTS = (
    {
        "id": "26956e9e-ce82-5f92-8bb4-408ce2a10a54",
        "document_type": "privacy_policy",
        "version": "2.0",
        "title": "Политика обработки персональных данных",
        "content_hash": "sha256:1631054c13ed0cc4dc46d85e4fa61579ef02fa77a7682a7041a2990ea4ce5aef",
        "published_url": "https://reg.sredisvoihapp.ru/legal/privacy-policy-v2.0.html",
    },
    {
        "id": "792d2a35-5b8e-5219-9be3-62c2e6af9a06",
        "document_type": "event_registration_consent",
        "version": "2.0",
        "title": "Согласие на обработку персональных данных для регистрации на мероприятие",
        "content_hash": "sha256:a44b4a28940e7a1d021a747d0f30024d6b98f49032267a85cb44e41f2f0ac16a",
        "published_url": "https://reg.sredisvoihapp.ru/legal/event-registration-personal-data-consent-v2.0.html",
    },
)


def upgrade() -> None:
    bind = op.get_bind()
    document_types = tuple(document["document_type"] for document in _DOCUMENTS)

    bind.execute(
        sa.text(
            "UPDATE legal_documents "
            "SET retired_at = CAST(:effective_at AS timestamptz), updated_at = now() "
            "WHERE document_type IN :document_types "
            "AND retired_at IS NULL "
            "AND effective_at <= CAST(:effective_at AS timestamptz)"
        ).bindparams(sa.bindparam("document_types", expanding=True)),
        {"effective_at": _EFFECTIVE_AT, "document_types": document_types},
    )

    for document in _DOCUMENTS:
        bind.execute(
            sa.text(
                "INSERT INTO legal_documents "
                "(id, document_type, version, title, content_hash, published_url, effective_at) "
                "VALUES "
                "(CAST(:id AS uuid), :document_type, :version, :title, :content_hash, "
                ":published_url, CAST(:effective_at AS timestamptz))"
            ),
            {**document, "effective_at": _EFFECTIVE_AT},
        )


def downgrade() -> None:
    bind = op.get_bind()
    document_ids = tuple(document["id"] for document in _DOCUMENTS)
    referenced = bind.scalar(
        sa.text(
            "SELECT count(*) FROM legal_acceptances "
            "WHERE legal_document_id IN :document_ids"
        ).bindparams(sa.bindparam("document_ids", expanding=True)),
        {"document_ids": document_ids},
    )
    if referenced:
        raise RuntimeError(
            "public legal documents downgrade blocked; "
            f"legal_acceptances reference v2.0 documents: {referenced}",
        )

    bind.execute(
        sa.text(
            "DELETE FROM legal_documents WHERE id IN :document_ids"
        ).bindparams(sa.bindparam("document_ids", expanding=True)),
        {"document_ids": document_ids},
    )
    bind.execute(
        sa.text(
            "UPDATE legal_documents "
            "SET retired_at = NULL, updated_at = now() "
            "WHERE document_type IN :document_types "
            "AND retired_at = CAST(:effective_at AS timestamptz)"
        ).bindparams(sa.bindparam("document_types", expanding=True)),
        {
            "effective_at": _EFFECTIVE_AT,
            "document_types": tuple(document["document_type"] for document in _DOCUMENTS),
        },
    )
