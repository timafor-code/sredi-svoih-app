from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import httpx
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from app.db.models.core import (
    AppUser,
    Community,
    CommunityMembership,
    LegalAcceptance,
    LegalDocument,
    ParticipantLineageDeclaration,
    Profile,
)
from app.db.session import AsyncSessionLocal, engine
from app.main import app
from app.schemas.participant_profile import ParticipantLineageDeclarationRequest
from app.schemas.web_registration import WebLegalAcceptance
from app.services import participant_lineage, privacy_access
from app.services import web_participant_sessions as sessions_service


class ParticipantLineageTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.marker = uuid4().hex[:12]
        self.now = datetime.now(UTC).replace(microsecond=0)
        self.user_id = uuid4()
        self.community_id = uuid4()
        self.document_id = uuid4()
        self.content_hash = f"sha256:lineage-{self.marker}"
        self.email = f"lineage-{self.marker}@example.invalid"
        self.phone = f"+7900{int(self.marker[:8], 16) % 10**7:07d}"

        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add_all(
                    [
                        Community(
                            id=self.community_id,
                            name="Synthetic lineage community",
                            city="Moscow",
                            slug=f"lineage-{self.marker}",
                        ),
                        AppUser(
                            id=self.user_id,
                            email=self.email,
                            phone=self.phone,
                            account_origin="password_signup",
                            claim_state="claimed",
                            status="active",
                        ),
                    ],
                )
                await session.flush()
                session.add_all(
                    [
                        Profile(
                            user_id=self.user_id,
                            first_name="Синтетика",
                            last_name="Тест",
                            full_name="Синтетика Тест",
                            email=self.email,
                            phone=self.phone,
                        ),
                        CommunityMembership(
                            community_id=self.community_id,
                            user_id=self.user_id,
                            role="member",
                            status="active",
                        ),
                        LegalDocument(
                            id=self.document_id,
                            document_type="special_category_consent",
                            version=f"lineage-{self.marker}",
                            title="Synthetic special-category consent",
                            content_hash=self.content_hash,
                            published_url="https://example.invalid/special-category-consent",
                            effective_at=self.now - timedelta(days=1),
                        ),
                    ],
                )

        async with AsyncSessionLocal() as session:
            user = await session.get(AppUser, self.user_id)
            issued = await sessions_service.issue(session, user=user)
            await session.commit()
        self.token = issued.token

    async def asyncTearDown(self) -> None:
        try:
            async with AsyncSessionLocal() as session:
                async with session.begin():
                    await session.execute(delete(AppUser).where(AppUser.id == self.user_id))
                    await session.execute(
                        delete(LegalDocument).where(LegalDocument.id == self.document_id),
                    )
                    await session.execute(
                        delete(Community).where(Community.id == self.community_id),
                    )
        finally:
            await engine.dispose()

    def _valid_payload(self, values: list[str] | None = None) -> dict:
        return {
            "values": values if values is not None else ["giyur"],
            "legal_acceptance": {
                "document_id": str(self.document_id),
                "content_hash": self.content_hash,
            },
        }

    async def _client(self) -> httpx.AsyncClient:
        transport = httpx.ASGITransport(app=app)
        return httpx.AsyncClient(transport=transport, base_url="http://testserver")

    # -- schema-level rejections -------------------------------------------------

    async def test_allowlist_rejects_unknown_code(self) -> None:
        async with await self._client() as client:
            client.cookies.set(sessions_service.COOKIE_NAME, self.token)
            response = await client.put(
                "/web/participant-profile/lineage",
                json=self._valid_payload(values=["not_a_real_code"]),
            )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["code"], "validation_error")
        self.assertNotIn("not_a_real_code", response.text)

    async def test_unknown_is_exclusive(self) -> None:
        async with await self._client() as client:
            client.cookies.set(sessions_service.COOKIE_NAME, self.token)
            response = await client.put(
                "/web/participant-profile/lineage",
                json=self._valid_payload(values=["unknown", "father"]),
            )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["code"], "validation_error")

    async def test_empty_selection_is_rejected(self) -> None:
        async with await self._client() as client:
            client.cookies.set(sessions_service.COOKIE_NAME, self.token)
            response = await client.put(
                "/web/participant-profile/lineage",
                json=self._valid_payload(values=[]),
            )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["code"], "validation_error")

    async def test_duplicate_values_are_rejected(self) -> None:
        async with await self._client() as client:
            client.cookies.set(sessions_service.COOKIE_NAME, self.token)
            response = await client.put(
                "/web/participant-profile/lineage",
                json=self._valid_payload(values=["father", "father"]),
            )
        self.assertEqual(response.status_code, 422)

    # -- consent verification -----------------------------------------------------

    async def test_write_rejected_when_consent_document_missing(self) -> None:
        payload = self._valid_payload()
        payload["legal_acceptance"]["document_id"] = str(uuid4())
        async with await self._client() as client:
            client.cookies.set(sessions_service.COOKIE_NAME, self.token)
            response = await client.put("/web/participant-profile/lineage", json=payload)
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["code"], "validation_error")

    async def test_write_rejected_when_consent_document_retired(self) -> None:
        retired_document_id = uuid4()
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    LegalDocument(
                        id=retired_document_id,
                        document_type="special_category_consent",
                        version=f"lineage-retired-{self.marker}",
                        title="Synthetic retired consent",
                        content_hash=f"sha256:retired-{self.marker}",
                        published_url="https://example.invalid/retired-consent",
                        effective_at=self.now - timedelta(days=2),
                        retired_at=self.now - timedelta(days=1),
                    ),
                )
        try:
            payload = self._valid_payload()
            payload["legal_acceptance"]["document_id"] = str(retired_document_id)
            payload["legal_acceptance"]["content_hash"] = f"sha256:retired-{self.marker}"
            async with await self._client() as client:
                client.cookies.set(sessions_service.COOKIE_NAME, self.token)
                response = await client.put("/web/participant-profile/lineage", json=payload)
            self.assertEqual(response.status_code, 422)
        finally:
            async with AsyncSessionLocal() as session:
                async with session.begin():
                    await session.execute(
                        delete(LegalDocument).where(LegalDocument.id == retired_document_id),
                    )

    async def test_write_rejected_when_content_hash_mismatched(self) -> None:
        payload = self._valid_payload()
        payload["legal_acceptance"]["content_hash"] = "sha256:wrong-hash"
        async with await self._client() as client:
            client.cookies.set(sessions_service.COOKIE_NAME, self.token)
            response = await client.put("/web/participant-profile/lineage", json=payload)
        self.assertEqual(response.status_code, 422)
        async with AsyncSessionLocal() as session:
            acceptance_count = len(
                list(
                    await session.scalars(
                        select(LegalAcceptance).where(
                            LegalAcceptance.user_id == self.user_id,
                        ),
                    ),
                ),
            )
        self.assertEqual(acceptance_count, 0)

    # -- transactional atomicity ---------------------------------------------------

    async def test_failed_declaration_write_leaves_no_orphan_acceptance(self) -> None:
        bad_payload = ParticipantLineageDeclarationRequest.model_construct(
            values=["unknown", "father"],
            legal_acceptance=WebLegalAcceptance(
                document_id=self.document_id,
                content_hash=self.content_hash,
            ),
        )
        async with AsyncSessionLocal() as session:
            with self.assertRaises(IntegrityError):
                await participant_lineage.put_declaration(
                    session,
                    token=self.token,
                    payload=bad_payload,
                )

        async with AsyncSessionLocal() as session:
            acceptance_count = len(
                list(
                    await session.scalars(
                        select(LegalAcceptance).where(
                            LegalAcceptance.user_id == self.user_id,
                        ),
                    ),
                ),
            )
            declaration = await session.scalar(
                select(ParticipantLineageDeclaration).where(
                    ParticipantLineageDeclaration.user_id == self.user_id,
                ),
            )
        self.assertEqual(acceptance_count, 0)
        self.assertIsNone(declaration)

    # -- identity handling ----------------------------------------------------------

    async def test_anonymous_get_is_indistinguishable_from_no_declaration(self) -> None:
        async with await self._client() as client:
            anonymous = await client.get("/web/participant-profile/lineage")
            client.cookies.set(sessions_service.COOKIE_NAME, self.token)
            identified_without_declaration = await client.get(
                "/web/participant-profile/lineage",
            )
        self.assertEqual(anonymous.status_code, 200)
        self.assertEqual(identified_without_declaration.status_code, 200)
        self.assertEqual(anonymous.json()["data"], {"state": "none", "values": [], "declared_at": None, "updated_at": None})
        self.assertEqual(anonymous.json()["data"], identified_without_declaration.json()["data"])

    async def test_put_and_delete_require_identity(self) -> None:
        async with await self._client() as client:
            put_response = await client.put(
                "/web/participant-profile/lineage",
                json=self._valid_payload(),
            )
            delete_response = await client.delete("/web/participant-profile/lineage")
        self.assertEqual(put_response.status_code, 401)
        self.assertEqual(delete_response.status_code, 401)

    # -- write, read back, withdraw --------------------------------------------------

    async def test_write_read_back_and_idempotent_withdrawal(self) -> None:
        async with await self._client() as client:
            client.cookies.set(sessions_service.COOKIE_NAME, self.token)
            written = await client.put(
                "/web/participant-profile/lineage",
                json=self._valid_payload(values=["giyur", "mother"]),
            )
            self.assertEqual(written.status_code, 200)
            written_data = written.json()["data"]
            self.assertEqual(written_data["state"], "declared")
            self.assertEqual(set(written_data["values"]), {"giyur", "mother"})

            fetched = await client.get("/web/participant-profile/lineage")
            self.assertEqual(fetched.json()["data"]["state"], "declared")

            async with AsyncSessionLocal() as session:
                acceptance_id_before = await session.scalar(
                    select(ParticipantLineageDeclaration.consent_acceptance_id).where(
                        ParticipantLineageDeclaration.user_id == self.user_id,
                    ),
                )

            first_delete = await client.delete("/web/participant-profile/lineage")
            self.assertEqual(first_delete.status_code, 204)
            second_delete = await client.delete("/web/participant-profile/lineage")
            self.assertEqual(second_delete.status_code, 204)

            after_withdraw = await client.get("/web/participant-profile/lineage")
            self.assertEqual(after_withdraw.json()["data"]["state"], "none")

        async with AsyncSessionLocal() as session:
            declaration = await session.scalar(
                select(ParticipantLineageDeclaration).where(
                    ParticipantLineageDeclaration.user_id == self.user_id,
                ),
            )
            preserved_acceptance = await session.get(LegalAcceptance, acceptance_id_before)
        self.assertIsNone(declaration)
        self.assertIsNotNone(preserved_acceptance)

    async def test_writing_again_replaces_values_and_records_fresh_acceptance(self) -> None:
        async with await self._client() as client:
            client.cookies.set(sessions_service.COOKIE_NAME, self.token)
            await client.put(
                "/web/participant-profile/lineage",
                json=self._valid_payload(values=["giyur"]),
            )
            second = await client.put(
                "/web/participant-profile/lineage",
                json=self._valid_payload(values=["mother", "father"]),
            )
        self.assertEqual(second.status_code, 200)
        self.assertEqual(set(second.json()["data"]["values"]), {"mother", "father"})
        async with AsyncSessionLocal() as session:
            acceptance_count = len(
                list(
                    await session.scalars(
                        select(LegalAcceptance).where(
                            LegalAcceptance.user_id == self.user_id,
                        ),
                    ),
                ),
            )
        self.assertEqual(acceptance_count, 2)

    # -- privacy self-service coverage -----------------------------------------------

    async def test_privacy_export_and_summary_include_lineage_declaration(self) -> None:
        async with AsyncSessionLocal() as session:
            await participant_lineage.put_declaration(
                session,
                token=self.token,
                payload=ParticipantLineageDeclarationRequest(
                    values=["giyur"],
                    legal_acceptance=WebLegalAcceptance(
                        document_id=self.document_id,
                        content_hash=self.content_hash,
                    ),
                ),
            )

        async with AsyncSessionLocal() as session:
            summary = await privacy_access.build_data_summary(session, self.user_id)
            export = await privacy_access.build_data_export(session, self.user_id)

        summary_codes = {item.code: item.record_count for item in summary.categories}
        self.assertEqual(summary_codes["lineage_declaration"], 1)
        self.assertIn("lineage_declaration", export.included_categories)
        self.assertIsNotNone(export.lineage_declaration)
        self.assertEqual(export.lineage_declaration["values"], ["giyur"])
        self.assertEqual(
            export.lineage_declaration["consent_document_version"],
            f"lineage-{self.marker}",
        )


if __name__ == "__main__":
    unittest.main()
