from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import delete, inspect, select, text
from sqlalchemy.exc import IntegrityError

from app.db.models.core import (
    AppUser,
    Community,
    Event,
    EventCategory,
    EventRegistration,
    Invite,
    LegalAcceptance,
    LegalDocument,
)
from app.db.session import AsyncSessionLocal, engine
from app.schemas.registrations import RegisterEventRequest
from app.services import auth as auth_service
from app.services import registrations as registration_service


class WebRegistrationIdentitySchemaTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.community_id = uuid4()
        self.user_id = uuid4()
        self.event_id = uuid4()
        self.now = datetime.now(UTC).replace(microsecond=0)
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add_all(
                    [
                        Community(
                            id=self.community_id,
                            name="Schema test community",
                            city="Moscow",
                            slug=f"schema-{self.community_id.hex[:20]}",
                        ),
                        AppUser(
                            id=self.user_id,
                            email=f"schema-{self.user_id.hex}@example.invalid",
                            password_hash="test-hash",
                            account_origin="password_signup",
                            claim_state="claimed",
                            claimed_at=self.now,
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
                        created_by=self.user_id,
                        updated_by=self.user_id,
                    ),
                )
                await session.flush()
                session.add(
                    Event(
                        id=self.event_id,
                        community_id=self.community_id,
                        title="Schema test event",
                        starts_at=self.now + timedelta(days=1),
                        category="community",
                        registration_mode="internal_free",
                    ),
                )

    async def asyncTearDown(self) -> None:
        try:
            async with AsyncSessionLocal() as session:
                async with session.begin():
                    await session.execute(
                        delete(AppUser).where(
                            AppUser.email.like("schema-%@example.invalid"),
                        ),
                    )
                    await session.execute(
                        delete(LegalDocument).where(
                            LegalDocument.version.like("test-%"),
                        ),
                    )
                    await session.execute(
                        delete(Community).where(Community.id == self.community_id),
                    )
        finally:
            await engine.dispose()

    def test_models_expose_required_fields(self) -> None:
        user_columns = set(inspect(AppUser).columns.keys())
        self.assertTrue(
            {
                "account_origin",
                "claim_state",
                "claimed_at",
                "deletion_requested_at",
                "erased_at",
            }.issubset(user_columns),
        )
        self.assertIn("source_channel", inspect(EventRegistration).columns.keys())

    async def _assert_rejected(self, session, row) -> None:
        with self.assertRaises(IntegrityError):
            async with session.begin_nested():
                session.add(row)
                await session.flush()

    async def test_user_identity_values_and_passwordless_creation(self) -> None:
        async with AsyncSessionLocal() as session:
            async with session.begin():
                for origin in (
                    "password_signup",
                    "invite",
                    "web_guest",
                    "migration",
                    "admin",
                ):
                    session.add(
                        AppUser(
                            email=f"schema-origin-{origin}-{uuid4().hex}@example.invalid",
                            password_hash="test-hash",
                            account_origin=origin,
                            claim_state="claimed",
                        ),
                    )
                for state in ("unclaimed", "claimed", "legacy_external"):
                    session.add(
                        AppUser(
                            email=f"schema-state-{state}-{uuid4().hex}@example.invalid",
                            password_hash=None,
                            account_origin="migration",
                            claim_state=state,
                        ),
                    )
                await session.flush()
                await self._assert_rejected(
                    session,
                    AppUser(
                        email=f"schema-bad-origin-{uuid4().hex}@example.invalid",
                        account_origin="invalid",
                        claim_state="claimed",
                    ),
                )
                await self._assert_rejected(
                    session,
                    AppUser(
                        email=f"schema-bad-state-{uuid4().hex}@example.invalid",
                        account_origin="migration",
                        claim_state="invalid",
                    ),
                )

    async def test_signup_and_invite_set_claim_metadata(self) -> None:
        password_email = f"schema-password-{uuid4().hex}@example.invalid"
        invite_email = f"schema-invite-{uuid4().hex}@example.invalid"
        invite_hash = f"schema-invite-{uuid4().hex}"
        async with AsyncSessionLocal() as session:
            password_response = await auth_service.register_password_user(
                session,
                email=password_email,
                password="test-password",
            )
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    Invite(
                        community_id=self.community_id,
                        code_hash=invite_hash,
                        email=invite_email,
                        role="member",
                        status="active",
                        expires_at=self.now + timedelta(days=1),
                    ),
                )
        async with AsyncSessionLocal() as session:
            invite_response = await auth_service.register_password_user_with_invite(
                session,
                invite_code_hash=invite_hash,
                email=invite_email,
                password="test-password",
                profile=None,
            )
        async with AsyncSessionLocal() as session:
            password_user = await session.get(AppUser, password_response.user.id)
            invite_user = await session.get(AppUser, invite_response.user.id)
            self.assertEqual(password_user.account_origin, "password_signup")
            self.assertEqual(password_user.claim_state, "claimed")
            self.assertIsNotNone(password_user.claimed_at)
            self.assertEqual(invite_user.account_origin, "invite")
            self.assertEqual(invite_user.claim_state, "claimed")
            self.assertIsNotNone(invite_user.claimed_at)

    async def test_registration_source_channels(self) -> None:
        async with AsyncSessionLocal() as session:
            async with session.begin():
                event = await session.get(Event, self.event_id)
                user = await session.get(AppUser, self.user_id)
                registration = await registration_service._create_registration(
                    session,
                    current_user=user,
                    event=event,
                    occurrence=None,
                    payload=RegisterEventRequest(),
                    prepared_selections=[],
                    reservation_drafts=[],
                    seats_count=1,
                )
                self.assertEqual(registration.source_channel, "mobile")
                for channel in ("mobile", "public_web", "admin"):
                    session.add(
                        EventRegistration(
                            event_id=self.event_id,
                            user_id=self.user_id,
                            source_channel=channel,
                        ),
                    )
                await session.flush()
                await self._assert_rejected(
                    session,
                    EventRegistration(
                        event_id=self.event_id,
                        user_id=self.user_id,
                        source_channel="invalid",
                    ),
                )

    async def test_legal_constraints_and_foreign_keys(self) -> None:
        async with AsyncSessionLocal() as session:
            async with session.begin():
                document = LegalDocument(
                    document_type="privacy_policy",
                    version="test-v1",
                    title="Test policy title",
                    content_hash="test-content-hash",
                    published_url="https://example.invalid/legal/test-v1",
                    effective_at=self.now,
                )
                session.add(document)
                await session.flush()
                registration = EventRegistration(
                    event_id=self.event_id,
                    user_id=self.user_id,
                    source_channel="mobile",
                )
                session.add(registration)
                await session.flush()
                session.add(
                    LegalAcceptance(
                        user_id=self.user_id,
                        registration_id=registration.id,
                        legal_document_id=document.id,
                        accepted_at=self.now,
                        acceptance_method="authenticated_action",
                        source_channel="mobile",
                        evidence_version="test-evidence-v1",
                    ),
                )
                await session.flush()
                invalid_documents = [
                    LegalDocument(
                        document_type="invalid",
                        version="test-invalid-type",
                        title="Title",
                        content_hash="hash",
                        published_url="https://example.invalid/legal/invalid",
                        effective_at=self.now,
                    ),
                    LegalDocument(
                        document_type="privacy_policy",
                        version=" ",
                        title=" ",
                        content_hash=" ",
                        published_url=" ",
                        effective_at=self.now,
                    ),
                    LegalDocument(
                        document_type="marketing_consent",
                        version="test-retired",
                        title="Title",
                        content_hash="hash",
                        published_url="https://example.invalid/legal/retired",
                        effective_at=self.now,
                        retired_at=self.now - timedelta(seconds=1),
                    ),
                ]
                for row in invalid_documents:
                    await self._assert_rejected(session, row)
                await self._assert_rejected(
                    session,
                    LegalDocument(
                        document_type="privacy_policy",
                        version="test-v1",
                        title="Duplicate",
                        content_hash="duplicate-hash",
                        published_url="https://example.invalid/legal/duplicate",
                        effective_at=self.now,
                    ),
                )
                for method, channel in (("invalid", "mobile"), ("authenticated_action", "invalid")):
                    await self._assert_rejected(
                        session,
                        LegalAcceptance(
                            user_id=self.user_id,
                            legal_document_id=document.id,
                            accepted_at=self.now,
                            acceptance_method=method,
                            source_channel=channel,
                            evidence_version="test-evidence",
                        ),
                    )
                await self._assert_rejected(
                    session,
                    LegalAcceptance(
                        user_id=uuid4(),
                        legal_document_id=document.id,
                        accepted_at=self.now,
                        acceptance_method="authenticated_action",
                        source_channel="mobile",
                        evidence_version="test-evidence",
                    ),
                )
                await self._assert_rejected(
                    session,
                    LegalAcceptance(
                        user_id=self.user_id,
                        registration_id=uuid4(),
                        legal_document_id=document.id,
                        accepted_at=self.now,
                        acceptance_method="authenticated_action",
                        source_channel="mobile",
                        evidence_version="test-evidence",
                    ),
                )
                await self._assert_rejected(
                    session,
                    LegalAcceptance(
                        user_id=self.user_id,
                        legal_document_id=uuid4(),
                        accepted_at=self.now,
                        acceptance_method="authenticated_action",
                        source_channel="mobile",
                        evidence_version="test-evidence",
                    ),
                )
                await self._assert_rejected(
                    session,
                    LegalAcceptance(
                        user_id=self.user_id,
                        legal_document_id=document.id,
                        accepted_at=self.now,
                        acceptance_method="authenticated_action",
                        source_channel="mobile",
                        evidence_version=" ",
                    ),
                )

    async def test_database_is_at_alembic_head(self) -> None:
        expected_revision = ScriptDirectory.from_config(
            Config("alembic.ini"),
        ).get_current_head()
        async with AsyncSessionLocal() as session:
            revision = await session.scalar(text("SELECT version_num FROM alembic_version"))
        self.assertEqual(revision, expected_revision)
