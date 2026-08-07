from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import httpx
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import delete, event as sqlalchemy_event, func, inspect, select, text
from sqlalchemy.exc import IntegrityError

from app.core.tokens import create_access_token
from app.db.models.core import (
    AppUser,
    Community,
    CommunityMembership,
    Event,
    EventCategory,
    EventRegistration,
    EventRegistrationForm,
    EventRegistrationFormField,
    LegalDocument,
    WebRegistrationIntent,
)
from app.db.session import AsyncSessionLocal, engine
from app.main import app
from app.services import web_registration


class EventQuestionnaireTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        web_registration._rate_limiter = None
        self.community_id = uuid4()
        self.foreign_community_id = uuid4()
        self.event_id = uuid4()
        self.foreign_event_id = uuid4()
        self.admin_id = uuid4()
        self.event_manager_id = uuid4()
        self.member_id = uuid4()
        self.foreign_admin_id = uuid4()
        self.consent_id = uuid4()
        self.now = datetime.now(UTC).replace(microsecond=0)
        self.marker = uuid4().hex[:12]
        self.tokens = {
            "admin": create_access_token(self.admin_id),
            "event_manager": create_access_token(self.event_manager_id),
            "member": create_access_token(self.member_id),
            "foreign_admin": create_access_token(self.foreign_admin_id),
        }

        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add_all(
                    [
                        Community(
                            id=self.community_id,
                            name="Questionnaire community",
                            city="Moscow",
                            slug=f"questionnaire-{self.marker}",
                        ),
                        Community(
                            id=self.foreign_community_id,
                            name="Foreign questionnaire community",
                            city="Moscow",
                            slug=f"questionnaire-foreign-{self.marker}",
                        ),
                    ],
                )
                for user_id, role_name in (
                    (self.admin_id, "admin"),
                    (self.event_manager_id, "event-manager"),
                    (self.member_id, "member"),
                    (self.foreign_admin_id, "foreign-admin"),
                ):
                    session.add(
                        AppUser(
                            id=user_id,
                            email=f"questionnaire-{role_name}-{self.marker}@example.invalid",
                            password_hash="synthetic-hash",
                            account_origin="password_signup",
                            claim_state="claimed",
                            status="active",
                        ),
                    )
                await session.flush()
                session.add_all(
                    [
                        EventCategory(
                            community_id=self.community_id,
                            slug="community",
                            title="Community",
                            color="#123456",
                            icon="*",
                        ),
                        EventCategory(
                            community_id=self.foreign_community_id,
                            slug="community",
                            title="Community",
                            color="#654321",
                            icon="*",
                        ),
                    ],
                )
                await session.flush()
                session.add_all(
                    [
                        CommunityMembership(
                            community_id=self.community_id,
                            user_id=self.admin_id,
                            role="admin",
                            status="active",
                        ),
                        CommunityMembership(
                            community_id=self.community_id,
                            user_id=self.event_manager_id,
                            role="event_manager",
                            status="active",
                        ),
                        CommunityMembership(
                            community_id=self.community_id,
                            user_id=self.member_id,
                            role="member",
                            status="active",
                        ),
                        CommunityMembership(
                            community_id=self.foreign_community_id,
                            user_id=self.foreign_admin_id,
                            role="admin",
                            status="active",
                        ),
                        Event(
                            id=self.event_id,
                            community_id=self.community_id,
                            title="Questionnaire event",
                            starts_at=self.now + timedelta(days=5),
                            category="community",
                            registration_mode="internal_free",
                            web_visibility="unlisted",
                            status="published",
                            visibility="public",
                            capacity=25,
                        ),
                        Event(
                            id=self.foreign_event_id,
                            community_id=self.foreign_community_id,
                            title="Foreign questionnaire event",
                            starts_at=self.now + timedelta(days=6),
                            category="community",
                            registration_mode="internal_free",
                            web_visibility="unlisted",
                            status="published",
                            visibility="public",
                        ),
                        LegalDocument(
                            id=self.consent_id,
                            document_type="event_registration_consent",
                            version=f"questionnaire-consent-{self.marker}",
                            title="Synthetic questionnaire consent",
                            content_hash=f"sha256:questionnaire-{self.marker}",
                            published_url="https://example.invalid/questionnaire-consent",
                            effective_at=self.now - timedelta(hours=1),
                        ),
                    ],
                )

    async def asyncTearDown(self) -> None:
        try:
            async with AsyncSessionLocal() as session:
                async with session.begin():
                    await session.execute(
                        delete(Community).where(
                            Community.id.in_(
                                (self.community_id, self.foreign_community_id),
                            ),
                        ),
                    )
                    await session.execute(
                        delete(LegalDocument).where(LegalDocument.id == self.consent_id),
                    )
                    await session.execute(
                        delete(AppUser).where(
                            AppUser.id.in_(
                                (
                                    self.admin_id,
                                    self.event_manager_id,
                                    self.member_id,
                                    self.foreign_admin_id,
                                ),
                            ),
                        ),
                    )
        finally:
            await engine.dispose()

    async def _request(
        self,
        method: str,
        path: str,
        *,
        role: str | None = None,
        json: dict[str, object] | None = None,
    ) -> httpx.Response:
        headers = (
            {"Authorization": f"Bearer {self.tokens[role]}"}
            if role is not None
            else {}
        )
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
        ) as client:
            return await client.request(method, path, headers=headers, json=json)

    def _draft_payload(self) -> dict[str, object]:
        return {
            "purpose": "Organize event participation",
            "fields": [
                {
                    "field_key": "arrival_note",
                    "field_type": "short_text",
                    "label": "Arrival note",
                    "required": False,
                    "purpose": "Coordinate participant arrival",
                    "retention_days": 14,
                    "options": [],
                    "validation": {"max_length": 120},
                    "data_category": "ordinary",
                    "sort_order": 20,
                },
                {
                    "field_key": "session_choice",
                    "field_type": "single_select",
                    "label": "Preferred session",
                    "required": True,
                    "purpose": "Plan room allocation",
                    "retention_days": 21,
                    "options": [
                        {"value": "morning", "label": "Morning"},
                        {"value": "evening", "label": "Evening"},
                    ],
                    "validation": {},
                    "data_category": "ordinary",
                    "sort_order": 10,
                },
            ],
        }

    async def _put_draft(self, payload: dict[str, object] | None = None) -> httpx.Response:
        return await self._request(
            "PUT",
            f"/admin/events/{self.event_id}/web-questionnaire/draft",
            role="admin",
            json=payload or self._draft_payload(),
        )

    async def _publish(self) -> httpx.Response:
        return await self._request(
            "POST",
            f"/admin/events/{self.event_id}/web-questionnaire/publish",
            role="admin",
        )

    async def test_migration_and_database_invariants(self) -> None:
        script = ScriptDirectory.from_config(Config("alembic.ini"))
        revision = script.get_revision("20260807120000")
        self.assertIsNotNone(revision)
        assert revision is not None
        self.assertEqual(revision.down_revision, "20260806200000")
        answer_revision = script.get_revision("20260807160000")
        self.assertIsNotNone(answer_revision)
        assert answer_revision is not None
        self.assertEqual(answer_revision.down_revision, "20260807120000")
        expected_head = script.get_current_head()
        async with AsyncSessionLocal() as session:
            actual_head = await session.scalar(
                text("SELECT version_num FROM alembic_version"),
            )
        self.assertEqual(actual_head, expected_head)

        async with engine.connect() as connection:
            schema = await connection.run_sync(
                lambda sync_connection: {
                    "form_constraints": inspect(sync_connection).get_check_constraints(
                        "event_registration_forms",
                    ),
                    "field_constraints": inspect(sync_connection).get_check_constraints(
                        "event_registration_form_fields",
                    ),
                    "form_indexes": inspect(sync_connection).get_indexes(
                        "event_registration_forms",
                    ),
                    "answer_constraints": inspect(sync_connection).get_check_constraints(
                        "event_registration_answers",
                    ),
                    "answer_indexes": inspect(sync_connection).get_indexes(
                        "event_registration_answers",
                    ),
                },
            )
        self.assertIn(
            "event_registration_forms_version_positive_check",
            {item["name"] for item in schema["form_constraints"]},
        )
        self.assertIn(
            "event_registration_form_fields_data_category_check",
            {item["name"] for item in schema["field_constraints"]},
        )
        self.assertIn(
            "event_registration_forms_one_published_idx",
            {item["name"] for item in schema["form_indexes"]},
        )
        self.assertIn(
            "event_registration_answers_value_shape_check",
            {item["name"] for item in schema["answer_constraints"]},
        )
        self.assertLessEqual(
            {
                "event_registration_answers_registration_id_idx",
                "event_registration_answers_purge_at_idx",
            },
            {item["name"] for item in schema["answer_indexes"]},
        )

        form_id = uuid4()
        async with AsyncSessionLocal() as session:
            session.add(
                EventRegistrationForm(
                    id=form_id,
                    event_id=self.event_id,
                    channel="web",
                    version=1,
                    purpose="Valid purpose",
                    status="draft",
                ),
            )
            session.add(
                EventRegistrationFormField(
                    form_id=form_id,
                    field_key="valid_key",
                    field_type="boolean",
                    label="Valid label",
                    required=False,
                    purpose="Valid field purpose",
                    retention_days=7,
                    options_payload=[],
                    validation_payload={},
                    data_category="ordinary",
                    sort_order=0,
                ),
            )
            await session.commit()

        invalid_forms = [
            EventRegistrationForm(
                event_id=self.event_id,
                channel="web",
                version=0,
                purpose="Invalid version",
                status="retired",
                published_at=self.now,
            ),
            EventRegistrationForm(
                event_id=self.event_id,
                channel="web",
                version=1,
                purpose="Duplicate version",
                status="retired",
                published_at=self.now,
            ),
        ]
        for invalid_form in invalid_forms:
            async with AsyncSessionLocal() as session:
                session.add(invalid_form)
                with self.assertRaises(IntegrityError):
                    await session.flush()
                await session.rollback()

        invalid_fields = [
            EventRegistrationFormField(
                form_id=form_id,
                field_key="valid_key",
                field_type="boolean",
                label="Duplicate key",
                required=False,
                purpose="Duplicate key check",
                retention_days=7,
                options_payload=[],
                validation_payload={},
                data_category="ordinary",
                sort_order=1,
            ),
            EventRegistrationFormField(
                form_id=form_id,
                field_key="bad_retention",
                field_type="boolean",
                label="Bad retention",
                required=False,
                purpose="Retention check",
                retention_days=0,
                options_payload=[],
                validation_payload={},
                data_category="ordinary",
                sort_order=2,
            ),
            EventRegistrationFormField(
                form_id=form_id,
                field_key="bad_category",
                field_type="boolean",
                label="Bad category",
                required=False,
                purpose="Category check",
                retention_days=7,
                options_payload=[],
                validation_payload={},
                data_category="restricted",
                sort_order=3,
            ),
            EventRegistrationFormField(
                form_id=form_id,
                field_key="bad_type",
                field_type="date",
                label="Bad type",
                required=False,
                purpose="Type check",
                retention_days=7,
                options_payload=[],
                validation_payload={},
                data_category="ordinary",
                sort_order=4,
            ),
        ]
        for invalid_field in invalid_fields:
            async with AsyncSessionLocal() as session:
                session.add(invalid_field)
                with self.assertRaises(IntegrityError):
                    await session.flush()
                await session.rollback()

    async def test_admin_authorization_is_admin_only_and_community_scoped(self) -> None:
        path = f"/admin/events/{self.event_id}/web-questionnaire"
        response = await self._request("GET", path, role="admin")
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["data"]["draft"])
        self.assertIsNone(response.json()["data"]["published"])

        for role in ("event_manager", "member"):
            denied = await self._request("GET", path, role=role)
            self.assertEqual(denied.status_code, 403)

        foreign = await self._request("GET", path, role="foreign_admin")
        self.assertEqual(foreign.status_code, 404)
        foreign_update = await self._request(
            "PUT",
            f"/admin/events/{self.event_id}/web-questionnaire/draft",
            role="foreign_admin",
            json=self._draft_payload(),
        )
        self.assertEqual(foreign_update.status_code, 404)

        created = await self._put_draft()
        self.assertEqual(created.status_code, 200)
        serialized = created.text.lower()
        self.assertNotIn("created_by", serialized)
        self.assertNotIn("updated_by", serialized)
        published = await self._publish()
        self.assertEqual(published.status_code, 200)

    async def test_versioning_publication_and_immutability(self) -> None:
        baseline_counts: tuple[int, int, int]
        async with AsyncSessionLocal() as session:
            baseline_counts = (
                int(await session.scalar(select(func.count()).select_from(AppUser)) or 0),
                int(
                    await session.scalar(
                        select(func.count()).select_from(EventRegistration),
                    )
                    or 0
                ),
                int(
                    await session.scalar(
                        select(func.count()).select_from(WebRegistrationIntent),
                    )
                    or 0
                ),
            )

        created = await self._put_draft()
        self.assertEqual(created.status_code, 200)
        self.assertEqual(created.json()["data"]["draft"]["version"], 1)
        first_publication = await self._publish()
        self.assertEqual(first_publication.status_code, 200)
        first = first_publication.json()["data"]["published"]
        self.assertEqual(first["version"], 1)
        first_form_id = first["id"]

        async with AsyncSessionLocal() as session:
            published_form = await session.get(EventRegistrationForm, first_form_id)
            assert published_form is not None
            published_form.purpose = "Mutated purpose"
            with self.assertRaises(IntegrityError):
                await session.flush()
            await session.rollback()

        next_payload = self._draft_payload()
        next_payload["purpose"] = "Second version purpose"
        next_payload["fields"][0]["label"] = "Second version arrival note"
        second_draft = await self._put_draft(next_payload)
        self.assertEqual(second_draft.status_code, 200)
        state = second_draft.json()["data"]
        self.assertEqual(state["draft"]["version"], 2)
        self.assertEqual(state["published"]["version"], 1)
        self.assertEqual(state["published"]["purpose"], "Organize event participation")

        second_publication = await self._publish()
        self.assertEqual(second_publication.status_code, 200)
        self.assertEqual(
            second_publication.json()["data"]["published"]["version"],
            2,
        )
        self.assertIsNone(second_publication.json()["data"]["draft"])
        self.assertEqual((await self._publish()).status_code, 409)

        async with AsyncSessionLocal() as session:
            forms = list(
                await session.scalars(
                    select(EventRegistrationForm)
                    .where(EventRegistrationForm.event_id == self.event_id)
                    .order_by(EventRegistrationForm.version),
                ),
            )
            self.assertEqual([form.status for form in forms], ["retired", "published"])
            self.assertEqual(
                len([form for form in forms if form.status == "published"]),
                1,
            )
            after_counts = (
                int(await session.scalar(select(func.count()).select_from(AppUser)) or 0),
                int(
                    await session.scalar(
                        select(func.count()).select_from(EventRegistration),
                    )
                    or 0
                ),
                int(
                    await session.scalar(
                        select(func.count()).select_from(WebRegistrationIntent),
                    )
                    or 0
                ),
            )
        self.assertEqual(after_counts, baseline_counts)

    async def test_strict_questionnaire_validation(self) -> None:
        base = self._draft_payload()
        invalid_payloads: list[dict[str, object]] = []

        for mutation in (
            lambda payload: payload.update({"purpose": ""}),
            lambda payload: payload["fields"][0].update({"label": ""}),
            lambda payload: payload["fields"][0].update({"purpose": ""}),
            lambda payload: payload["fields"][0].update({"retention_days": 0}),
            lambda payload: payload["fields"][0].update({"field_type": "date"}),
            lambda payload: payload["fields"][0].update({"data_category": "restricted"}),
            lambda payload: payload["fields"][1].update({"options": []}),
            lambda payload: payload["fields"][0].update(
                {"options": [{"value": "unexpected", "label": "Unexpected"}]},
            ),
            lambda payload: payload["fields"][0].update(
                {"validation": {"pattern": 1}},
            ),
            lambda payload: payload["fields"][0].update({"label": "Bad\u0000label"}),
            lambda payload: payload["fields"][0].update({"label": "<b>Markup</b>"}),
            lambda payload: payload.update({"unexpected": True}),
            lambda payload: payload["fields"][0].update({"unexpected": True}),
        ):
            import copy

            payload = copy.deepcopy(base)
            mutation(payload)
            invalid_payloads.append(payload)

        for payload in invalid_payloads:
            response = await self._put_draft(payload)
            self.assertEqual(response.status_code, 422, response.text)

        empty_publish = await self._publish()
        self.assertEqual(empty_publish.status_code, 409)

    async def test_public_contract_visibility_privacy_and_answer_boundary(self) -> None:
        public_path = f"/events/{self.event_id}/registration-form?channel=web"
        statements: list[str] = []

        def capture_statement(
            _connection: object,
            _cursor: object,
            statement: str,
            _parameters: object,
            _context: object,
            _executemany: object,
        ) -> None:
            statements.append(statement.lower())

        sqlalchemy_event.listen(
            engine.sync_engine,
            "before_cursor_execute",
            capture_statement,
        )
        try:
            no_form = await self._request("GET", public_path)
            self.assertEqual(no_form.status_code, 200)
            self.assertIsNone(no_form.json()["data"]["questionnaire_form_id"])
            self.assertEqual(no_form.json()["data"]["questions"], [])

            draft = await self._put_draft()
            self.assertEqual(draft.status_code, 200)
            draft_only = await self._request("GET", public_path)
            self.assertEqual(draft_only.status_code, 200)
            self.assertIsNone(draft_only.json()["data"]["questionnaire_form_id"])
            self.assertEqual(draft_only.json()["data"]["questions"], [])

            self.assertEqual((await self._publish()).status_code, 200)
            published = await self._request("GET", public_path)
            self.assertEqual(published.status_code, 200)
            questions = published.json()["data"]["questions"]
            self.assertEqual(
                published.json()["data"]["questionnaire_form_id"],
                (await self._request(
                    "GET",
                    f"/admin/events/{self.event_id}/web-questionnaire",
                    role="admin",
                )).json()["data"]["published"]["id"],
            )
            self.assertEqual(
                [question["field_key"] for question in questions],
                ["session_choice", "arrival_note"],
            )
            self.assertEqual(
                set(questions[0]),
                {
                    "id",
                    "field_key",
                    "field_type",
                    "label",
                    "required",
                    "purpose",
                    "retention_days",
                    "options",
                    "validation",
                    "sort_order",
                },
            )
            self.assertNotIn("data_category", published.text)
            self.assertNotIn("published_at", published.text)
            self.assertNotIn("created_by", published.text)
            self.assertFalse(
                any(("prayer_activity_" + "logs") in statement for statement in statements),
            )
        finally:
            sqlalchemy_event.remove(
                engine.sync_engine,
                "before_cursor_execute",
                capture_statement,
            )

        async with AsyncSessionLocal() as session:
            form = await session.scalar(
                select(EventRegistrationForm).where(
                    EventRegistrationForm.event_id == self.event_id,
                    EventRegistrationForm.status == "published",
                ),
            )
            assert form is not None
            form.status = "retired"
            form.updated_at = datetime.now(UTC)
            await session.commit()
        retired = await self._request("GET", public_path)
        self.assertEqual(retired.status_code, 200)
        self.assertIsNone(retired.json()["data"]["questionnaire_form_id"])
        self.assertEqual(retired.json()["data"]["questions"], [])

        await self._put_draft()
        await self._publish()
        async with AsyncSessionLocal() as session:
            event = await session.get(Event, self.event_id)
            assert event is not None
            event.web_visibility = "disabled"
            await session.commit()
        self.assertEqual((await self._request("GET", public_path)).status_code, 404)
        async with AsyncSessionLocal() as session:
            event = await session.get(Event, self.event_id)
            assert event is not None
            event.web_visibility = "listed"
            await session.commit()
        self.assertEqual((await self._request("GET", public_path)).status_code, 200)
        async with AsyncSessionLocal() as session:
            event = await session.get(Event, self.event_id)
            assert event is not None
            event.web_visibility = "unlisted"
            await session.commit()

        before_registrations: int
        async with AsyncSessionLocal() as session:
            before_registrations = int(
                await session.scalar(
                    select(func.count())
                    .select_from(EventRegistration)
                    .where(EventRegistration.event_id == self.event_id),
                )
                or 0
            )
        answer_response = await self._request(
            "POST",
            "/web/registration-intents",
            json={
                "event_id": str(self.event_id),
                "occurrence_id": None,
                "first_name": "Synthetic",
                "last_name": "Participant",
                "phone": "+79001234567",
                "email": f"questionnaire-participant-{self.marker}@example.invalid",
                "seats_count": 1,
                "option_selections": [],
                "questionnaire_form_id": None,
                "answers": [{"field_key": "arrival_note", "value": "Synthetic"}],
                "legal_acceptances": [
                    {
                        "document_id": str(self.consent_id),
                        "content_hash": f"sha256:questionnaire-{self.marker}",
                    },
                ],
                "account_choice": "without_password",
                "idempotency_key": f"questionnaire-{self.marker}",
            },
        )
        self.assertEqual(answer_response.status_code, 422)
        async with AsyncSessionLocal() as session:
            after_registrations = int(
                await session.scalar(
                    select(func.count())
                    .select_from(EventRegistration)
                    .where(EventRegistration.event_id == self.event_id),
                )
                or 0
            )
            stored_answers = await session.scalar(
                select(func.count())
                .select_from(WebRegistrationIntent)
                .where(
                    WebRegistrationIntent.event_id == self.event_id,
                    WebRegistrationIntent.answer_payload.is_not(None),
                ),
            )
        self.assertEqual(after_registrations, before_registrations)
        self.assertEqual(int(stored_answers or 0), 0)
