import { describe, expect, it } from "vitest";

import { ApiClientError } from "../../services/apiClient";
import type { ParticipationOption } from "../../types/participationOptions";
import {
  buildAdminRegistrationRequest,
  mapAddParticipantError,
  refreshAfterRegistrationSaved,
  resolveRegistrationSeats,
} from "./AddParticipantDialog";

const selectedParticipant = {
  id: "participant-1",
  displayName: "Анна Тестова",
  phone: "+79990000001",
  email: "anna@example.invalid",
};

const capacityOption = (id: string) => ({
  id,
  isDonation: false,
  countsTowardCapacity: true,
}) as ParticipationOption;

const nonCapacityOption = (id: string, isDonation = false) => ({
  id,
  isDonation,
  countsTowardCapacity: false,
}) as ParticipationOption;

describe("AddParticipantDialog request helpers", () => {
  it("keeps several participation options in one existing-participant request", () => {
    expect(buildAdminRegistrationRequest({
      comment: "  ",
      email: "",
      fullName: "",
      mode: "existing",
      occurrenceId: "occurrence-1",
      optionSelections: { "option-friday": 1, "option-saturday": 2 },
      participant: selectedParticipant,
      phone: "",
      seatsCount: 3,
    })).toEqual({
      participant: { mode: "existing", userId: "participant-1" },
      occurrenceId: "occurrence-1",
      optionSelections: [
        { optionId: "option-friday", quantity: 1 },
        { optionId: "option-saturday", quantity: 2 },
      ],
      seatsCount: 3,
      guestNames: [],
      comment: null,
    });
  });

  it("builds a trimmed new-participant request without privileged fields", () => {
    expect(buildAdminRegistrationRequest({
      comment: "Комментарий",
      email: " anna@example.invalid ",
      fullName: "  Анна Тестова  ",
      mode: "new",
      occurrenceId: null,
      optionSelections: { option: 4 },
      participant: null,
      phone: " +7 999 000 00 01 ",
      seatsCount: 1,
    })).toEqual({
      participant: {
        mode: "new",
        fullName: "Анна Тестова",
        phone: "+7 999 000 00 01",
        email: "anna@example.invalid",
      },
      occurrenceId: null,
      optionSelections: [{ optionId: "option", quantity: 4 }],
      seatsCount: 1,
      guestNames: [],
      comment: "Комментарий",
    });
  });

  it("requires an explicit existing selection and new name/phone", () => {
    expect(buildAdminRegistrationRequest({
      comment: "",
      email: "",
      fullName: "",
      mode: "existing",
      occurrenceId: null,
      optionSelections: {},
      participant: null,
      phone: "",
      seatsCount: 1,
    })).toBeNull();
    expect(buildAdminRegistrationRequest({
      comment: "",
      email: "",
      fullName: "Анна",
      mode: "new",
      occurrenceId: null,
      optionSelections: {},
      participant: null,
      phone: "",
      seatsCount: 1,
    })).toBeNull();
  });

  it("maps identity, validation, capacity, and retryable errors to safe Russian copy", () => {
    const error = (code: string, status = 409) => new ApiClientError({
      error: { code, message: "internal" },
      status,
    });
    expect(mapAddParticipantError(error("admin_participant_phone_exists"))).toContain("телефон");
    expect(mapAddParticipantError(error("admin_participant_email_exists"))).toContain("email");
    expect(mapAddParticipantError(error("admin_participant_identity_conflict"))).toContain("разным профилям");
    expect(mapAddParticipantError(error("capacity_unavailable"))).toContain("свободных мест");
    expect(mapAddParticipantError(error("already_registered"))).toContain("активная регистрация");
    expect(mapAddParticipantError(error("validation_error", 422))).toContain("варианты участия");
    expect(mapAddParticipantError(error("network_error", 0))).toContain("временно недоступен");
  });

  it("uses option-derived seats for free and paid registrations", () => {
    const selected = { friday: 1, saturday: 2 };
    const freeEventSeats = resolveRegistrationSeats(
      [capacityOption("friday"), capacityOption("saturday")],
      selected,
      1,
    );
    const paidEventSeats = resolveRegistrationSeats(
      [capacityOption("friday"), capacityOption("saturday")],
      selected,
      1,
    );
    expect(freeEventSeats).toEqual({ seatsCount: 3, optionSeatsCount: 3, usesOptionSeats: true });
    expect(paidEventSeats).toEqual(freeEventSeats);
  });

  it("falls back to manual seats when selected options do not consume capacity", () => {
    expect(resolveRegistrationSeats(
      [nonCapacityOption("donation", true), nonCapacityOption("online")],
      { donation: 2, online: 4 },
      3,
    )).toEqual({ seatsCount: 3, optionSeatsCount: 0, usesOptionSeats: false });
  });

  it("reports a post-save refresh failure without turning it into a submit failure", async () => {
    let refreshFailureCount = 0;
    await expect(refreshAfterRegistrationSaved(
      async () => { throw new Error("refresh failed"); },
      () => { refreshFailureCount += 1; },
    )).resolves.toBeUndefined();
    expect(refreshFailureCount).toBe(1);
  });
});
