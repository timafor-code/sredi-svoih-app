from __future__ import annotations

import asyncio
import unittest
from unittest.mock import patch
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import httpx
from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import delete, func, select, text

from app.db.models.core import (
    AppUser,
    Community,
    Event,
    EventCategory,
    EventOccurrence,
    EventParticipationOption,
    EventRegistration,
    EventRegistrationAnswer,
    EventRegistrationCapacityReservation,
    EventRegistrationForm,
    EventRegistrationFormField,
    LegalDocument,
    WebRegistrationIdentityConflict,
    WebRegistrationIntent,
)
from app.db.session import AsyncSessionLocal, engine
from app.main import app
from app.schemas.web_registration import WebRegistrationIntentRequest
from app.services import web_registration as service
from app.services.email_delivery import EmailSendResult


class WebRegistrationIntentTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        service._rate_limiter = None
        self.email_patcher = patch(
            "app.services.web_registration.send_web_registration_verification_code",
            return_value=EmailSendResult(sent=True, disabled=False),
        )
        self.email_patcher.start()
        self.community_id, self.event_id, self.document_id = uuid4(), uuid4(), uuid4()
        self.now = datetime.now(UTC).replace(microsecond=0)
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(Community(id=self.community_id, name="Intent tests", city="Moscow", slug=f"intent-{self.community_id.hex[:20]}"))
                await session.flush()
                session.add(EventCategory(community_id=self.community_id, slug="community", title="Community", color="#123456", icon="*"))
                await session.flush()
                session.add(Event(id=self.event_id, community_id=self.community_id, title="Synthetic intent event", starts_at=self.now + timedelta(days=2), category="community", registration_mode="internal_free", status="published", visibility="public", web_visibility="unlisted"))
                session.add(LegalDocument(id=self.document_id, document_type="event_registration_consent", version=f"intent-{self.document_id.hex}", title="Synthetic consent", content_hash="sha256:test-content", published_url="https://example.invalid/consent", effective_at=self.now - timedelta(days=1)))

    async def asyncTearDown(self) -> None:
        self.email_patcher.stop()
        async with AsyncSessionLocal() as session:
            async with session.begin():
                await session.execute(delete(AppUser).where(AppUser.email.like("intent-%@example.invalid")))
                await session.execute(delete(LegalDocument).where(LegalDocument.version.like("intent-%")))
                await session.execute(delete(Community).where(Community.id == self.community_id))
        await engine.dispose()

    def payload(self, **updates) -> WebRegistrationIntentRequest:
        data = {
            "event_id": self.event_id, "occurrence_id": None,
            "first_name": "  Иван   Иванович ", "last_name": "  Тестов  ",
            "phone": "8 (900) 000-00-01", "email": " Intent-NEW@Example.Invalid ",
            "seats_count": 1, "option_selections": [],
            "questionnaire_form_id": None, "answers": [],
            "legal_acceptances": [{"document_id": self.document_id, "content_hash": "sha256:test-content"}],
            "account_choice": "without_password", "idempotency_key": f"test-key-{uuid4().hex}",
        }
        data.update(updates)
        return WebRegistrationIntentRequest.model_validate(data)

    async def _create(self, **updates):
        async with AsyncSessionLocal() as session:
            return await service.create_intent(session, self.payload(**updates), None)

    async def _add_user(self, email: str, phone: str, **kwargs) -> AppUser:
        user = AppUser(email=email, phone=phone, password_hash="unchanged", account_origin="password_signup", claim_state="claimed", status=kwargs.get("status", "active"), deletion_requested_at=kwargs.get("deletion_requested_at"), erased_at=kwargs.get("erased_at"))
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(user)
                await session.flush()
        return user

    async def _add_document(self, document_type: str, *, retired: bool = False) -> LegalDocument:
        document = LegalDocument(document_type=document_type, version=f"intent-{uuid4().hex}", title="Synthetic legal text", content_hash=f"sha256:{uuid4().hex}", published_url="https://example.invalid/legal", effective_at=self.now - timedelta(days=1), retired_at=self.now if retired else None)
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(document)
                await session.flush()
        return document

    async def _add_option(self, **kwargs) -> EventParticipationOption:
        option = EventParticipationOption(event_id=self.event_id, title=f"Synthetic option {uuid4().hex[:8]}", **kwargs)
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(option)
                await session.flush()
        return option

    async def _add_questionnaire(self):
        form = EventRegistrationForm(
            event_id=self.event_id,
            channel="web",
            version=1,
            purpose="Collect ordinary logistics",
            status="draft",
        )
        definitions = [
            ("short", "short_text", True, [], {"min_length": 2, "max_length": 5}),
            ("long", "long_text", False, [], {"min_length": 2, "max_length": 20}),
            ("single", "single_select", True, [{"value": "a", "label": "A"}, {"value": "b", "label": "B"}], {}),
            ("multi", "multi_select", True, [{"value": "x", "label": "X"}, {"value": "y", "label": "Y"}, {"value": "z", "label": "Z"}], {"min_selections": 1, "max_selections": 2}),
            ("boolean", "boolean", True, [], {}),
        ]
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(form)
                await session.flush()
                fields = []
                for sort_order, (key, field_type, required, options, validation) in enumerate(definitions):
                    field = EventRegistrationFormField(
                        form_id=form.id,
                        field_key=key,
                        field_type=field_type,
                        label=f"Question {key}",
                        required=required,
                        purpose="Ordinary event logistics",
                        retention_days=7 + sort_order,
                        options_payload=options,
                        validation_payload=validation,
                        data_category="ordinary",
                        sort_order=sort_order,
                    )
                    session.add(field)
                    fields.append(field)
                await session.flush()
                form.status = "published"
                form.published_at = self.now
            return form.id, {field.field_key: field.id for field in fields}

    @staticmethod
    def _valid_answers(field_ids):
        return [
            {"field_id": field_ids["short"], "value": " ok "},
            {"field_id": field_ids["single"], "value": "a"},
            {"field_id": field_ids["multi"], "value": ["x", "y"]},
            {"field_id": field_ids["boolean"], "value": False},
        ]

    async def _assert_http_error(self, expected_status: int, expected_code: str, **updates) -> HTTPException:
        service._rate_limiter = None
        with self.assertRaises(HTTPException) as raised:
            await self._create(**updates)
        self.assertEqual(raised.exception.status_code, expected_status)
        self.assertEqual(raised.exception.detail["code"], expected_code)
        return raised.exception

    async def test_processable_creation_returns_confirm_email_and_has_no_final_side_effects(self) -> None:
        async with AsyncSessionLocal() as session:
            before_users = await session.scalar(select(func.count()).select_from(AppUser))
            before_regs = await session.scalar(select(func.count()).select_from(EventRegistration))
            before_reservations = await session.scalar(select(func.count()).select_from(EventRegistrationCapacityReservation))
        response = await self._create()
        self.assertEqual(response.next_step, "confirm_email")
        async with AsyncSessionLocal() as session:
            intent = await session.scalar(select(WebRegistrationIntent).where(WebRegistrationIntent.event_id == self.event_id))
            self.assertEqual(intent.status, "email_verification_required")
            self.assertEqual((intent.first_name, intent.last_name), ("Иван Иванович", "Тестов"))
            self.assertEqual(intent.answer_payload, None)
            self.assertEqual(await session.scalar(select(func.count()).select_from(AppUser)), before_users)
            self.assertEqual(await session.scalar(select(func.count()).select_from(EventRegistration)), before_regs)
            self.assertEqual(await session.scalar(select(func.count()).select_from(EventRegistrationCapacityReservation)), before_reservations)

    def test_input_rejects_malformed_contacts_names_and_account_choice(self) -> None:
        for update in ({"phone": "+123"}, {"first_name": "Bad\u0000Name"}, {"account_choice": "invalid"}, {"email": "broken"}):
            with self.assertRaises(ValidationError):
                self.payload(**update)

    async def test_idempotency_and_failed_retry_outcomes(self) -> None:
        payload = self.payload(idempotency_key="stable-test-key")
        async with AsyncSessionLocal() as session:
            first = await service.create_intent(session, payload, None)
        async with AsyncSessionLocal() as session:
            second = await service.create_intent(session, self.payload(idempotency_key="stable-test-key"), None)
        self.assertEqual(first.flow_id, second.flow_id)
        await self._assert_http_error(409, "idempotency_conflict", idempotency_key="stable-test-key", seats_count=2)

        await self._add_user("intent-phone@example.invalid", "+79000000002")
        conflict_payload = dict(email="intent-free@example.invalid", phone="+79000000002", idempotency_key="failed-retry-key")
        first_error = await self._assert_http_error(409, "identity_confirmation_unavailable", **conflict_payload)
        retry_error = await self._assert_http_error(409, "identity_confirmation_unavailable", **conflict_payload)
        self.assertEqual(first_error.detail, retry_error.detail)

    async def test_concurrent_same_key_creates_one_intent(self) -> None:
        payload = self.payload(idempotency_key="concurrent-test-key")
        async def submit():
            async with AsyncSessionLocal() as session:
                return await service.create_intent(session, payload, None)
        results = await asyncio.gather(submit(), submit())
        self.assertEqual(results[0].flow_id, results[1].flow_id)

    async def test_sensitive_identity_conflicts_share_generic_public_outcome(self) -> None:
        phone_user = await self._add_user("intent-phone@example.invalid", "+79000000012")
        phone_only = await self._assert_http_error(409, "identity_confirmation_unavailable", email="intent-free@example.invalid", phone="+79000000012", idempotency_key="phone-only-key")
        email_user = await self._add_user("intent-email@example.invalid", "+79000000011")
        differing = await self._assert_http_error(409, "identity_confirmation_unavailable", email=email_user.email, phone="+79000000012", idempotency_key="different-users-key")
        self.assertEqual(phone_only.detail, differing.detail)
        self.assertNotIn("confirm_email", str(phone_only.detail))
        async with AsyncSessionLocal() as session:
            failed = list(await session.scalars(select(WebRegistrationIntent).where(WebRegistrationIntent.status == "failed", WebRegistrationIntent.event_id == self.event_id)))
            self.assertEqual(len(failed), 2)
            conflict = await session.scalar(select(WebRegistrationIdentityConflict).where(WebRegistrationIdentityConflict.email_user_id == email_user.id))
            self.assertEqual((conflict.email_user_id, conflict.phone_user_id), (email_user.id, phone_user.id))

    async def test_deletion_pending_stores_no_intent_conflict_or_submitted_pii(self) -> None:
        deleting = await self._add_user("intent-deleting@example.invalid", "+79000000022", status="deletion_pending", deletion_requested_at=self.now)
        submitted_email = "intent-not-stored@example.invalid"
        await self._assert_http_error(409, "identity_confirmation_unavailable", email=submitted_email, phone=deleting.phone, first_name="Unique Submitted Name", idempotency_key="deletion-key")
        async with AsyncSessionLocal() as session:
            self.assertEqual(await session.scalar(select(func.count()).select_from(WebRegistrationIntent).where(WebRegistrationIntent.event_id == self.event_id)), 0)
            self.assertEqual(
                await session.scalar(
                    select(func.count())
                    .select_from(WebRegistrationIdentityConflict)
                    .join(
                        WebRegistrationIntent,
                        WebRegistrationIntent.id == WebRegistrationIdentityConflict.registration_intent_id,
                    )
                    .where(WebRegistrationIntent.event_id == self.event_id)
                ),
                0,
            )
            self.assertIsNone(await session.scalar(select(WebRegistrationIntent).where(WebRegistrationIntent.email_normalized == submitted_email)))

    async def test_legal_consent_rules(self) -> None:
        privacy = await self._add_document("privacy_policy")
        marketing = await self._add_document("marketing_consent")
        second_consent = await self._add_document("event_registration_consent")
        acceptance = lambda document: {"document_id": document.id, "content_hash": document.content_hash}
        await self._assert_http_error(422, "validation_error", legal_acceptances=[acceptance(privacy)])
        await self._assert_http_error(422, "validation_error", legal_acceptances=[acceptance(marketing)])
        await self._assert_http_error(422, "validation_error", legal_acceptances=[acceptance(await self._document()), acceptance(second_consent)])
        result = await self._create(legal_acceptances=[acceptance(await self._document()), acceptance(privacy)])
        self.assertEqual(result.next_step, "confirm_email")

    async def _document(self) -> LegalDocument:
        async with AsyncSessionLocal() as session:
            return await session.get(LegalDocument, self.document_id)

    async def test_free_only_paid_donation_and_seat_count_rules(self) -> None:
        async with AsyncSessionLocal() as session:
            event = await session.get(Event, self.event_id)
            event.registration_mode = "internal_paid"
            await session.commit()
        await self._assert_http_error(404, "registration_unavailable")
        async with AsyncSessionLocal() as session:
            event = await session.get(Event, self.event_id)
            event.registration_mode = "internal_free"
            await session.commit()

        paid = await self._add_option(price_amount=100)
        donation = await self._add_option(option_type="donation", is_donation=True)
        await self._assert_http_error(422, "validation_error", option_selections=[{"option_id": paid.id, "quantity": 1}])
        await self._assert_http_error(422, "validation_error", option_selections=[{"option_id": donation.id, "quantity": 1}])

        free = await self._add_option(allow_quantity=True, min_quantity=1, max_quantity=5)
        await self._assert_http_error(422, "validation_error", seats_count=1, option_selections=[{"option_id": free.id, "quantity": 2}])
        await self._create(seats_count=2, option_selections=[{"option_id": free.id, "quantity": 2}], idempotency_key="canonical-seat-key")
        async with AsyncSessionLocal() as session:
            intent = await session.scalar(select(WebRegistrationIntent).where(WebRegistrationIntent.idempotency_key_hash == service._idempotency_hash("canonical-seat-key")))
            self.assertEqual(intent.seats_count, 2)

    async def test_occurrence_requirement_and_windows_use_canonical_validation(self) -> None:
        occurrence_id = uuid4()
        async with AsyncSessionLocal() as session:
            event = await session.get(Event, self.event_id)
            event.event_kind = "course"
            session.add(EventOccurrence(id=occurrence_id, event_id=self.event_id, starts_at=self.now + timedelta(days=2), timezone="Europe/Moscow", status="active"))
            await session.commit()
        await self._assert_http_error(422, "validation_error")
        async with AsyncSessionLocal() as session:
            occurrence = await session.get(EventOccurrence, occurrence_id)
            occurrence.registration_opens_at = self.now + timedelta(days=1)
            await session.commit()
        await self._assert_http_error(409, "state_conflict", occurrence_id=occurrence_id)
        async with AsyncSessionLocal() as session:
            occurrence = await session.get(EventOccurrence, occurrence_id)
            occurrence.registration_opens_at = self.now - timedelta(days=2)
            occurrence.registration_closes_at = self.now - timedelta(days=1)
            await session.commit()
        await self._assert_http_error(409, "state_conflict", occurrence_id=occurrence_id)

    async def test_no_questionnaire_requires_null_form_and_empty_answers(self) -> None:
        await self._assert_http_error(
            409,
            "questionnaire_changed",
            questionnaire_form_id=uuid4(),
        )
        await self._create(idempotency_key="empty-answers-key")
        async with AsyncSessionLocal() as session:
            intent = await session.scalar(select(WebRegistrationIntent).where(WebRegistrationIntent.idempotency_key_hash == service._idempotency_hash("empty-answers-key")))
            self.assertIsNone(intent.answer_payload)
            self.assertIsNone(intent.questionnaire_form_id)

    async def test_questionnaire_binding_validation_normalization_and_temporary_storage(self) -> None:
        form_id, field_ids = await self._add_questionnaire()
        valid_answers = self._valid_answers(field_ids)
        await self._assert_http_error(409, "questionnaire_changed")
        await self._assert_http_error(
            409,
            "questionnaire_changed",
            questionnaire_form_id=uuid4(),
            answers=valid_answers,
        )
        await self._assert_http_error(
            422,
            "validation_error",
            questionnaire_form_id=form_id,
            answers=valid_answers + [valid_answers[0]],
        )
        await self._assert_http_error(
            422,
            "validation_error",
            questionnaire_form_id=form_id,
            answers=[item for item in valid_answers if item["field_id"] != field_ids["single"]],
        )
        await self._assert_http_error(
            422,
            "validation_error",
            questionnaire_form_id=form_id,
            answers=[{**valid_answers[0], "field_id": uuid4()}] + valid_answers[1:],
        )

        invalid_values = [
            ("short", "x"),
            ("short", "abcdef"),
            ("short", "ok\u0000"),
            ("long", "x"),
            ("long", "x" * 21),
            ("single", "unknown"),
            ("multi", ["x", "x"]),
            ("multi", []),
            ("multi", ["x", "y", "z"]),
            ("multi", ["unknown"]),
            ("boolean", "false"),
        ]
        by_field = {item["field_id"]: item for item in valid_answers}
        for key, value in invalid_values:
            answers = [dict(item) for item in valid_answers]
            target_id = field_ids[key]
            if target_id in by_field:
                for item in answers:
                    if item["field_id"] == target_id:
                        item["value"] = value
                        break
            else:
                answers.append({"field_id": target_id, "value": value})
            await self._assert_http_error(
                422,
                "validation_error",
                questionnaire_form_id=form_id,
                answers=answers,
            )

        await self._create(
            questionnaire_form_id=form_id,
            answers=valid_answers,
            idempotency_key="questionnaire-valid-key",
        )
        async with AsyncSessionLocal() as session:
            intent = await session.scalar(
                select(WebRegistrationIntent).where(
                    WebRegistrationIntent.idempotency_key_hash
                    == service._idempotency_hash("questionnaire-valid-key"),
                ),
            )
            self.assertEqual(intent.questionnaire_form_id, form_id)
            self.assertEqual(intent.answer_payload[0]["value"], "ok")
            self.assertEqual(intent.answer_payload[-1]["value"], False)
            self.assertEqual(
                await session.scalar(
                    select(func.count()).select_from(EventRegistrationAnswer),
                ),
                0,
            )

        await self._assert_http_error(
            409,
            "idempotency_conflict",
            questionnaire_form_id=form_id,
            answers=[{**valid_answers[0], "value": "new"}, *valid_answers[1:]],
            idempotency_key="questionnaire-valid-key",
        )

    async def test_router_create_and_generic_conflict_envelopes(self) -> None:
        payload = self.payload(idempotency_key="router-success-key").model_dump(mode="json")
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            response = await client.post("/web/registration-intents", json=payload)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["data"]["next_step"], "confirm_email")

        await self._add_user("intent-router-phone@example.invalid", "+79000000091")
        payload.update({"email": "intent-router-free@example.invalid", "phone": "+79000000091", "idempotency_key": "router-conflict-key"})
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver") as client:
            response = await client.post("/web/registration-intents", json=payload)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"], service.IDENTITY_UNAVAILABLE_DETAIL)

    async def test_status_is_credential_scoped_and_pii_free(self) -> None:
        created = await self._create(idempotency_key="status-test-key")
        async with AsyncSessionLocal() as session:
            current = await service.get_intent_status(session, created.flow_id)
            unknown = await service.get_intent_status(session, "x" * 43)
        self.assertEqual(
            current.model_dump().keys(),
            {"state", "expires_at", "registration", "account_next_step"},
        )
        self.assertIsNone(current.registration)
        self.assertIsNone(current.account_next_step)
        self.assertEqual(current.state, "email_verification_required")
        self.assertEqual(unknown.state, "not_available")

    async def test_invalid_event_and_legal_hash_are_rejected(self) -> None:
        await self._assert_http_error(
            404,
            "registration_unavailable",
            event_id=uuid4(),
        )
        await self._assert_http_error(422, "validation_error", legal_acceptances=[{"document_id": self.document_id, "content_hash": "wrong"}])

    async def test_database_is_at_alembic_head(self) -> None:
        expected = ScriptDirectory.from_config(Config("alembic.ini")).get_current_head()
        async with AsyncSessionLocal() as session:
            actual = await session.scalar(text("SELECT version_num FROM alembic_version"))
        self.assertEqual(actual, expected)


if __name__ == "__main__":
    unittest.main()
