from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import httpx
from sqlalchemy import delete, func, select

from app.core.tokens import create_access_token
from app.db.models.audit import AdminEventAuditEntry
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
    EventRegistrationForm,
    EventRegistrationFormField,
    LegalDocument,
    WebRegistrationIntent,
)
from app.db.session import AsyncSessionLocal, engine
from app.main import app


class WebEventSlugRoutingTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.marker = uuid4().hex[:12]
        self.community_id = uuid4()
        self.actor_id = uuid4()
        self.event_id = uuid4()
        self.occurrence_id = uuid4()
        self.option_id = uuid4()
        self.form_id = uuid4()
        self.field_id = uuid4()
        self.consent_id = uuid4()
        self.canonical_slug = f"slug-route-{self.marker}"
        self.alias_slug = f"old-route-{self.marker}"
        self.now = datetime.now(UTC).replace(microsecond=0)
        self.actor_token = create_access_token(self.actor_id)

        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add_all(
                    [
                        Community(
                            id=self.community_id,
                            name="Slug route community",
                            city="Moscow",
                            slug=f"slug-route-community-{self.marker}",
                        ),
                        AppUser(
                            id=self.actor_id,
                            account_origin="password_signup",
                            claim_state="claimed",
                            status="active",
                        ),
                    ],
                )
                await session.flush()
                session.add_all(
                    [
                        CommunityMembership(
                            community_id=self.community_id,
                            user_id=self.actor_id,
                            role="admin",
                            status="active",
                        ),
                        EventCategory(
                            community_id=self.community_id,
                            slug="community",
                            title="Community",
                            color="#123456",
                            icon="*",
                        ),
                    ],
                )
                await session.flush()
                event = Event(
                    id=self.event_id,
                    community_id=self.community_id,
                    title="Public slug route fixture",
                    starts_at=self.now + timedelta(days=5),
                    category="community",
                    registration_mode="internal_free",
                    status="published",
                    visibility="public",
                    web_visibility="unlisted",
                    capacity=10,
                )
                session.add(event)
                await session.flush()
                questionnaire = EventRegistrationForm(
                    id=self.form_id,
                    event_id=self.event_id,
                    channel="web",
                    version=1,
                    purpose="Collect an ordinary answer",
                    status="draft",
                )
                session.add_all(
                    [
                        EventPublicSlug(
                            event_id=self.event_id,
                            slug=self.canonical_slug,
                            is_canonical=True,
                            created_by=self.actor_id,
                        ),
                        EventPublicSlug(
                            event_id=self.event_id,
                            slug=self.alias_slug,
                            is_canonical=False,
                            created_by=self.actor_id,
                        ),
                        EventOccurrence(
                            id=self.occurrence_id,
                            event_id=self.event_id,
                            title="Fixture occurrence",
                            starts_at=self.now + timedelta(days=5),
                            capacity=3,
                            status="active",
                        ),
                        EventParticipationOption(
                            id=self.option_id,
                            event_id=self.event_id,
                            title="Free option",
                            price_amount=0,
                            option_type="participation",
                            is_active=True,
                        ),
                        LegalDocument(
                            id=self.consent_id,
                            document_type="event_registration_consent",
                            version=f"slug-route-consent-{self.marker}",
                            title="Synthetic consent",
                            content_hash=f"sha256:slug-route-{self.marker}",
                            published_url="https://example.invalid/consent",
                            effective_at=self.now - timedelta(hours=1),
                        ),
                        questionnaire,
                    ],
                )
                await session.flush()
                session.add(
                    EventRegistrationFormField(
                        id=self.field_id,
                        form_id=self.form_id,
                        field_key="arrival_note",
                        field_type="short_text",
                        label="Arrival note",
                        required=False,
                        purpose="Coordinate arrival",
                        retention_days=7,
                        options_payload=[],
                        validation_payload={"max_length": 40},
                        data_category="ordinary",
                        sort_order=0,
                    ),
                )
                await session.flush()
                questionnaire.status = "published"
                questionnaire.published_at = self.now

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
                        delete(Community).where(Community.id == self.community_id),
                    )
                    await session.execute(
                        delete(LegalDocument).where(LegalDocument.id == self.consent_id),
                    )
                    await session.execute(
                        delete(AppUser).where(AppUser.id == self.actor_id),
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
    ) -> httpx.Response:
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
        ) as client:
            return await client.request(method, path, headers=headers, json=json)

    async def _set_event(self, **updates: object) -> None:
        async with AsyncSessionLocal() as session:
            event = await session.get(Event, self.event_id)
            assert event is not None
            for field_name, value in updates.items():
                setattr(event, field_name, value)
            await session.commit()

    async def _persisted_counts(self) -> tuple[int, int, int]:
        async with AsyncSessionLocal() as session:
            occurrence_count = await session.scalar(
                select(func.count())
                .select_from(EventOccurrence)
                .where(EventOccurrence.event_id == self.event_id),
            )
            intent_count = await session.scalar(
                select(func.count())
                .select_from(WebRegistrationIntent)
                .where(WebRegistrationIntent.event_id == self.event_id),
            )
            registration_count = await session.scalar(
                select(func.count())
                .select_from(EventRegistration)
                .where(EventRegistration.event_id == self.event_id),
            )
        return (
            int(occurrence_count or 0),
            int(intent_count or 0),
            int(registration_count or 0),
        )

    async def test_canonical_alias_and_uuid_share_one_public_form_contract(self) -> None:
        before = await self._persisted_counts()
        canonical = await self._request(
            "GET",
            f"/web/events/{self.canonical_slug}/registration-form",
        )
        alias = await self._request(
            "GET",
            f"/web/events/{self.alias_slug}/registration-form",
        )
        legacy = await self._request(
            "GET",
            f"/events/{self.event_id}/registration-form?channel=web",
        )
        legacy_occurrence = await self._request(
            "GET",
            (
                f"/events/{self.event_id}/registration-form?channel=web"
                f"&occurrence={self.occurrence_id}"
            ),
        )
        for response in (canonical, alias, legacy, legacy_occurrence):
            self.assertEqual(response.status_code, 200)

        canonical_data = canonical.json()["data"]
        alias_data = alias.json()["data"]
        legacy_data = legacy.json()["data"]
        self.assertFalse(canonical_data["resolved_from_alias"])
        self.assertTrue(alias_data["resolved_from_alias"])
        self.assertFalse(legacy_data["resolved_from_alias"])
        self.assertEqual(
            canonical_data["canonical_public_path"],
            f"/events/{self.canonical_slug}",
        )
        comparable_keys = (
            "canonical_public_path",
            "event",
            "registration_state",
            "occurrences",
            "participation_options",
            "legal_documents",
            "questionnaire_form_id",
            "questions",
        )
        for key in comparable_keys:
            self.assertEqual(alias_data[key], canonical_data[key])
            self.assertEqual(legacy_data[key], canonical_data[key])

        self.assertEqual(UUID(canonical_data["event"]["id"]), self.event_id)
        self.assertEqual(
            UUID(canonical_data["occurrences"][0]["event_id"]),
            self.event_id,
        )
        self.assertEqual(canonical_data["questionnaire_form_id"], str(self.form_id))
        self.assertEqual(canonical_data["questions"][0]["id"], str(self.field_id))
        serialized = canonical.text.lower()
        for forbidden in ("aliases", "alias_history", "admin_notes", "created_by"):
            self.assertNotIn(forbidden, serialized)
        self.assertEqual(await self._persisted_counts(), before)

    async def test_invalid_and_unknown_slugs_share_the_safe_unavailable_response(self) -> None:
        values = (
            f"missing-{self.marker}",
            self.canonical_slug.upper(),
            "Шабат",
            "admin",
            "a",
            "a" * 81,
            "bad--slug",
            "123e4567-e89b-12d3-a456-426614174000",
            "https://example.invalid/events/example",
        )
        errors: list[dict[str, object]] = []
        for value in values:
            with self.subTest(value=value):
                response = await self._request(
                    "GET",
                    f"/web/events/{value}/registration-form",
                )
                self.assertEqual(response.status_code, 404)
                errors.append(response.json()["error"])
        self.assertTrue(all(error == errors[0] for error in errors))
        self.assertEqual(errors[0]["code"], "registration_unavailable")

    async def test_unavailable_states_are_identical_for_uuid_canonical_and_alias(self) -> None:
        routes = (
            f"/events/{self.event_id}/registration-form?channel=web",
            f"/web/events/{self.canonical_slug}/registration-form",
            f"/web/events/{self.alias_slug}/registration-form",
        )
        states = (
            {"web_visibility": "disabled"},
            {"status": "draft"},
            {"visibility": "hidden"},
            {"registration_mode": "none"},
        )
        baseline = {
            "web_visibility": "unlisted",
            "status": "published",
            "visibility": "public",
            "registration_mode": "internal_free",
        }
        for state in states:
            await self._set_event(**(baseline | state))
            responses = [await self._request("GET", route) for route in routes]
            self.assertTrue(all(response.status_code == 404 for response in responses))
            self.assertEqual(
                [response.json()["error"] for response in responses],
                [responses[0].json()["error"]] * len(responses),
            )
        await self._set_event(**baseline)

    async def test_slug_change_updates_admin_urls_and_keeps_old_alias_working(self) -> None:
        new_slug = f"new-route-{self.marker}"
        changed = await self._request(
            "PATCH",
            f"/admin/events/{self.event_id}/web-registration",
            token=self.actor_token,
            json={"public_slug": new_slug},
        )
        self.assertEqual(changed.status_code, 200)
        data = changed.json()["data"]
        self.assertEqual(
            data["public_registration_url"],
            f"http://localhost:5174/events/{new_slug}",
        )
        self.assertNotIn("occurrence_urls", data)

        old_canonical = await self._request(
            "GET",
            f"/web/events/{self.canonical_slug}/registration-form",
        )
        older_alias = await self._request(
            "GET",
            f"/web/events/{self.alias_slug}/registration-form",
        )
        new_canonical = await self._request(
            "GET",
            f"/web/events/{new_slug}/registration-form",
        )
        for response in (old_canonical, older_alias, new_canonical):
            self.assertEqual(response.status_code, 200)
            self.assertEqual(
                response.json()["data"]["canonical_public_path"],
                f"/events/{new_slug}",
            )
        self.assertTrue(old_canonical.json()["data"]["resolved_from_alias"])
        self.assertTrue(older_alias.json()["data"]["resolved_from_alias"])
        self.assertFalse(new_canonical.json()["data"]["resolved_from_alias"])

        await self._set_event(title="Renamed without changing the public address")
        async with AsyncSessionLocal() as session:
            async with session.begin():
                occurrence = await session.get(EventOccurrence, self.occurrence_id)
                assert occurrence is not None
                occurrence.starts_at += timedelta(days=7)
        current = await self._request(
            "GET",
            f"/admin/events/{self.event_id}/web-registration",
            token=self.actor_token,
        )
        self.assertEqual(current.status_code, 200)
        self.assertEqual(
            current.json()["data"]["public_registration_url"],
            f"http://localhost:5174/events/{new_slug}",
        )


if __name__ == "__main__":
    unittest.main()
