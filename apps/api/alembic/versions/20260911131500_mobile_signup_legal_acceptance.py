"""Require versioned legal evidence for mobile account signup.

Revision ID: 20260911131500
Revises: 20260911123000
Create Date: 2026-09-11 13:15:00.000000
"""

from collections.abc import Sequence
from datetime import datetime

from alembic import op
import sqlalchemy as sa


revision: str = "20260911131500"
down_revision: str | Sequence[str] | None = "20260911123000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_EFFECTIVE_AT = datetime.fromisoformat("2026-09-11T00:00:00+03:00")
_DOCUMENTS = (
    {
        "id": "34721bfa-d04b-59c0-b341-d42c1bf56e48",
        "document_type": "account_personal_data_consent",
        "version": "2.0",
        "title": "Согласие на обработку персональных данных для создания аккаунта",
        "content_hash": "sha256:42c7e863e18a99dfb1753967ed8151c163a4a9770fa96b6c8390c6d4fffd33bc",
        "published_url": "https://reg.sredisvoihapp.ru/legal/account-personal-data-consent-v2.0.html",
    },
    {
        "id": "1bfbd4bb-2d47-55c0-9b57-80f0d14667ee",
        "document_type": "user_agreement",
        "version": "2.0",
        "title": "Пользовательское соглашение",
        "content_hash": "sha256:0697fae65b9ebc07c239993f5cd908e0ee2278d1d8365f79e4c7fc7b9df16391",
        "published_url": "https://reg.sredisvoihapp.ru/legal/user-agreement-v2.0.html",
    },
)

_LEGAL_DOCUMENT_TYPES = (
    "privacy_policy",
    "event_registration_consent",
    "marketing_consent",
    "special_category_consent",
    "account_personal_data_consent",
    "user_agreement",
)


def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text(
        "ALTER TABLE legal_documents DROP CONSTRAINT IF EXISTS "
        "legal_documents_document_type_check"
    ))
    op.create_check_constraint(
        "legal_documents_document_type_check",
        "legal_documents",
        "document_type IN (" + ", ".join(repr(item) for item in _LEGAL_DOCUMENT_TYPES) + ")",
    )
    bind.execute(sa.text(
        "ALTER TABLE legal_acceptances DROP CONSTRAINT IF EXISTS "
        "legal_acceptances_acceptance_method_check"
    ))
    op.create_check_constraint(
        "legal_acceptances_acceptance_method_check",
        "legal_acceptances",
        "acceptance_method IN ('checkbox_plus_email_verification', 'authenticated_action', 'checkbox')",
    )
    for document in _DOCUMENTS:
        bind.execute(
            sa.text(
                "INSERT INTO legal_documents "
                "(id, document_type, version, title, content_hash, published_url, effective_at) "
                "VALUES (CAST(:id AS uuid), :document_type, :version, :title, :content_hash, "
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
            "mobile signup legal acceptance downgrade blocked; "
            f"legal_acceptances reference v2.0 documents: {referenced}",
        )
    bind.execute(
        sa.text("DELETE FROM legal_documents WHERE id IN :document_ids").bindparams(
            sa.bindparam("document_ids", expanding=True),
        ),
        {"document_ids": document_ids},
    )
    bind.execute(sa.text(
        "ALTER TABLE legal_documents DROP CONSTRAINT IF EXISTS "
        "legal_documents_document_type_check"
    ))
    op.create_check_constraint(
        "legal_documents_document_type_check",
        "legal_documents",
        "document_type IN ('privacy_policy', 'event_registration_consent', "
        "'marketing_consent', 'special_category_consent')",
    )
    bind.execute(sa.text(
        "ALTER TABLE legal_acceptances DROP CONSTRAINT IF EXISTS "
        "legal_acceptances_acceptance_method_check"
    ))
    op.create_check_constraint(
        "legal_acceptances_acceptance_method_check",
        "legal_acceptances",
        "acceptance_method IN ('checkbox_plus_email_verification', 'authenticated_action')",
    )
