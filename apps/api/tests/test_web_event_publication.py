from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta
from unittest.mock import patch
from uuid import UUID, uuid4

import httpx
from alembic.config import Config
from alembic.script import ScriptDirectory
from pydantic import ValidationError
from sqlalchemy import delete, func, inspect, select, text
from sqlalchemy.exc import IntegrityError

from app.core.config import Settings
from app.core.tokens import create_access_token
from app.db.models.audit import AdminEventAuditEntry
from app.db.models.auth import AuthSetPasswordCode, WebRegistrationVerificationCode
from app.db.models.core import (
    AppUser,
    Community,
    CommunityMembership,
    Event,
    EventCategory,
    EventOccurrence,
    EventParticipationOption,
    EventPublicSlug,
    EventRegistration,
    LegalAcceptance,
    LegalDocument,
    WebRegistrationIntent,
)
from app.db.session import AsyncSessionLocal, engine
from app.main import app
from app.schemas.admin_events import (
    AdminEventCreateRequest,
    AdminEventUpdateRequest,
    AdminEventWebRegistrationUpdateRequest,
)
from app.schemas.web_registration import WebRegistrationIntentRequest
from app.services import admin_audit, admin_events, events, web_registration
from app.services.email_delivery import EmailSendResult


class WebEventPublicationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        web_registration._rate_limiter = None
        self.community_id = uuid4()
        self.event_id = uuid4()
        self.actor_id = uuid4()
        self.non_admin_id = uuid4()
        self.active_occurrence_ids = [uuid4(), uuid4()]
        self.excluded_occurrence_ids = [uuid4(), uuid4(), uuid4()]
        self.free_option_id = uuid4()
        self.now = datetime.now(UTC).replace(microsecond=0)
        self.actor_token = create_access_token(self.actor_id)
        self.non_admin_token = create_access_token(self.non_admin_id)
        self.marker = uuid4().hex[:12]
        self.consent_id = uuid4()
        self.privacy_id = uuid4()
        self.marketing_id = uuid4()

        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add_all(
                    [
                        Community(
                            id=self.community_id,
                            name="Publication test community",
                            city="Moscow",
                            slug=f"publication-{self.marker}",
                        ),
                        AppUser(
                            id=self.actor_id,
                            email=f"publication-admin-{self.marker}@example.invalid",
                            password_hash="synthetic-hash",
                            account_origin="password_signup",
                            claim_state="claimed",
                            status="active",
                        ),
                        AppUser(
                            id=self.non_admin_id,
                            email=f"publication-user-{self.marker}@example.invalid",
                            password_hash="synthetic-hash",
                            account_origin="password_signup",
                            claim_state="claimed",
                            status="active",
                        ),
                    ],
                )
                await session.flush()
                session.add(
                    EventCategory(
                        community_id=self.community_id,
                        slug="community",
                        title="Community",
                        color="#123456",
                        icon="*",
                    ),
                )
                await session.flush()
                event = Event(
                    id=self.event_id,
                    community_id=self.community_id,
                    title="Publication fixture",
                    starts_at=self.now + timedelta(days=5),
                    category="community",
                    registration_mode="internal_free",
                    status="published",
                    visibility="public",
                    capacity=10,
                )
                session.add_all(
                    [
                        CommunityMembership(
                            community_id=self.community_id,
                            user_id=self.actor_id,
                            role="admin",
                            status="active",
                        ),
                        event,
                    ],
                )
                await session.flush()
                self.assertEqual(event.web_visibility, "disabled")
                session.add_all(
                    [
                        EventPublicSlug(
                            event_id=self.event_id,
                            slug=f"publication-{self.marker}",
                            is_canonical=True,
                            created_by=self.actor_id,
                        ),
                        EventOccurrence(
                            id=self.active_occurrence_ids[1],
                            event_id=self.event_id,
                            title="Later active occurrence",
                            starts_at=self.now + timedelta(days=7),
                            status="active",
                        ),
                        EventOccurrence(
                            id=self.active_occurrence_ids[0],
                            event_id=self.event_id,
                            title="Earlier active occurrence",
                            starts_at=self.now + timedelta(days=6),
                            status="active",
                        ),
                        EventOccurrence(
                            id=self.excluded_occurrence_ids[0],
                            event_id=self.event_id,
                            starts_at=self.now + timedelta(days=8),
                            status="hidden",
                        ),
                        EventOccurrence(
                            id=self.excluded_occurrence_ids[1],
                            event_id=self.event_id,
                            starts_at=self.now + timedelta(days=9),
                            status="cancelled",
                        ),
                        EventOccurrence(
                            id=self.excluded_occurrence_ids[2],
                            event_id=self.event_id,
                            starts_at=self.now + timedelta(days=10),
                            status="archived",
                        ),
                        EventParticipationOption(
                            id=self.free_option_id,
                            event_id=self.event_id,
                            title="Free option",
                            price_amount=0,
                            option_type="participation",
                            sort_order=1,
                            is_active=True,
                        ),
                        EventParticipationOption(
                            event_id=self.event_id,
                            title="Paid option",
                            price_amount=100,
                            option_type="participation",
                            is_active=True,
                        ),
                        EventParticipationOption(
                            event_id=self.event_id,
                            title="Donation option",
                            price_amount=0,
                            option_type="donation",
                            is_donation=True,
                            counts_toward_capacity=False,
                            is_active=True,
                        ),
                        EventParticipationOption(
                            event_id=self.event_id,
                            title="Inactive free option",
                            price_amount=0,
                            option_type="participation",
                            is_active=False,
                        ),
                        LegalDocument(
                            id=self.consent_id,
                            document_type="event_registration_consent",
                            version=f"publication-consent-{self.marker}",
                            title="Synthetic consent",
                            content_hash=f"sha256:consent-{self.marker}",
                            published_url="https://example.invalid/consent",
                            effective_at=self.now - timedelta(hours=1),
                        ),
                        LegalDocument(
                            id=self.privacy_id,
                            document_type="privacy_policy",
                            version=f"publication-privacy-{self.marker}",
                            title="Synthetic privacy policy",
                            content_hash=f"sha256:privacy-{self.marker}",
                            published_url="https://example.invalid/privacy",
                            effective_at=self.now - timedelta(hours=1),
                        ),
                        LegalDocument(
                            id=self.marketing_id,
                            document_type="marketing_consent",
                            version=f"publication-marketing-{self.marker}",
                            title="Synthetic marketing consent",
                            content_hash=f"sha256:marketing-{self.marker}",
                            published_url="https://example.invalid/marketing",
                            effective_at=self.now - timedelta(hours=1),
                        ),
                    ],
                )

    async def asyncTearDown(self) -> None:
        try:
            async with AsyncSessionLocal() as session:
                async with session.begin():
                    await session.execute(
                        delete(AdminEventAuditEntry).where(
                            AdminEventAuditEntry.event_id == self.event_id,
                        ),
                    )
                    await session.execute(
                        delete(AppUser).where(
                            AppUser.email.like("publication-web-%@example.invalid"),
                        ),
                    )
                    await session.execute(
                        delete(Community).where(Community.id == self.community_id),
                    )
                    await session.execute(
                        delete(LegalDocument).where(
                            LegalDocument.version.like("publication-%"),
                        ),
                    )
                    await session.execute(
                        delete(AppUser).where(
                            AppUser.id.in_((self.actor_id, self.non_admin_id)),
                        ),
                    )
        finally:
            await engine.dispose()

    async def _request(
        self,
        method: str,
        path: str,
        *,
        token: str | None = None,
        json: dict[str, object] | None = None,
        headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        request_headers = dict(headers or {})
        if token is not None:
            request_headers["Authorization"] = f"Bearer {token}"
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
        ) as client:
            return await client.request(
                method,
                path,
                headers=request_headers,
                json=json,
            )

    async def _set_event(self, **updates: object) -> None:
        async with AsyncSessionLocal() as session:
            event = await session.get(Event, self.event_id)
            assert event is not None
            for field_name, value in updates.items():
                setattr(event, field_name, value)
            await session.commit()

    def _intent_payload(self, *, key: str | None = None) -> WebRegistrationIntentRequest:
        return WebRegistrationIntentRequest.model_validate(
            {
                "event_id": self.event_id,
                "occurrence_id": self.active_occurrence_ids[0],
                "first_name": "Synthetic",
                "last_name": "Participant",
                "phone": f"+7900{int(self.marker[:8], 16) % 10**7:07d}",
                "email": f"publication-web-{self.marker}@example.invalid",
                "seats_count": 1,
                "option_selections": [
                    {"option_id": self.free_option_id, "quantity": 1},
                ],
                "answers": [],
                "legal_acceptances": [
                    {
                        "document_id": self.consent_id,
                        "content_hash": f"sha256:consent-{self.marker}",
                    },
                ],
                "account_choice": "without_password",
                "idempotency_key": key or f"publication-{uuid4().hex}",
            },
        )

    async def test_migration_model_default_constraint_and_dynamic_head(self) -> None:
        script = ScriptDirectory.from_config(Config("alembic.ini"))
        revision = script.get_revision("20260805220000")
        self.assertIsNotNone(revision)
        assert revision is not None
        self.assertEqual(revision.down_revision, "20260805210000")
        expected_head = script.get_current_head()
        self.assertIsNotNone(expected_head)
        async with AsyncSessionLocal() as session:
            actual_head = await session.scalar(
                text("SELECT version_num FROM alembic_version"),
            )
        self.assertEqual(actual_head, expected_head)

        async with engine.connect() as connection:
            schema = await connection.run_sync(
                lambda sync_connection: {
                    "columns": inspect(sync_connection).get_columns("events"),
                    "constraints": inspect(sync_connection).get_check_constraints(
                        "events",
                    ),
                },
            )
        columns = {item["name"]: item for item in schema["columns"]}
        self.assertIn("web_visibility", columns)
        self.assertFalse(columns["web_visibility"]["nullable"])
        self.assertIn("disabled", str(columns["web_visibility"]["default"]))
        self.assertIn(
            "events_web_visibility_check",
            {item["name"] for item in schema["constraints"]},
        )
        self.assertFalse(
            any("public" in name and "url" in name for name in columns),
        )

        async with AsyncSessionLocal() as session:
            stored = await session.get(Event, self.event_id)
            assert stored is not None
            self.assertEqual(stored.web_visibility, "disabled")
            for value in ("disabled", "unlisted", "listed"):
                stored.web_visibility = value
                await session.flush()
            stored.web_visibility = "invalid"
            with self.assertRaises(IntegrityError):
                await session.flush()
            await session.rollback()

    def test_trusted_base_url_and_single_slug_builder(self) -> None:
        public_slug = "trusted-public-slug"
        occurrence_id = uuid4()
        settings = Settings(public_web_base_url="https://example.invalid/base/")
        self.assertEqual(settings.public_web_base_url, "https://example.invalid/base")
        self.assertEqual(
            events.build_public_event_url(settings.public_web_base_url, public_slug),
            "https://example.invalid/base/events/trusted-public-slug",
        )
        self.assertEqual(
            events.build_public_event_url(
                settings.public_web_base_url,
                public_slug,
                occurrence_id,
            ),
            f"https://example.invalid/base/events/trusted-public-slug?occurrence={occurrence_id}",
        )
        stable = events.build_public_event_url(settings.public_web_base_url, public_slug)
        self.assertEqual(
            stable,
            events.build_public_event_url(settings.public_web_base_url, public_slug),
        )
        self.assertNotIn("Synthetic", stable)
        self.assertNotIn("@", stable)
        for invalid in (
            "http://example.invalid",
            "https://user:pass@example.invalid",
            "https://example.invalid?from=client",
            "https://example.invalid#fragment",
        ):
            with self.assertRaises(ValidationError):
                Settings(public_web_base_url=invalid)
        self.assertEqual(
            Settings(public_web_base_url="http://127.0.0.1:5174/").public_web_base_url,
            "http://127.0.0.1:5174",
        )

    async def test_admin_get_is_authorized_stable_filtered_and_pii_free(self) -> None:
        path = f"/admin/events/{self.event_id}/web-registration"
        self.assertEqual((await self._request("GET", path)).status_code, 401)
        self.assertEqual(
            (await self._request("GET", path, token=self.non_admin_token)).status_code,
            403,
        )
        response = await self._request(
            "GET",
            path,
            token=self.actor_token,
            headers={"Host": "attacker.invalid", "Origin": "https://attacker.invalid"},
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()["data"]
        self.assertEqual(body["event_id"], str(self.event_id))
        self.assertEqual(body["web_visibility"], "disabled")
        self.assertEqual(body["public_slug"], f"publication-{self.marker}")
        self.assertEqual(
            body["public_registration_url"],
            f"http://localhost:5174/events/publication-{self.marker}",
        )
        self.assertEqual(
            [item["occurrence_id"] for item in body["occurrence_urls"]],
            [str(item) for item in self.active_occurrence_ids],
        )
        self.assertEqual(
            [item["url"] for item in body["occurrence_urls"]],
            [
                f"http://localhost:5174/events/publication-{self.marker}?occurrence={item}"
                for item in self.active_occurrence_ids
            ],
        )
        serialized = response.text.lower()
        for forbidden in ("registration", "participant", "email", "phone", "profile"):
            if forbidden == "registration":
                continue
            self.assertNotIn(forbidden, serialized)
        unknown = await self._request(
            "GET",
            f"/admin/events/{uuid4()}/web-registration",
            token=self.actor_token,
        )
        self.assertEqual(unknown.status_code, 404)

    async def test_admin_patch_is_narrow_idempotent_and_audited(self) -> None:
        path = f"/admin/events/{self.event_id}/web-registration"
        enabled = await self._request(
            "PATCH",
            path,
            token=self.actor_token,
            json={"web_visibility": "unlisted"},
        )
        self.assertEqual(enabled.status_code, 200)
        self.assertEqual(enabled.json()["data"]["web_visibility"], "unlisted")
        repeated = await self._request(
            "PATCH",
            path,
            token=self.actor_token,
            json={"web_visibility": "unlisted"},
        )
        self.assertEqual(repeated.status_code, 200)

        async with AsyncSessionLocal() as session:
            entries = list(
                await session.scalars(
                    select(AdminEventAuditEntry).where(
                        AdminEventAuditEntry.event_id == self.event_id,
                    ),
                ),
            )
            event = await session.get(Event, self.event_id)
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0].actor_user_id, self.actor_id)
        self.assertEqual(entries[0].old_state, "disabled")
        self.assertEqual(entries[0].new_state, "unlisted")
        assert event is not None
        self.assertEqual(event.title, "Publication fixture")
        self.assertEqual(event.status, "published")

        for payload in (
            {"web_visibility": "listed"},
            {"web_visibility": "disabled", "title": "No"},
            {
                "web_visibility": "disabled",
                "public_registration_url": "https://attacker.invalid/events/x",
            },
        ):
            response = await self._request(
                "PATCH",
                path,
                token=self.actor_token,
                json=payload,
            )
            self.assertEqual(response.status_code, 422)

        disabled = await self._request(
            "PATCH",
            path,
            token=self.actor_token,
            json={"web_visibility": "disabled"},
        )
        self.assertEqual(disabled.status_code, 200)
        self.assertEqual(disabled.json()["data"]["web_visibility"], "disabled")

    async def test_admin_patch_rejects_unsupported_registration_modes(self) -> None:
        path = f"/admin/events/{self.event_id}/web-registration"
        for mode in ("none", "external_link", "internal_paid"):
            await self._set_event(registration_mode=mode)
            response = await self._request(
                "PATCH",
                path,
                token=self.actor_token,
                json={"web_visibility": "unlisted"},
            )
            self.assertEqual(response.status_code, 422)
        self.assertNotIn("web_visibility", AdminEventCreateRequest.model_fields)
        self.assertNotIn("web_visibility", AdminEventUpdateRequest.model_fields)
        with self.assertRaises(ValidationError):
            AdminEventWebRegistrationUpdateRequest.model_validate(
                {"web_visibility": "listed"},
            )

    async def test_audit_failure_rolls_back_event_and_event_failure_rolls_back_audit(
        self,
    ) -> None:
        payload = AdminEventWebRegistrationUpdateRequest(web_visibility="unlisted")
        async with AsyncSessionLocal() as session:
            actor = await session.get(AppUser, self.actor_id)
            assert actor is not None
            with patch(
                "app.services.admin_events.record_event_web_visibility_change",
                side_effect=RuntimeError("synthetic audit failure"),
            ):
                with self.assertRaisesRegex(RuntimeError, "synthetic audit failure"):
                    await admin_events.update_admin_event_web_registration(
                        session,
                        actor,
                        self.event_id,
                        payload,
                    )

        async with AsyncSessionLocal() as session:
            event = await session.get(Event, self.event_id)
            count = await session.scalar(
                select(func.count())
                .select_from(AdminEventAuditEntry)
                .where(AdminEventAuditEntry.event_id == self.event_id),
            )
        assert event is not None
        self.assertEqual(event.web_visibility, "disabled")
        self.assertEqual(count, 0)

        async def audit_then_break_event(session, **kwargs):
            entry = await admin_audit.record_event_web_visibility_change(
                session,
                **kwargs,
            )
            locked_event = await session.get(Event, self.event_id)
            assert locked_event is not None
            locked_event.web_visibility = "invalid"
            return entry

        async with AsyncSessionLocal() as session:
            actor = await session.get(AppUser, self.actor_id)
            assert actor is not None
            with patch(
                "app.services.admin_events.record_event_web_visibility_change",
                side_effect=audit_then_break_event,
            ):
                with self.assertRaises(IntegrityError):
                    await admin_events.update_admin_event_web_registration(
                        session,
                        actor,
                        self.event_id,
                        payload,
                    )
        async with AsyncSessionLocal() as session:
            event = await session.get(Event, self.event_id)
            count = await session.scalar(
                select(func.count())
                .select_from(AdminEventAuditEntry)
                .where(AdminEventAuditEntry.event_id == self.event_id),
            )
        assert event is not None
        self.assertEqual(event.web_visibility, "disabled")
        self.assertEqual(count, 0)

    async def test_public_form_filters_data_and_preserves_closed_and_full_pages(self) -> None:
        path = f"/events/{self.event_id}/registration-form?channel=web"
        self.assertEqual((await self._request("GET", path)).status_code, 404)
        await self._set_event(web_visibility="unlisted")
        response = await self._request("GET", path)
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(
            data["canonical_public_path"],
            f"/events/publication-{self.marker}",
        )
        self.assertFalse(data["resolved_from_alias"])
        self.assertEqual(data["registration_state"], "open")
        self.assertEqual(data["questions"], [])
        self.assertEqual(
            [item["id"] for item in data["occurrences"]],
            [str(item) for item in self.active_occurrence_ids],
        )
        self.assertEqual(
            [item["id"] for item in data["participation_options"]],
            [str(self.free_option_id)],
        )
        self.assertEqual(
            [item["document_type"] for item in data["legal_documents"]],
            ["event_registration_consent", "privacy_policy"],
        )
        serialized = response.text.lower()
        for forbidden in (
            "email",
            "phone",
            "profile",
            "membership",
            "audit",
            "conflicts_with",
            "marketing_consent",
        ):
            self.assertNotIn(forbidden, serialized)

        async with AsyncSessionLocal() as session:
            occurrences = list(
                await session.scalars(
                    select(EventOccurrence).where(
                        EventOccurrence.id.in_(self.active_occurrence_ids),
                    ),
                ),
            )
            for occurrence in occurrences:
                occurrence.registration_closes_at = self.now - timedelta(minutes=1)
            await session.commit()
        closed = await self._request("GET", path)
        self.assertEqual(closed.status_code, 200)
        self.assertEqual(closed.json()["data"]["registration_state"], "closed")

        async with AsyncSessionLocal() as session:
            occurrences = list(
                await session.scalars(
                    select(EventOccurrence).where(
                        EventOccurrence.id.in_(self.active_occurrence_ids),
                    ),
                ),
            )
            for occurrence in occurrences:
                occurrence.registration_closes_at = None
                occurrence.capacity = 1
                session.add(
                    EventRegistration(
                        event_id=self.event_id,
                        user_id=self.actor_id,
                        occurrence_id=occurrence.id,
                        status="confirmed",
                        source_channel="mobile",
                    ),
                )
            await session.commit()
        before = await self._registration_count()
        full = await self._request("GET", path)
        self.assertEqual(full.status_code, 200)
        self.assertEqual(full.json()["data"]["registration_state"], "full")
        self.assertEqual(await self._registration_count(), before)

    async def _registration_count(self) -> int:
        async with AsyncSessionLocal() as session:
            count = await session.scalar(
                select(func.count())
                .select_from(EventRegistration)
                .where(EventRegistration.event_id == self.event_id),
            )
        return int(count or 0)

    async def test_public_form_uses_one_safe_unavailable_boundary_and_listed_reads(self) -> None:
        path = f"/events/{self.event_id}/registration-form?channel=web"
        invalid_states = [
            {"web_visibility": "disabled"},
            {"web_visibility": "unlisted", "status": "draft"},
            {"web_visibility": "unlisted", "status": "cancelled"},
            {"web_visibility": "unlisted", "status": "archived"},
            {"web_visibility": "unlisted", "status": "published", "visibility": "hidden"},
            {"web_visibility": "unlisted", "visibility": "members_only"},
            {"web_visibility": "unlisted", "visibility": "public", "registration_mode": "internal_paid"},
            {"web_visibility": "unlisted", "registration_mode": "external_link"},
            {"web_visibility": "unlisted", "registration_mode": "none"},
        ]
        unavailable_bodies = []
        for state in invalid_states:
            baseline = {
                "status": "published",
                "visibility": "public",
                "registration_mode": "internal_free",
                "web_visibility": "disabled",
            }
            baseline.update(state)
            await self._set_event(**baseline)
            response = await self._request("GET", path)
            self.assertEqual(response.status_code, 404)
            unavailable_bodies.append(response.json()["error"])
        self.assertTrue(all(body == unavailable_bodies[0] for body in unavailable_bodies))

        await self._set_event(
            status="published",
            visibility="public",
            registration_mode="internal_free",
            web_visibility="listed",
        )
        self.assertEqual((await self._request("GET", path)).status_code, 200)
        self.assertEqual(
            (
                await self._request(
                    "GET",
                    f"/events/{self.event_id}/registration-form?channel=mobile",
                )
            ).status_code,
            422,
        )
        self.assertEqual(
            (
                await self._request(
                    "GET",
                    f"/events/{self.event_id}/registration-form",
                )
            ).status_code,
            422,
        )

    async def test_intent_boundary_blocks_before_pii_and_allows_supported_visibility(
        self,
    ) -> None:
        deliveries: list[str] = []

        def capture(**kwargs):
            deliveries.append(kwargs["to_address"])
            return EmailSendResult(sent=True, disabled=False)

        with patch(
            "app.services.web_registration.send_web_registration_verification_code",
            side_effect=capture,
        ):
            async with AsyncSessionLocal() as session:
                with self.assertRaises(events.WebRegistrationUnavailableError):
                    await web_registration.create_intent(
                        session,
                        self._intent_payload(key="publication-disabled"),
                        None,
                    )
            async with AsyncSessionLocal() as session:
                count = await session.scalar(
                    select(func.count())
                    .select_from(WebRegistrationIntent)
                    .where(WebRegistrationIntent.event_id == self.event_id),
                )
            self.assertEqual(count, 0)
            self.assertEqual(deliveries, [])

            for visibility in ("unlisted", "listed"):
                await self._set_event(web_visibility=visibility)
                async with AsyncSessionLocal() as session:
                    created = await web_registration.create_intent(
                        session,
                        self._intent_payload(key=f"publication-{visibility}"),
                        None,
                    )
                self.assertEqual(created.next_step, "confirm_email")
        self.assertEqual(len(deliveries), 2)

    async def test_confirmation_rechecks_publication_without_consuming_code(self) -> None:
        deliveries: list[str] = []

        def capture(**kwargs):
            deliveries.append(kwargs["code"])
            return EmailSendResult(sent=True, disabled=False)

        await self._set_event(web_visibility="unlisted")
        with (
            patch(
                "app.services.web_registration.send_web_registration_verification_code",
                side_effect=capture,
            ),
            patch(
                "app.services.web_registration.send_web_registration_result",
                return_value=EmailSendResult(sent=True, disabled=False),
            ),
        ):
            async with AsyncSessionLocal() as session:
                created = await web_registration.create_intent(
                    session,
                    self._intent_payload(key="publication-confirmation"),
                    None,
                )
            code = deliveries[-1]
            await self._set_event(web_visibility="disabled")
            async with AsyncSessionLocal() as session:
                with self.assertRaises(events.WebRegistrationUnavailableError):
                    await web_registration.confirm_email(
                        session,
                        created.flow_id,
                        code,
                        None,
                    )

            async with AsyncSessionLocal() as session:
                intent = await session.scalar(
                    select(WebRegistrationIntent).where(
                        WebRegistrationIntent.event_id == self.event_id,
                    ),
                )
                code_row = await session.scalar(
                    select(WebRegistrationVerificationCode).where(
                        WebRegistrationVerificationCode.registration_intent_id
                        == intent.id,
                    ),
                )
                registrations = await session.scalar(
                    select(func.count())
                    .select_from(EventRegistration)
                    .where(EventRegistration.event_id == self.event_id),
                )
                created_user = await session.scalar(
                    select(AppUser).where(
                        AppUser.email == f"publication-web-{self.marker}@example.invalid",
                    ),
                )
            assert intent is not None and code_row is not None
            self.assertEqual(intent.status, "email_verification_required")
            self.assertIsNone(intent.confirmed_at)
            self.assertIsNone(code_row.consumed_at)
            self.assertEqual(registrations, 0)
            self.assertIsNone(created_user)

            await self._set_event(web_visibility="unlisted")
            async with AsyncSessionLocal() as session:
                confirmed = await web_registration.confirm_email(
                    session,
                    created.flow_id,
                    code,
                    None,
                )
            self.assertEqual(confirmed.intent_status, "confirmed")
            await self._set_event(web_visibility="disabled")
            self.assertEqual(await self._registration_count(), 1)

    async def test_completed_retry_survives_publication_disable(self) -> None:
        verification_deliveries: list[str] = []
        result_deliveries: list[str] = []

        def capture_verification(**kwargs):
            verification_deliveries.append(kwargs["code"])
            return EmailSendResult(sent=True, disabled=False)

        def capture_result(**kwargs):
            result_deliveries.append(kwargs["registration_status"])
            return EmailSendResult(sent=True, disabled=False)

        completed_key = "publication-completed-retry"
        payload = self._intent_payload(key=completed_key)
        payload_json = payload.model_dump(mode="json")

        async def persisted_counts() -> dict[str, int]:
            async with AsyncSessionLocal() as session:
                intent = await session.scalar(
                    select(WebRegistrationIntent).where(
                        WebRegistrationIntent.idempotency_key_hash
                        == web_registration._idempotency_hash(completed_key),
                    ),
                )
                assert intent is not None
                verification_codes = await session.scalar(
                    select(func.count())
                    .select_from(WebRegistrationVerificationCode)
                    .where(
                        WebRegistrationVerificationCode.registration_intent_id
                        == intent.id,
                    ),
                )
                registrations = await session.scalar(
                    select(func.count())
                    .select_from(EventRegistration)
                    .where(EventRegistration.event_id == self.event_id),
                )
                legal_acceptances = await session.scalar(
                    select(func.count())
                    .select_from(LegalAcceptance)
                    .join(
                        EventRegistration,
                        LegalAcceptance.registration_id == EventRegistration.id,
                    )
                    .where(EventRegistration.event_id == self.event_id),
                )
                set_password_codes = await session.scalar(
                    select(func.count()).select_from(AuthSetPasswordCode),
                )
            return {
                "verification_codes": verification_codes or 0,
                "registrations": registrations or 0,
                "legal_acceptances": legal_acceptances or 0,
                "set_password_codes": set_password_codes or 0,
            }

        await self._set_event(web_visibility="unlisted")
        with (
            patch(
                "app.services.web_registration.send_web_registration_verification_code",
                side_effect=capture_verification,
            ),
            patch(
                "app.services.web_registration.send_web_registration_result",
                side_effect=capture_result,
            ),
        ):
            created_response = await self._request(
                "POST",
                "/web/registration-intents",
                json=payload_json,
            )
            self.assertEqual(created_response.status_code, 201)
            flow_id = created_response.json()["data"]["flow_id"]
            confirmation_response = await self._request(
                "POST",
                f"/web/registration-intents/{flow_id}/confirm-email",
                json={"code": verification_deliveries[-1]},
            )
            self.assertEqual(confirmation_response.status_code, 200)
            self.assertEqual(
                confirmation_response.json()["data"]["intent_status"],
                "confirmed",
            )

            baseline_counts = await persisted_counts()
            baseline_verification_emails = len(verification_deliveries)
            baseline_result_emails = len(result_deliveries)

            await self._set_event(web_visibility="disabled")
            retry_response = await self._request(
                "POST",
                "/web/registration-intents",
                json=payload_json,
            )
            self.assertEqual(retry_response.status_code, 201)
            self.assertEqual(retry_response.json()["data"]["flow_id"], flow_id)
            self.assertEqual(retry_response.json()["data"]["next_step"], "completed")
            self.assertNotIn("set_password_code", retry_response.json()["data"])
            self.assertEqual(await persisted_counts(), baseline_counts)
            self.assertEqual(len(verification_deliveries), baseline_verification_emails)
            self.assertEqual(len(result_deliveries), baseline_result_emails)

            disabled_payload_json = dict(payload_json)
            disabled_email = f"publication-web-disabled-{self.marker}@example.invalid"
            disabled_payload_json.update(
                {
                    "email": disabled_email,
                    "phone": f"+7901{int(self.marker[:8], 16) % 10**7:07d}",
                    "idempotency_key": "publication-disabled-new",
                },
            )
            disabled_response = await self._request(
                "POST",
                "/web/registration-intents",
                json=disabled_payload_json,
            )
            self.assertEqual(disabled_response.status_code, 404)
            self.assertEqual(
                disabled_response.json()["error"]["code"],
                "registration_unavailable",
            )
            async with AsyncSessionLocal() as session:
                disabled_intent = await session.scalar(
                    select(WebRegistrationIntent).where(
                        WebRegistrationIntent.idempotency_key_hash
                        == web_registration._idempotency_hash(
                            "publication-disabled-new",
                        ),
                    ),
                )
                disabled_user = await session.scalar(
                    select(AppUser).where(AppUser.email == disabled_email),
                )
            self.assertIsNone(disabled_intent)
            self.assertIsNone(disabled_user)
            self.assertEqual(len(verification_deliveries), baseline_verification_emails)
            self.assertEqual(len(result_deliveries), baseline_result_emails)

            await self._set_event(web_visibility="unlisted")
            unfinished_payload_json = dict(payload_json)
            unfinished_payload_json.update(
                {
                    "email": f"publication-web-unfinished-{self.marker}@example.invalid",
                    "phone": f"+7902{int(self.marker[:8], 16) % 10**7:07d}",
                    "idempotency_key": "publication-unfinished-disable",
                },
            )
            unfinished_response = await self._request(
                "POST",
                "/web/registration-intents",
                json=unfinished_payload_json,
            )
            self.assertEqual(unfinished_response.status_code, 201)
            unfinished_flow_id = unfinished_response.json()["data"]["flow_id"]
            unfinished_code = verification_deliveries[-1]
            await self._set_event(web_visibility="disabled")
            blocked_confirmation = await self._request(
                "POST",
                f"/web/registration-intents/{unfinished_flow_id}/confirm-email",
                json={"code": unfinished_code},
            )
            self.assertEqual(blocked_confirmation.status_code, 404)
            self.assertEqual(
                blocked_confirmation.json()["error"]["code"],
                "registration_unavailable",
            )
            async with AsyncSessionLocal() as session:
                unfinished_intent = await session.scalar(
                    select(WebRegistrationIntent).where(
                        WebRegistrationIntent.idempotency_key_hash
                        == web_registration._idempotency_hash(
                            "publication-unfinished-disable",
                        ),
                    ),
                )
                assert unfinished_intent is not None
                unfinished_code_row = await session.scalar(
                    select(WebRegistrationVerificationCode).where(
                        WebRegistrationVerificationCode.registration_intent_id
                        == unfinished_intent.id,
                    ),
                )
            assert unfinished_code_row is not None
            self.assertEqual(unfinished_intent.status, "email_verification_required")
            self.assertIsNone(unfinished_intent.confirmed_at)
            self.assertIsNone(unfinished_code_row.consumed_at)
            self.assertEqual(await self._registration_count(), 1)
            self.assertEqual(len(result_deliveries), baseline_result_emails)


if __name__ == "__main__":
    unittest.main()
