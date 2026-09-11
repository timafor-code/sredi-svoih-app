from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta
from unittest.mock import patch
from uuid import UUID, uuid4

import httpx
from fastapi import HTTPException
from sqlalchemy import delete, func, select, update

from app.core.hashids import hash_invite_code
from app.db.models.core import AppUser, Community, Invite, LegalAcceptance, LegalDocument
from app.db.session import AsyncSessionLocal, engine
from app.main import app
from app.services import auth as auth_service


class AuthSignupLegalAcceptanceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.created_user_ids: list[UUID] = []
        self.created_community_ids: list[UUID] = []

    async def asyncTearDown(self) -> None:
        try:
            async with AsyncSessionLocal() as session:
                async with session.begin():
                    if self.created_user_ids:
                        await session.execute(delete(AppUser).where(AppUser.id.in_(self.created_user_ids)))
                    if self.created_community_ids:
                        await session.execute(delete(Community).where(Community.id.in_(self.created_community_ids)))
                    await session.execute(
                        delete(LegalDocument).where(LegalDocument.version.like("test-signup-legal-%")),
                    )
        finally:
            await engine.dispose()

    def _email(self) -> str:
        return f"signup-legal-{uuid4().hex[:12]}@example.invalid"

    async def _request(self, method: str, path: str, json: dict | None = None) -> httpx.Response:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            return await client.request(method, path, json=json)

    async def _documents(self) -> dict[str, dict]:
        response = await self._request("GET", "/auth/signup-legal-documents")
        self.assertEqual(response.status_code, 200, response.text)
        return {item["document_type"]: item for item in response.json()["documents"]}

    async def _acceptances(self) -> dict:
        return {
            document_type: {
                "document_id": document["id"],
                "content_hash": document["content_hash"],
            }
            for document_type, document in (await self._documents()).items()
        }

    async def _register(self, *, legal_acceptances: dict | None = None) -> httpx.Response:
        payload = {"email": self._email(), "password": "Synthetic-password-1"}
        if legal_acceptances is not None:
            payload["legal_acceptances"] = legal_acceptances
        with patch("app.services.auth.send_email_verification_email"):
            response = await self._request("POST", "/auth/register", payload)
        if response.status_code == 201:
            self.created_user_ids.append(UUID(response.json()["user"]["id"]))
        return response

    async def _acceptance_rows_for(self, user_id: UUID) -> list[LegalAcceptance]:
        async with AsyncSessionLocal() as session:
            return list(await session.scalars(
                select(LegalAcceptance).where(LegalAcceptance.user_id == user_id),
            ))

    async def test_get_returns_exactly_the_two_active_v2_documents(self) -> None:
        documents = await self._documents()
        self.assertEqual(set(documents), {"account_personal_data_consent", "user_agreement"})
        self.assertEqual(documents["account_personal_data_consent"]["version"], "2.0")
        self.assertEqual(documents["user_agreement"]["version"], "2.0")
        self.assertTrue(documents["account_personal_data_consent"]["published_url"].startswith("https://"))
        self.assertTrue(documents["user_agreement"]["published_url"].startswith("https://"))

    async def test_missing_current_document_fails_closed(self) -> None:
        async with AsyncSessionLocal() as session:
            await session.execute(
                update(LegalDocument)
                .where(LegalDocument.document_type == "user_agreement", LegalDocument.retired_at.is_(None))
                .values(retired_at=datetime.now(UTC)),
            )
            with self.assertRaises(HTTPException) as raised:
                await auth_service.get_signup_legal_documents(session)
            self.assertEqual(raised.exception.status_code, 503)
            await session.rollback()

    async def test_register_rejects_missing_or_partial_legal_acceptance(self) -> None:
        missing = await self._register()
        self.assertEqual(missing.status_code, 422)
        partial = await self._register(legal_acceptances={
            "account_personal_data_consent": (await _single_acceptance(self, "account_personal_data_consent")),
        })
        self.assertEqual(partial.status_code, 422)

    async def test_register_rejects_stale_hash_wrong_type_and_retired_document(self) -> None:
        acceptances = await self._acceptances()
        stale = {**acceptances, "user_agreement": {**acceptances["user_agreement"], "content_hash": "sha256:stale"}}
        self.assertEqual((await self._register(legal_acceptances=stale)).status_code, 409)

        wrong_type = {**acceptances, "user_agreement": acceptances["account_personal_data_consent"]}
        wrong_response = await self._register(legal_acceptances=wrong_type)
        self.assertEqual(wrong_response.status_code, 409)
        self.assertEqual(wrong_response.json()["error"]["code"], "legal_documents_changed")

        wrong_id = {**acceptances, "user_agreement": {"document_id": str(uuid4()), "content_hash": acceptances["user_agreement"]["content_hash"]}}
        self.assertEqual((await self._register(legal_acceptances=wrong_id)).status_code, 409)

        retired_id = uuid4()
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(LegalDocument(
                    id=retired_id,
                    document_type="user_agreement",
                    version=f"test-signup-legal-retired-{uuid4().hex}",
                    title="Retired agreement",
                    content_hash="sha256:retired",
                    published_url="https://example.invalid/legal/retired",
                    effective_at=datetime.now(UTC) - timedelta(days=2),
                    retired_at=datetime.now(UTC) - timedelta(days=1),
                ))
        retired = {**acceptances, "user_agreement": {"document_id": str(retired_id), "content_hash": "sha256:retired"}}
        self.assertEqual((await self._register(legal_acceptances=retired)).status_code, 409)

    async def test_successful_password_signup_persists_two_checkbox_acceptances(self) -> None:
        historical_user_id = uuid4()
        historical_document_id = uuid4()
        self.created_user_ids.append(historical_user_id)
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(AppUser(
                    id=historical_user_id,
                    email=self._email(),
                    password_hash="test-hash",
                    account_origin="migration",
                    claim_state="legacy_external",
                ))
                session.add(LegalDocument(
                    id=historical_document_id,
                    document_type="privacy_policy",
                    version=f"test-signup-legal-historical-{uuid4().hex}",
                    title="Historical policy",
                    content_hash="sha256:historical",
                    published_url="https://example.invalid/legal/historical",
                    effective_at=datetime.now(UTC) - timedelta(days=2),
                ))
                await session.flush()
                session.add(LegalAcceptance(
                    user_id=historical_user_id,
                    legal_document_id=historical_document_id,
                    accepted_at=datetime.now(UTC) - timedelta(days=1),
                    acceptance_method="authenticated_action",
                    source_channel="mobile",
                    evidence_version="historical-test-v1",
                ))
        response = await self._register(legal_acceptances=await self._acceptances())
        self.assertEqual(response.status_code, 201, response.text)
        rows = await self._acceptance_rows_for(UUID(response.json()["user"]["id"]))
        self.assertEqual(len(rows), 2)
        self.assertEqual({row.registration_id for row in rows}, {None})
        self.assertEqual({row.acceptance_method for row in rows}, {"checkbox"})
        self.assertEqual({row.source_channel for row in rows}, {"mobile"})
        self.assertEqual({row.evidence_version for row in rows}, {"mobile-account-signup-v1"})
        historical_rows = await self._acceptance_rows_for(historical_user_id)
        self.assertEqual(len(historical_rows), 1)
        self.assertEqual(historical_rows[0].legal_document_id, historical_document_id)

    async def test_failed_delivery_does_not_leave_legal_acceptances(self) -> None:
        email = self._email()
        async with AsyncSessionLocal() as session:
            before_acceptance_count = await session.scalar(select(func.count()).select_from(LegalAcceptance))
        with patch("app.services.auth.send_email_verification_email", side_effect=Exception("synthetic")):
            response = await self._request("POST", "/auth/register", {
                "email": email,
                "password": "Synthetic-password-1",
                "legal_acceptances": await self._acceptances(),
            })
        self.assertEqual(response.status_code, 503)
        async with AsyncSessionLocal() as session:
            user_count = await session.scalar(select(func.count()).select_from(AppUser).where(AppUser.email == email))
            acceptance_count = await session.scalar(select(func.count()).select_from(LegalAcceptance))
        self.assertEqual(user_count, 0)
        self.assertEqual(acceptance_count, before_acceptance_count)

    async def test_invite_registration_requires_and_persists_legal_acceptances(self) -> None:
        community_id = uuid4()
        self.created_community_ids.append(community_id)
        invite_code = f"signup-legal-invite-{uuid4().hex}"
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(Community(
                    id=community_id,
                    name="Signup legal test community",
                    city="Moscow",
                    slug=f"signup-legal-{community_id.hex[:20]}",
                ))
                session.add(Invite(
                    community_id=community_id,
                    code_hash=hash_invite_code(invite_code),
                    email=None,
                    role="member",
                    status="active",
                    expires_at=datetime.now(UTC) + timedelta(days=1),
                ))
        missing = await self._request("POST", "/auth/register-with-invite", {
            "invite_code": invite_code,
            "email": self._email(),
            "password": "Synthetic-password-1",
        })
        self.assertEqual(missing.status_code, 422)

        successful = await self._request("POST", "/auth/register-with-invite", {
            "invite_code": invite_code,
            "email": self._email(),
            "password": "Synthetic-password-1",
            "legal_acceptances": await self._acceptances(),
        })
        self.assertEqual(successful.status_code, 201, successful.text)
        user_id = UUID(successful.json()["user"]["id"])
        self.created_user_ids.append(user_id)
        self.assertEqual(len(await self._acceptance_rows_for(user_id)), 2)


async def _single_acceptance(
    test: AuthSignupLegalAcceptanceTests,
    document_type: str,
) -> dict:
    return (await test._acceptances())[document_type]
