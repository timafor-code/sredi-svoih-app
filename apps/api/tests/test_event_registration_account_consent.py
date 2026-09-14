from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import httpx
from sqlalchemy import delete, func, select

from app.core.tokens import create_access_token
from app.db.models.core import (
    AppUser,
    Community,
    Event,
    EventCapacityUnit,
    EventCategory,
    EventRegistration,
    EventRegistrationCapacityReservation,
    EventRegistrationOptionSelection,
    EventParticipationOption,
    EventParticipationOptionCapacityUnit,
    LegalAcceptance,
    LegalDocument,
)
from app.db.session import AsyncSessionLocal, engine
from app.main import app
from app.services import account_consent as account_consent_service


class EventRegistrationAccountConsentTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.community_id = uuid4()
        self.user_id = uuid4()
        self.event_id = uuid4()
        self.capacity_event_id = uuid4()
        self.capacity_option_id = uuid4()
        self.capacity_unit_id = uuid4()
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add_all([
                    Community(
                        id=self.community_id,
                        name="Account consent registration tests",
                        city="Moscow",
                        slug=f"account-consent-{self.community_id.hex[:12]}",
                    ),
                    AppUser(
                        id=self.user_id,
                        email=f"event-consent-{self.user_id.hex[:12]}@example.invalid",
                        account_origin="migration",
                        claim_state="legacy_external",
                        status="active",
                    ),
                ])
                await session.flush()
                session.add(EventCategory(
                    community_id=self.community_id,
                    slug="community",
                    title="Community",
                    color="#123456",
                    icon="*",
                ))
                await session.flush()
                session.add_all([
                    Event(
                        id=self.event_id,
                        community_id=self.community_id,
                        title="Account consent event",
                        starts_at=datetime.now(UTC) + timedelta(days=1),
                        category="community",
                        registration_mode="internal_free",
                        status="published",
                        visibility="public",
                    ),
                    Event(
                        id=self.capacity_event_id,
                        community_id=self.community_id,
                        title="Account consent capacity event",
                        starts_at=datetime.now(UTC) + timedelta(days=1),
                        category="community",
                        registration_mode="internal_paid",
                        status="published",
                        visibility="public",
                    ),
                ])
                await session.flush()
                session.add_all([
                    EventParticipationOption(
                        id=self.capacity_option_id,
                        event_id=self.capacity_event_id,
                        title="Capacity option",
                        option_type="participation",
                    ),
                    EventCapacityUnit(
                        id=self.capacity_unit_id,
                        event_id=self.capacity_event_id,
                        key="capacity",
                        title="Capacity",
                        capacity=10,
                    ),
                ])
                await session.flush()
                session.add(EventParticipationOptionCapacityUnit(
                    event_id=self.capacity_event_id,
                    option_id=self.capacity_option_id,
                    capacity_unit_id=self.capacity_unit_id,
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
                    await session.execute(delete(Community).where(Community.id == self.community_id))
                    await session.execute(delete(AppUser).where(AppUser.id == self.user_id))
        finally:
            await engine.dispose()

    async def _registration_count(self) -> int:
        async with AsyncSessionLocal() as session:
            return int(await session.scalar(
                select(func.count()).select_from(EventRegistration).where(
                    EventRegistration.event_id == self.event_id,
                ),
            ) or 0)

    async def _accept_current_document(self) -> None:
        async with AsyncSessionLocal() as session:
            async with session.begin():
                document = await account_consent_service.current_account_consent_document(session, lock=True)
                session.add(LegalAcceptance(
                    user_id=self.user_id,
                    legal_document_id=document.id,
                    accepted_at=datetime.now(UTC),
                    acceptance_method="checkbox",
                    source_channel="mobile",
                    evidence_version="mobile-account-signup-v1",
                ))

    async def _registration_side_effect_counts(
        self,
        event_id: UUID,
    ) -> tuple[int, int, int]:
        async with AsyncSessionLocal() as session:
            registrations = int(await session.scalar(
                select(func.count()).select_from(EventRegistration).where(
                    EventRegistration.event_id == event_id,
                ),
            ) or 0)
            selections = int(await session.scalar(
                select(func.count())
                .select_from(EventRegistrationOptionSelection)
                .join(
                    EventRegistration,
                    EventRegistration.id == EventRegistrationOptionSelection.registration_id,
                )
                .where(EventRegistration.event_id == event_id),
            ) or 0)
            reservations = int(await session.scalar(
                select(func.count()).select_from(EventRegistrationCapacityReservation).where(
                    EventRegistrationCapacityReservation.event_id == event_id,
                ),
            ) or 0)
            return registrations, selections, reservations

    async def test_missing_current_acceptance_blocks_without_capacity_side_effects(self) -> None:
        response = await self.client.post(
            f"/events/{self.capacity_event_id}/register",
            headers=self.headers,
            json={
                "option_selections": [
                    {"option_id": str(self.capacity_option_id), "quantity": 1},
                ],
            },
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"]["code"], "account_consent_required")
        self.assertEqual(
            await self._registration_side_effect_counts(self.capacity_event_id),
            (0, 0, 0),
        )

    async def test_historical_v2_acceptance_does_not_authorize_registration(self) -> None:
        async with AsyncSessionLocal() as session:
            async with session.begin():
                retired_document = await session.scalar(
                    select(LegalDocument).where(
                        LegalDocument.document_type == "account_personal_data_consent",
                        LegalDocument.version == "2.0",
                        LegalDocument.retired_at.is_not(None),
                    ),
                )
                self.assertIsNotNone(retired_document)
                session.add(LegalAcceptance(
                    user_id=self.user_id,
                    legal_document_id=retired_document.id,
                    accepted_at=datetime.now(UTC),
                    acceptance_method="checkbox",
                    source_channel="mobile",
                    evidence_version="test-retired-v2-acceptance",
                ))

        response = await self.client.post(
            f"/events/{self.event_id}/register",
            headers=self.headers,
            json={},
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"]["code"], "account_consent_required")
        self.assertEqual(await self._registration_count(), 0)

    async def test_current_document_rollover_invalidates_previous_acceptance(self) -> None:
        await self._accept_current_document()
        original_document_id = None
        replacement_document_id = None
        try:
            async with AsyncSessionLocal() as session:
                async with session.begin():
                    original_document = await account_consent_service.current_account_consent_document(
                        session,
                        lock=True,
                    )
                    original_document_id = original_document.id
                    original_document.retired_at = datetime.now(UTC)
                    replacement_document = LegalDocument(
                        document_type="account_personal_data_consent",
                        version=f"test-rollover-{uuid4().hex}",
                        title="Synthetic rollover account consent",
                        content_hash=f"sha256:{uuid4().hex}",
                        published_url="https://example.invalid/legal/test-rollover",
                        effective_at=datetime.now(UTC) - timedelta(seconds=1),
                    )
                    session.add(replacement_document)
                    await session.flush()
                    replacement_document_id = replacement_document.id

            response = await self.client.post(
                f"/events/{self.event_id}/register",
                headers=self.headers,
                json={},
            )
            self.assertEqual(response.status_code, 409)
            self.assertEqual(response.json()["error"]["code"], "account_consent_required")
            self.assertEqual(await self._registration_count(), 0)
        finally:
            async with AsyncSessionLocal() as session:
                async with session.begin():
                    if replacement_document_id is not None:
                        await session.execute(delete(LegalDocument).where(
                            LegalDocument.id == replacement_document_id,
                        ))
                    if original_document_id is not None:
                        original_document = await session.get(LegalDocument, original_document_id)
                        if original_document is not None:
                            original_document.retired_at = None

    async def test_missing_current_document_fails_closed_without_capacity_side_effects(self) -> None:
        original_document_id = None
        try:
            async with AsyncSessionLocal() as session:
                async with session.begin():
                    original_document = await account_consent_service.current_account_consent_document(
                        session,
                        lock=True,
                    )
                    original_document_id = original_document.id
                    original_document.retired_at = datetime.now(UTC)

            response = await self.client.post(
                f"/events/{self.capacity_event_id}/register",
                headers=self.headers,
                json={
                    "option_selections": [
                        {"option_id": str(self.capacity_option_id), "quantity": 1},
                    ],
                },
            )
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.json()["error"]["code"], "legal_documents_unavailable")
            self.assertEqual(
                await self._registration_side_effect_counts(self.capacity_event_id),
                (0, 0, 0),
            )
        finally:
            if original_document_id is not None:
                async with AsyncSessionLocal() as session:
                    async with session.begin():
                        original_document = await session.get(LegalDocument, original_document_id)
                        if original_document is not None:
                            original_document.retired_at = None

    async def test_current_or_signup_acceptance_allows_registration_and_guest_names_fail_closed(self) -> None:
        await self._accept_current_document()
        allowed = await self.client.post(f"/events/{self.event_id}/register", headers=self.headers, json={})
        self.assertEqual(allowed.status_code, 200, allowed.text)
        self.assertEqual(await self._registration_count(), 1)

        guest = await self.client.post(
            f"/events/{self.event_id}/register",
            headers=self.headers,
            json={"guest_names": ["Guest personal data"]},
        )
        self.assertEqual(guest.status_code, 422)
        self.assertEqual(guest.json()["error"]["code"], "guest_personal_data_not_supported")
        self.assertEqual(await self._registration_count(), 1)


if __name__ == "__main__":
    unittest.main()
