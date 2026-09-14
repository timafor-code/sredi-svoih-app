from __future__ import annotations

import unittest
import inspect
from datetime import UTC, datetime
from uuid import UUID, uuid4

import httpx
from fastapi import HTTPException
from sqlalchemy import delete, func, select, update

from app.core.tokens import create_access_token
from app.db.models.core import AppUser, LegalAcceptance, LegalDocument
from app.db.session import AsyncSessionLocal, engine
from app.main import app
from app.services import account_consent as account_consent_service


class AccountConsentApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.user_id = uuid4()
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(AppUser(
                    id=self.user_id,
                    email=f"account-consent-{self.user_id.hex[:12]}@example.invalid",
                    account_origin="migration",
                    claim_state="legacy_external",
                    status="active",
                ))
        self.headers = {"Authorization": f"Bearer {create_access_token(self.user_id)}"}
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
        )

    async def asyncTearDown(self) -> None:
        await self.client.aclose()
        try:
            async with AsyncSessionLocal() as session:
                async with session.begin():
                    await session.execute(delete(AppUser).where(AppUser.id == self.user_id))
        finally:
            await engine.dispose()

    async def _current_document(self) -> LegalDocument:
        async with AsyncSessionLocal() as session:
            document = await account_consent_service.current_account_consent_document(
                session,
                lock=False,
            )
            return document

    async def test_status_requires_auth_and_historical_acceptance_is_not_current(self) -> None:
        unauthenticated = await self.client.get("/auth/account-consent")
        self.assertEqual(unauthenticated.status_code, 401)

        initial = await self.client.get("/auth/account-consent", headers=self.headers)
        self.assertEqual(initial.status_code, 200, initial.text)
        self.assertFalse(initial.json()["accepted"])

        async with AsyncSessionLocal() as session:
            async with session.begin():
                historical = await session.scalar(select(LegalDocument).where(
                    LegalDocument.document_type == "account_personal_data_consent",
                    LegalDocument.retired_at.is_not(None),
                ))
                self.assertIsNotNone(historical)
                session.add(LegalAcceptance(
                    user_id=self.user_id,
                    legal_document_id=historical.id,
                    accepted_at=datetime.now(UTC),
                    acceptance_method="authenticated_action",
                    source_channel="mobile",
                    evidence_version="historical-account-consent-test",
                ))

        historical_only = await self.client.get("/auth/account-consent", headers=self.headers)
        self.assertEqual(historical_only.status_code, 200, historical_only.text)
        self.assertFalse(historical_only.json()["accepted"])

    async def test_accept_creates_one_mobile_evidence_row_and_is_idempotent(self) -> None:
        document = await self._current_document()
        unauthenticated = await self.client.post(
            "/auth/account-consent/accept",
            json={"document_id": str(document.id), "content_hash": document.content_hash},
        )
        self.assertEqual(unauthenticated.status_code, 401)

        payload = {"document_id": str(document.id), "content_hash": document.content_hash}
        accepted = await self.client.post("/auth/account-consent/accept", headers=self.headers, json=payload)
        self.assertEqual(accepted.status_code, 200, accepted.text)
        self.assertTrue(accepted.json()["accepted"])

        repeated = await self.client.post("/auth/account-consent/accept", headers=self.headers, json=payload)
        self.assertEqual(repeated.status_code, 200, repeated.text)

        async with AsyncSessionLocal() as session:
            rows = list(await session.scalars(
                select(LegalAcceptance).where(
                    LegalAcceptance.user_id == self.user_id,
                    LegalAcceptance.legal_document_id == document.id,
                ),
            ))
        self.assertEqual(len(rows), 1)
        self.assertIsNone(rows[0].registration_id)
        self.assertEqual(rows[0].acceptance_method, "checkbox")
        self.assertEqual(rows[0].source_channel, "mobile")
        self.assertEqual(rows[0].evidence_version, "mobile-account-consent-reaccept-v1")

        stale = await self.client.post(
            "/auth/account-consent/accept",
            headers=self.headers,
            json={"document_id": str(document.id), "content_hash": "sha256:stale"},
        )
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()["error"]["code"], "legal_documents_changed")

    async def test_missing_duplicate_and_non_https_current_documents_fail_closed(self) -> None:
        async with AsyncSessionLocal() as session:
            await session.execute(update(LegalDocument).where(
                LegalDocument.document_type == "account_personal_data_consent",
                LegalDocument.retired_at.is_(None),
            ).values(retired_at=datetime.now(UTC)))
            with self.assertRaises(HTTPException) as missing:
                await account_consent_service.get_account_consent_status(
                    session,
                    current_user=AppUser(id=self.user_id),
                )
            self.assertEqual(missing.exception.status_code, 503)
            await session.rollback()

            current = await account_consent_service.current_account_consent_document(session, lock=False)
            session.add(LegalDocument(
                document_type="account_personal_data_consent",
                version=f"test-duplicate-{uuid4().hex}",
                title="Duplicate test consent",
                content_hash=f"sha256:{uuid4().hex}",
                published_url="https://example.invalid/account-consent",
                effective_at=current.effective_at,
            ))
            with self.assertRaises(HTTPException) as duplicate:
                await account_consent_service.current_account_consent_document(session, lock=False)
            self.assertEqual(duplicate.exception.status_code, 503)
            await session.rollback()

            current = await account_consent_service.current_account_consent_document(session, lock=False)
            await session.execute(update(LegalDocument).where(
                LegalDocument.id == current.id,
            ).values(published_url="http://example.invalid/account-consent"))
            with self.assertRaises(HTTPException) as invalid_url:
                await account_consent_service.current_account_consent_document(session, lock=False)
            self.assertEqual(invalid_url.exception.status_code, 503)
            await session.rollback()

    def test_current_document_lock_is_shared(self) -> None:
        self.assertIn(
            "with_for_update(read=True)",
            inspect.getsource(account_consent_service.current_account_consent_document),
        )


if __name__ == "__main__":
    unittest.main()
