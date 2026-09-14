from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import httpx
from sqlalchemy import delete, func, select

from app.core.tokens import create_access_token
from app.db.models.core import (
    AppUser,
    Community,
    Event,
    EventCategory,
    EventRegistration,
    LegalAcceptance,
)
from app.db.session import AsyncSessionLocal, engine
from app.main import app
from app.services import account_consent as account_consent_service


class EventRegistrationAccountConsentTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.community_id = uuid4()
        self.user_id = uuid4()
        self.event_id = uuid4()
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
                session.add(Event(
                        id=self.event_id,
                        community_id=self.community_id,
                        title="Account consent event",
                        starts_at=datetime.now(UTC) + timedelta(days=1),
                        category="community",
                        registration_mode="internal_free",
                        status="published",
                        visibility="public",
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

    async def test_missing_current_acceptance_blocks_without_registration_side_effect(self) -> None:
        response = await self.client.post(f"/events/{self.event_id}/register", headers=self.headers, json={})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"]["code"], "account_consent_required")
        self.assertEqual(await self._registration_count(), 0)

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
