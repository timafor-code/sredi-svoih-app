from __future__ import annotations

import unittest
from datetime import date
from uuid import UUID, uuid4

import httpx
from sqlalchemy import delete, select

from app.core.tokens import create_access_token
from app.db.models.core import AppUser, Community, CommunityMembership, Profile
from app.db.session import AsyncSessionLocal, engine
from app.main import app
from app.schemas.current_user_profile import (
    CurrentUserProfileResponse,
    CurrentUserProfileUpdateRequest,
)
from app.services import current_user_profile as current_user_profile_service

_PROFILE_FIELDS = {
    "id",
    "user_id",
    "community_id",
    "display_name",
    "first_name",
    "last_name",
    "full_name",
    "hebrew_name",
    "email",
    "phone",
    "avatar_id",
    "avatar_url",
    "birth_date",
    "hebrew_birth_date",
    "birth_time_context",
    "nusach",
    "city",
    "tribe_status",
    "marital_status",
    "about",
    "profile_visibility",
    "birthday_visibility",
    "phone_visibility",
    "notification_preferences",
    "onboarding_completed",
    "created_at",
    "updated_at",
}


class CurrentUserProfileTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.community_id = uuid4()
        self.actor_id = uuid4()
        self.other_user_id = uuid4()
        self.actor_profile_id = uuid4()
        self.other_profile_id = uuid4()
        self.extra_user_ids: list[UUID] = []
        self.login_email = "login-owner@example.invalid"
        self.login_phone = "+70000000001"
        self.actor_token = create_access_token(self.actor_id)

        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add_all(
                    [
                        Community(
                            id=self.community_id,
                            name="Current profile test community",
                            city="Moscow",
                            slug=f"profile-{self.community_id.hex[:20]}",
                        ),
                        AppUser(
                            id=self.actor_id,
                            email=self.login_email,
                            phone=self.login_phone,
                            password_hash="not-a-public-value",
                            status="active",
                        ),
                        Profile(
                            id=self.actor_profile_id,
                            user_id=self.actor_id,
                            community_id=self.community_id,
                            display_name="Original display",
                            first_name="Original",
                            last_name="Member",
                            full_name="Original Member",
                            hebrew_name="Original Hebrew",
                            email="contact-owner@example.invalid",
                            phone="+70000000002",
                            birth_date=date(1990, 1, 2),
                            hebrew_birth_date={"day": 7, "month": "Nisan"},
                            birth_time_context="unknown",
                            nusach="ashkenaz",
                            city="Moscow",
                            tribe_status="israel",
                            marital_status="single",
                            about="Original about",
                            profile_visibility="members",
                            birthday_visibility="members",
                            phone_visibility="rabbi_only",
                            notification_preferences={"event_reminders": False},
                            onboarding_completed=False,
                        ),
                        AppUser(
                            id=self.other_user_id,
                            email="other-login@example.invalid",
                            phone="+70000000003",
                            password_hash="other-not-a-public-value",
                            status="active",
                        ),
                        Profile(
                            id=self.other_profile_id,
                            user_id=self.other_user_id,
                            community_id=self.community_id,
                            display_name="Other user display",
                            email="other-contact@example.invalid",
                            phone="+70000000004",
                        ),
                    ],
                )

    async def asyncTearDown(self) -> None:
        try:
            async with AsyncSessionLocal() as session:
                async with session.begin():
                    await session.execute(
                        delete(AppUser).where(
                            AppUser.id.in_(
                                [
                                    self.actor_id,
                                    self.other_user_id,
                                    *self.extra_user_ids,
                                ],
                            ),
                        ),
                    )
                    await session.execute(
                        delete(Community).where(Community.id == self.community_id),
                    )
        finally:
            await engine.dispose()

    async def test_unauthenticated_patch_returns_401(self) -> None:
        response = await self._request("PATCH", "/me/profile", json={"city": "Kazan"})

        self.assertEqual(response.status_code, 401)
        body = response.json()
        self.assertIsNone(body["data"])
        self.assertEqual(body["error"]["code"], "unauthenticated")

    async def test_authenticated_user_updates_only_their_profile_without_membership(self) -> None:
        async with AsyncSessionLocal() as session:
            membership = await session.scalar(
                select(CommunityMembership.id).where(
                    CommunityMembership.user_id == self.actor_id,
                ),
            )
        self.assertIsNone(membership)

        response = await self._patch(
            {
                "display_name": "  Updated display  ",
                "city": "Kazan",
                "birth_time_context": "after_sunset",
                "tribe_status": "levi",
                "marital_status": "married",
                "notification_preferences": {"event_reminders": True},
                "onboarding_completed": True,
            },
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIsNone(body["error"])
        self.assertEqual(set(body["data"]), _PROFILE_FIELDS)
        self.assertEqual(body["data"]["user_id"], str(self.actor_id))
        self.assertEqual(body["data"]["display_name"], "Updated display")
        self.assertEqual(body["data"]["city"], "Kazan")
        self.assertEqual(body["data"]["birth_time_context"], "after_sunset")
        self.assertEqual(body["data"]["notification_preferences"], {"event_reminders": True})
        self.assertTrue(body["data"]["onboarding_completed"])

        async with AsyncSessionLocal() as session:
            profile = await session.get(Profile, self.actor_profile_id)
        assert profile is not None
        self.assertEqual(profile.display_name, "Updated display")
        self.assertEqual(profile.city, "Kazan")

    async def test_auth_me_returns_the_same_complete_profile_shape(self) -> None:
        patch_response = await self._patch({"city": "Saint Petersburg"})
        self.assertEqual(patch_response.status_code, 200)

        response = await self._request("GET", "/auth/me", authenticated=True)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(set(body), {"user", "profile", "memberships"})
        self.assertIsNotNone(body["profile"])
        self.assertEqual(set(body["profile"]), _PROFILE_FIELDS)
        self.assertEqual(body["profile"], patch_response.json()["data"])

    async def test_omitted_fields_remain_unchanged(self) -> None:
        response = await self._patch({"display_name": "Replacement"})
        self.assertEqual(response.status_code, 200)

        data = response.json()["data"]
        self.assertEqual(data["display_name"], "Replacement")
        self.assertEqual(data["city"], "Moscow")
        self.assertEqual(data["birth_date"], "1990-01-02")
        self.assertEqual(data["notification_preferences"], {"event_reminders": False})

    async def test_nullable_fields_can_be_cleared(self) -> None:
        response = await self._patch(
            {
                "hebrew_name": None,
                "birth_date": None,
                "hebrew_birth_date": None,
                "nusach": None,
                "about": None,
            },
        )

        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        for field_name in (
            "hebrew_name",
            "birth_date",
            "hebrew_birth_date",
            "nusach",
            "about",
        ):
            self.assertIsNone(data[field_name])

    async def test_empty_payload_unknown_and_protected_fields_are_rejected(self) -> None:
        protected_payloads = [
            {"user_id": str(uuid4())},
            {"community_id": str(uuid4())},
            {"avatar_id": str(uuid4())},
            {"password_hash": "attempted-write"},
        ]
        for payload in ({}, {"unexpected": "value"}, *protected_payloads):
            response = await self._patch(payload)
            self.assertEqual(response.status_code, 422)
            self.assertEqual(response.json()["error"]["code"], "validation_error")

    async def test_existing_profile_is_required(self) -> None:
        missing_profile_user_id = uuid4()
        self.extra_user_ids.append(missing_profile_user_id)
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(AppUser(id=missing_profile_user_id, status="active"))

        response = await self._request(
            "PATCH",
            "/me/profile",
            json={"city": "Kazan"},
            authenticated=True,
            token=create_access_token(missing_profile_user_id),
        )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["error"]["code"], "not_found")

    async def test_invalid_enums_and_text_limits_are_rejected(self) -> None:
        invalid_payloads = [
            {"tribe_status": "invalid"},
            {"profile_visibility": "private"},
            {"birth_time_context": None},
            {"hebrew_birth_date": []},
            {"notification_preferences": []},
            {"notification_preferences": None},
            {"display_name": "x" * 241},
            {"full_name": "x" * 241},
            {"hebrew_name": "x" * 241},
            {"first_name": "x" * 121},
            {"last_name": "x" * 121},
            {"email": "x" * 321},
            {"phone": "x" * 33},
            {"city": "x" * 121},
            {"nusach": "x" * 65},
            {"about": "x" * 201},
        ]
        for payload in invalid_payloads:
            response = await self._patch(payload)
            self.assertEqual(response.status_code, 422)
            self.assertEqual(response.json()["error"]["code"], "validation_error")

    async def test_profile_contact_updates_do_not_change_login_credentials(self) -> None:
        response = await self._patch(
            {
                "email": "  CONTACT-UPDATED@EXAMPLE.INVALID ",
                "phone": "  +70000000009  ",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["email"], "contact-updated@example.invalid")
        self.assertEqual(response.json()["data"]["phone"], "+70000000009")

        async with AsyncSessionLocal() as session:
            user = await session.get(AppUser, self.actor_id)
            profile = await session.get(Profile, self.actor_profile_id)
        assert user is not None
        assert profile is not None
        self.assertEqual(user.email, self.login_email)
        self.assertEqual(user.phone, self.login_phone)
        self.assertEqual(profile.email, "contact-updated@example.invalid")
        self.assertEqual(profile.phone, "+70000000009")

    async def test_another_users_profile_is_not_modified(self) -> None:
        response = await self._patch({"city": "Samara"})
        self.assertEqual(response.status_code, 200)

        async with AsyncSessionLocal() as session:
            actor_profile = await session.get(Profile, self.actor_profile_id)
            other_profile = await session.get(Profile, self.other_profile_id)
        assert actor_profile is not None
        assert other_profile is not None
        self.assertEqual(actor_profile.city, "Samara")
        self.assertEqual(other_profile.display_name, "Other user display")
        self.assertEqual(other_profile.email, "other-contact@example.invalid")
        self.assertEqual(other_profile.phone, "+70000000004")

    async def test_public_profile_contract_and_service_logs_exclude_sensitive_data(self) -> None:
        self.assertEqual(set(CurrentUserProfileResponse.model_fields), _PROFILE_FIELDS)
        self.assertFalse(
            {"password_hash", "auth_sessions", "access_token", "refresh_token"}
            & set(CurrentUserProfileResponse.model_fields),
        )

        with self.assertNoLogs("app.services.current_user_profile", level="DEBUG"):
            async with AsyncSessionLocal() as session:
                actor = await session.get(AppUser, self.actor_id)
                assert actor is not None
                await current_user_profile_service.update_current_user_profile(
                    session,
                    actor,
                    CurrentUserProfileUpdateRequest(
                        email="profile-private@example.invalid",
                        phone="+70000000008",
                    ),
                )

        response = await self._request("GET", "/auth/me", authenticated=True)
        self.assertEqual(response.status_code, 200)
        body_text = response.text
        self.assertNotIn("not-a-public-value", body_text)
        self.assertNotIn("other-login@example.invalid", body_text)
        self.assertNotIn(self.actor_token, body_text)

    def test_route_is_authenticated_and_exposes_only_patch(self) -> None:
        operations = app.openapi()["paths"]["/me/profile"]
        self.assertEqual(set(operations), {"patch"})
        self.assertIn("security", operations["patch"])

    async def _patch(self, payload: dict[str, object]) -> httpx.Response:
        return await self._request(
            "PATCH",
            "/me/profile",
            json=payload,
            authenticated=True,
        )

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, object] | None = None,
        authenticated: bool = False,
        token: str | None = None,
    ) -> httpx.Response:
        headers = (
            {"Authorization": f"Bearer {token or self.actor_token}"}
            if authenticated
            else None
        )
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            return await client.request(method, path, json=json, headers=headers)


if __name__ == "__main__":
    unittest.main()
