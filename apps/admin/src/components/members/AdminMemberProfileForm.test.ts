import { describe, expect, it } from "vitest";

import { ApiClientError } from "../../services/apiClient";
import type { AdminMemberProfile } from "../../types/members";
import {
  buildAdminMemberProfileUpdateFields,
  createAdminMemberProfileDraft,
  mapAdminMemberProfileUpdateError,
} from "./AdminMemberProfileForm";

function memberProfile(): AdminMemberProfile {
  return {
    about: null,
    accountEmail: "canonical@example.invalid",
    accountPhone: "+79995550120",
    avatarUrl: null,
    birthDate: null,
    birthTimeContext: "unknown",
    birthdayVisibility: "members",
    city: "Moscow",
    communityId: "community-id",
    displayName: "Synthetic Member",
    email: "stale@example.invalid",
    firstName: "Synthetic",
    fullName: "Synthetic Member",
    hebrewBirthDate: null,
    hebrewName: null,
    invitedBy: null,
    joinedAt: null,
    lastName: "Member",
    lastRegistrationAt: null,
    maritalStatus: null,
    membershipCommunityId: "community-id",
    membershipCreatedAt: null,
    membershipId: "membership-id",
    membershipRole: "member",
    membershipStatus: "active",
    notificationPreferences: {},
    nusach: null,
    onboardingCompleted: false,
    phone: "+79995550121",
    phoneVisibility: "rabbi_only",
    profileCommunityId: null,
    profileCreatedAt: null,
    profileUpdatedAt: null,
    profileVisibility: "members",
    registrationsCancelled: 0,
    registrationsPast: 0,
    registrationsTotal: 0,
    registrationsUpcoming: 0,
    tribeStatus: null,
    userId: "user-id",
  };
}

describe("AdminMemberProfileForm identity helpers", () => {
  it("uses canonical account identifiers as the full-detail draft baseline", () => {
    const profile = memberProfile();

    const draft = createAdminMemberProfileDraft(profile, profile);

    expect(draft.email).toBe("canonical@example.invalid");
    expect(draft.phone).toBe("+79995550120");
  });

  it("does not emit stale profile identity when only another field changes", () => {
    const profile = memberProfile();
    const draft = { ...createAdminMemberProfileDraft(profile, profile), city: "Kazan" };

    const result = buildAdminMemberProfileUpdateFields(profile, draft);

    expect(result).toEqual({ fields: { city: "Kazan" }, ok: true });
  });

  it("does not fall back to stale profile identity when canonical detail is empty", () => {
    const profile = {
      ...memberProfile(),
      accountEmail: null,
      accountPhone: null,
    };
    const draft = createAdminMemberProfileDraft(profile, profile);

    expect(draft.email).toBe("");
    expect(draft.phone).toBe("");
    expect(
      buildAdminMemberProfileUpdateFields(profile, { ...draft, city: "Kazan" }),
    ).toEqual({ fields: { city: "Kazan" }, ok: true });
  });

  it("emits real canonical email and phone edits", () => {
    const profile = memberProfile();
    const draft = {
      ...createAdminMemberProfileDraft(profile, profile),
      email: "new@example.invalid",
      phone: "+79995550122",
    };

    const result = buildAdminMemberProfileUpdateFields(profile, draft);

    expect(result).toEqual({
      fields: {
        email: "new@example.invalid",
        phone: "+79995550122",
      },
      ok: true,
    });
  });

  it("blocks unsupported clearing of populated canonical identity", () => {
    const profile = memberProfile();
    const draft = { ...createAdminMemberProfileDraft(profile, profile), email: "" };

    const result = buildAdminMemberProfileUpdateFields(profile, draft);

    expect(result).toEqual({
      error: "Удаление email аккаунта через эту форму пока не поддерживается.",
      ok: false,
    });
  });

  it("maps known identity conflicts to safe Russian copy", () => {
    const error = (code: string) =>
      new ApiClientError({
        error: { code, message: "untrusted backend text" },
        status: 409,
      });

    expect(mapAdminMemberProfileUpdateError(error("admin_member_email_exists"))).toBe(
      "Этот email уже используется другим аккаунтом и не может быть назначен этому участнику.",
    );
    expect(mapAdminMemberProfileUpdateError(error("admin_member_phone_exists"))).toBe(
      "Этот телефон уже используется другим аккаунтом и не может быть назначен этому участнику.",
    );
  });
});
