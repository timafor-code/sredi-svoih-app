"""Publish account-consent and privacy-policy v2.1 for account event registration.

Revision ID: 20260911150000
Revises: 20260911131500
Create Date: 2026-09-11 15:00:00.000000
"""

from collections.abc import Sequence
from datetime import datetime

from alembic import op
import sqlalchemy as sa


revision: str = "20260911150000"
down_revision: str | Sequence[str] | None = "20260911131500"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_EFFECTIVE_AT = datetime.fromisoformat("2026-09-11T15:00:00+03:00")
_DOCUMENTS = (
    {
        "id": "89c4723d-acb6-5e42-a88a-1dcc725b8971",
        "document_type": "account_personal_data_consent",
        "version": "2.1",
        "title": "Согласие на обработку персональных данных для аккаунта и регистрации на мероприятия",
        "content_hash": "sha256:0b3a6539fc08269604b026466d74722c54ff879fbebd5dba5d27cf4aea838477",
        "published_url": "https://reg.sredisvoihapp.ru/legal/account-personal-data-consent-v2.1.html",
    },
    {
        "id": "ad9481f6-8314-50ee-87dc-284433c28e52",
        "document_type": "privacy_policy",
        "version": "2.1",
        "title": "Политика обработки персональных данных",
        "content_hash": "sha256:b4c70e14d3796d9109914e3732665ca5cdc01d854ec6cb6304f13af78e5407a2",
        "published_url": "https://reg.sredisvoihapp.ru/legal/privacy-policy-v2.1.html",
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
            "account consent v2.1 downgrade blocked; "
            f"legal_acceptances reference v2.1 documents: {referenced}",
        )

    bind.execute(
        sa.text("DELETE FROM legal_documents WHERE id IN :document_ids").bindparams(
            sa.bindparam("document_ids", expanding=True),
        ),
        {"document_ids": document_ids},
    )
    bind.execute(
        sa.text(
            "UPDATE legal_documents AS previous "
            "SET retired_at = NULL, updated_at = now() "
            "WHERE (previous.document_type, previous.version) IN "
            "(('account_personal_data_consent', '2.0'), ('privacy_policy', '2.0')) "
            "AND previous.retired_at = CAST(:effective_at AS timestamptz) "
            "AND NOT EXISTS ("
            "SELECT 1 FROM legal_documents AS current "
            "WHERE current.document_type = previous.document_type "
            "AND current.retired_at IS NULL "
            ")"
        ),
        {"effective_at": _EFFECTIVE_AT},
    )
