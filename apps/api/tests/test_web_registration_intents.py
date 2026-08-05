from __future__ import annotations

import asyncio
import unittest
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from alembic.config import Config
from alembic.script import ScriptDirectory
from pydantic import ValidationError
from sqlalchemy import delete, func, select, text

from app.db.models.core import (
    AppUser, Community, Event, EventCategory, EventOccurrence,
    EventParticipationOption, EventRegistration,
    EventRegistrationCapacityReservation, LegalDocument,
    WebRegistrationIdentityConflict, WebRegistrationIntent,
)
from app.db.session import AsyncSessionLocal, engine
from app.schemas.web_registration import WebRegistrationIntentRequest
from app.services import web_registration as service


class WebRegistrationIntentTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        service._rate_limiter = None
        self.community_id, self.event_id, self.document_id = uuid4(), uuid4(), uuid4()
        self.now = datetime.now(UTC).replace(microsecond=0)
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(Community(id=self.community_id, name="Intent tests", city="Moscow", slug=f"intent-{self.community_id.hex[:20]}"))
                await session.flush()
                session.add(EventCategory(community_id=self.community_id, slug="community", title="Community", color="#123456", icon="*"))
                await session.flush()
                session.add(Event(id=self.event_id, community_id=self.community_id, title="Synthetic intent event", starts_at=self.now + timedelta(days=2), category="community", registration_mode="internal_free", status="published", visibility="public"))
                session.add(LegalDocument(id=self.document_id, document_type="event_registration_consent", version=f"test-{self.document_id.hex}", title="Synthetic consent", content_hash="sha256:test-content", published_url="https://example.invalid/consent", effective_at=self.now - timedelta(days=1)))

    async def asyncTearDown(self) -> None:
        async with AsyncSessionLocal() as session:
            async with session.begin():
                await session.execute(delete(AppUser).where(AppUser.email.like("intent-%@example.invalid")))
                await session.execute(delete(LegalDocument).where(LegalDocument.id == self.document_id))
                await session.execute(delete(Community).where(Community.id == self.community_id))
        await engine.dispose()

    def payload(self, **updates) -> WebRegistrationIntentRequest:
        data = {
            "event_id": self.event_id, "occurrence_id": None,
            "first_name": "  Иван   Иванович ", "last_name": "  Тестов  ",
            "phone": "8 (900) 000-00-01", "email": " Intent-NEW@Example.Invalid ",
            "seats_count": 1, "option_selections": [], "answers": [],
            "legal_acceptances": [{"document_id": self.document_id, "content_hash": "sha256:test-content"}],
            "account_choice": "without_password", "idempotency_key": f"test-key-{uuid4().hex}",
        }
        data.update(updates)
        return WebRegistrationIntentRequest.model_validate(data)

    async def test_valid_creation_is_normalized_and_has_no_final_side_effects(self) -> None:
        before_users = before_regs = before_reservations = 0
        async with AsyncSessionLocal() as session:
            before_users = await session.scalar(select(func.count()).select_from(AppUser))
            before_regs = await session.scalar(select(func.count()).select_from(EventRegistration))
            before_reservations = await session.scalar(select(func.count()).select_from(EventRegistrationCapacityReservation))
            payload = self.payload()
            response = await service.create_intent(session, payload, "192.0.2.10")
        self.assertGreater(len(response.flow_id), 32)
        async with AsyncSessionLocal() as session:
            intent = await session.scalar(select(WebRegistrationIntent).where(WebRegistrationIntent.event_id == self.event_id))
            self.assertIsNotNone(intent)
            self.assertEqual(intent.status, "email_verification_required")
            self.assertEqual((intent.first_name, intent.last_name), ("Иван Иванович", "Тестов"))
            self.assertEqual(intent.email_normalized, "intent-new@example.invalid")
            self.assertEqual(intent.phone_normalized, "+79000000001")
            self.assertNotEqual(intent.flow_token_hash, response.flow_id)
            self.assertNotIn(payload.idempotency_key, intent.idempotency_key_hash)
            self.assertGreater(intent.expires_at, intent.created_at)
            self.assertEqual(await session.scalar(select(func.count()).select_from(AppUser)), before_users)
            self.assertEqual(await session.scalar(select(func.count()).select_from(EventRegistration)), before_regs)
            self.assertEqual(await session.scalar(select(func.count()).select_from(EventRegistrationCapacityReservation)), before_reservations)

    def test_input_rejects_malformed_contacts_names_and_account_choice(self) -> None:
        for update in ({"phone": "+123"}, {"first_name": "Bad\u0000Name"}, {"account_choice": "invalid"}, {"email": "broken"}):
            with self.assertRaises(ValidationError):
                self.payload(**update)

    async def test_equivalent_retry_returns_same_flow_and_changed_payload_conflicts(self) -> None:
        payload = self.payload(idempotency_key="stable-test-key")
        async with AsyncSessionLocal() as session:
            first = await service.create_intent(session, payload, None)
        async with AsyncSessionLocal() as session:
            second = await service.create_intent(session, self.payload(idempotency_key="stable-test-key"), None)
        self.assertEqual(first.flow_id, second.flow_id)
        async with AsyncSessionLocal() as session:
            with self.assertRaises(Exception) as raised:
                await service.create_intent(session, self.payload(idempotency_key="stable-test-key", seats_count=2), None)
        self.assertEqual(raised.exception.status_code, 409)
        async with AsyncSessionLocal() as session:
            count = await session.scalar(select(func.count()).select_from(WebRegistrationIntent).where(WebRegistrationIntent.event_id == self.event_id))
        self.assertEqual(count, 1)

    async def test_concurrent_same_key_creates_one_intent(self) -> None:
        payload = self.payload(idempotency_key="concurrent-test-key")
        async def submit():
            async with AsyncSessionLocal() as session:
                return await service.create_intent(session, payload, None)
        results = await asyncio.gather(submit(), submit())
        self.assertEqual(results[0].flow_id, results[1].flow_id)
        async with AsyncSessionLocal() as session:
            count = await session.scalar(select(func.count()).select_from(WebRegistrationIntent).where(WebRegistrationIntent.event_id == self.event_id))
        self.assertEqual(count, 1)

    async def _add_user(self, email: str, phone: str, **kwargs) -> AppUser:
        user = AppUser(email=email, phone=phone, password_hash="unchanged", account_origin="password_signup", claim_state="claimed", status=kwargs.get("status", "active"), deletion_requested_at=kwargs.get("deletion_requested_at"))
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(user)
                await session.flush()
        return user

    async def test_identity_matrix_is_safe_and_conflict_has_no_pii_columns(self) -> None:
        email_user = await self._add_user("intent-email@example.invalid", "+79000000011")
        phone_user = await self._add_user("intent-phone@example.invalid", "+79000000012")
        payload = self.payload(email="INTENT-EMAIL@example.invalid", phone="+79000000012", idempotency_key="conflict-test-key")
        async with AsyncSessionLocal() as session:
            result = await service.create_intent(session, payload, None)
        async with AsyncSessionLocal() as session:
            intent = await session.scalar(select(WebRegistrationIntent).where(WebRegistrationIntent.flow_token_hash == service.hash_token(result.flow_id)))
            conflict = await session.scalar(select(WebRegistrationIdentityConflict).where(WebRegistrationIdentityConflict.registration_intent_id == intent.id))
            self.assertEqual(intent.status, "failed")
            self.assertEqual((conflict.email_user_id, conflict.phone_user_id), (email_user.id, phone_user.id))
            self.assertTrue({"id", "registration_intent_id", "category", "email_user_id", "phone_user_id", "status", "resolved_at", "created_at"}.issuperset(WebRegistrationIdentityConflict.__table__.columns.keys()))
            refreshed = await session.get(AppUser, email_user.id)
            self.assertEqual((refreshed.email, refreshed.phone, refreshed.password_hash), (email_user.email, email_user.phone, "unchanged"))

    async def test_phone_only_and_deletion_pending_do_not_create_users(self) -> None:
        await self._add_user("intent-existing@example.invalid", "+79000000021")
        deleting = await self._add_user("intent-deleting@example.invalid", "+79000000022", deletion_requested_at=self.now)
        for index, payload in enumerate((
            self.payload(email="free@example.invalid", phone="+79000000021", idempotency_key="phone-only-key"),
            self.payload(email=deleting.email, phone=deleting.phone, idempotency_key="deletion-key"),
        )):
            async with AsyncSessionLocal() as session:
                await service.create_intent(session, payload, None)
        async with AsyncSessionLocal() as session:
            statuses = list(await session.scalars(select(WebRegistrationIntent.status).where(WebRegistrationIntent.event_id == self.event_id)))
            self.assertEqual(statuses, ["failed", "failed"])
            self.assertIsNone(await session.scalar(select(AppUser).where(AppUser.email == "free@example.invalid")))

    async def test_same_user_and_email_only_matches_link_without_mutation(self) -> None:
        user = await self._add_user("intent-match@example.invalid", "+79000000031")
        for key, phone in (("same-match-key", user.phone), ("email-only-key", "+79000000032")):
            async with AsyncSessionLocal() as session:
                await service.create_intent(session, self.payload(email=user.email.upper(), phone=phone, idempotency_key=key), None)
        async with AsyncSessionLocal() as session:
            intents = list(await session.scalars(select(WebRegistrationIntent).where(WebRegistrationIntent.event_id == self.event_id).order_by(WebRegistrationIntent.created_at)))
            self.assertEqual([item.matched_user_id for item in intents], [user.id, user.id])
            refreshed = await session.get(AppUser, user.id)
            self.assertEqual((refreshed.email, refreshed.phone, refreshed.password_hash), (user.email, user.phone, "unchanged"))

    async def test_occurrence_and_inactive_option_validation(self) -> None:
        other_event_id, other_occurrence_id, inactive_option_id = uuid4(), uuid4(), uuid4()
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(Event(id=other_event_id, community_id=self.community_id, title="Other synthetic event", starts_at=self.now + timedelta(days=3), category="community", registration_mode="internal_free", status="published", visibility="public"))
                await session.flush()
                session.add(EventOccurrence(id=other_occurrence_id, event_id=other_event_id, starts_at=self.now + timedelta(days=3), timezone="Europe/Moscow", status="active"))
                session.add(EventParticipationOption(id=inactive_option_id, event_id=self.event_id, title="Inactive synthetic option", is_active=False))
        payloads = (
            self.payload(occurrence_id=uuid4(), idempotency_key="missing-occurrence-key"),
            self.payload(occurrence_id=other_occurrence_id, idempotency_key="other-occurrence-key"),
            self.payload(option_selections=[{"option_id": inactive_option_id, "quantity": 1}], idempotency_key="inactive-option-key"),
        )
        for payload in payloads:
            async with AsyncSessionLocal() as session:
                with self.assertRaises(Exception):
                    await service.create_intent(session, payload, None)

    async def test_status_is_credential_scoped_generic_and_expiry_not_reused(self) -> None:
        payload = self.payload(idempotency_key="status-test-key")
        async with AsyncSessionLocal() as session:
            created = await service.create_intent(session, payload, None)
        async with AsyncSessionLocal() as session:
            current = await service.get_intent_status(session, created.flow_id)
            unknown = await service.get_intent_status(session, "x" * 43)
            self.assertEqual(current.model_dump().keys(), {"state", "expires_at"})
            self.assertEqual(unknown.state, "not_available")
            intent = await session.scalar(select(WebRegistrationIntent).where(WebRegistrationIntent.event_id == self.event_id))
            intent.created_at = self.now - timedelta(days=2)
            intent.expires_at = self.now - timedelta(days=1)
            await session.commit()
        async with AsyncSessionLocal() as session:
            self.assertEqual((await service.get_intent_status(session, created.flow_id)).state, "not_available")
            with self.assertRaises(Exception) as raised:
                await service.create_intent(session, payload, None)
            self.assertEqual(raised.exception.status_code, 409)

    async def test_invalid_event_and_legal_hash_are_rejected(self) -> None:
        for payload in (self.payload(event_id=uuid4()), self.payload(legal_acceptances=[{"document_id": self.document_id, "content_hash": "wrong"}])):
            async with AsyncSessionLocal() as session:
                with self.assertRaises(Exception):
                    await service.create_intent(session, payload, None)

    async def test_database_is_at_alembic_head(self) -> None:
        expected = ScriptDirectory.from_config(Config("alembic.ini")).get_current_head()
        async with AsyncSessionLocal() as session:
            actual = await session.scalar(text("SELECT version_num FROM alembic_version"))
        self.assertEqual(actual, expected)
