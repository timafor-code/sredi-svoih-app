import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  confirmSetPassword,
  confirmWebRegistrationEmail,
  createWebRegistrationIntent,
  getWebEventRegistrationForm,
  getWebRegistrationIntentStatus,
  isSafePublicUrl,
  PublicApiError,
  requestSetPassword,
  resendWebRegistrationCode,
} from "./api";
import {
  EVENT_ID,
  OCCURRENCE_ONE_ID,
  eventResponse,
  responseWithOccurrences,
  responseWithQuestionnaire,
} from "./test/fixtures";

function fetchResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response);
}

const FLOW_ID = "opaque-flow-credential";
const REGISTRATION_ID = "77777777-7777-4777-8777-777777777777";
const EXPIRES_AT = "2026-09-12T18:00:00+03:00";
const UUID_REFERENCE = { kind: "uuid", value: EVENT_ID } as const;
const SLUG_REFERENCE = { kind: "slug", value: "shabbat-dlya-druzey" } as const;

function envelope<T>(data: T) {
  return { data, error: null, meta: {} };
}

describe("public event API", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));

  it("uses the public GET contract without credentials", async () => {
    vi.mocked(fetch).mockImplementation(() => fetchResponse({ data: eventResponse(), error: null, meta: {} }));
    await getWebEventRegistrationForm(UUID_REFERENCE);
    expect(fetch).toHaveBeenCalledWith(
      `/api/events/${EVENT_ID}/registration-form?channel=web`,
      expect.objectContaining({
        method: "GET",
        credentials: "omit",
        headers: { Accept: "application/json" },
      }),
    );
  });

  it("uses the slug endpoint without credentials", async () => {
    vi.mocked(fetch).mockImplementation(() => fetchResponse(envelope(eventResponse())));
    await getWebEventRegistrationForm(SLUG_REFERENCE);
    expect(fetch).toHaveBeenCalledWith(
      "/api/web/events/shabbat-dlya-druzey/registration-form",
      expect.objectContaining({ method: "GET", credentials: "omit" }),
    );
  });

  it("parses the current internal_free registration contract", async () => {
    const data = eventResponse();
    vi.mocked(fetch).mockImplementation(() => fetchResponse(envelope(data)));
    await expect(getWebEventRegistrationForm(SLUG_REFERENCE)).resolves.toEqual(data);
  });

  it("recognizes internal_paid as a contract value without activating the route", async () => {
    const data = eventResponse();
    data.event.registration_mode = "internal_paid";
    vi.mocked(fetch).mockImplementation(() => fetchResponse(envelope(data)));
    await expect(getWebEventRegistrationForm(SLUG_REFERENCE)).resolves.toEqual(data);
  });

  it.each([undefined, "external_link", "internal_FREE", null])(
    "rejects unsupported registration_mode=%o",
    async (registrationMode) => {
      const data = eventResponse() as unknown as { event: Record<string, unknown> };
      if (registrationMode === undefined) {
        delete data.event.registration_mode;
      } else {
        data.event.registration_mode = registrationMode;
      }
      vi.mocked(fetch).mockImplementation(() => fetchResponse(envelope(data)));
      await expect(getWebEventRegistrationForm(SLUG_REFERENCE)).rejects.toBeInstanceOf(PublicApiError);
    },
  );

  it.each([undefined, null, 0, "false"])(
    "rejects malformed option is_donation=%o",
    async (isDonation) => {
      const data = eventResponse() as unknown as {
        participation_options: Array<Record<string, unknown>>;
      };
      if (isDonation === undefined) {
        delete data.participation_options[0].is_donation;
      } else {
        data.participation_options[0].is_donation = isDonation;
      }
      vi.mocked(fetch).mockImplementation(() => fetchResponse(envelope(data)));
      await expect(getWebEventRegistrationForm(SLUG_REFERENCE)).rejects.toBeInstanceOf(PublicApiError);
    },
  );

  it("rejects incomplete response JSON", async () => {
    vi.mocked(fetch).mockImplementation(() => fetchResponse({ data: { event: { id: EVENT_ID } } }));
    await expect(getWebEventRegistrationForm(UUID_REFERENCE)).rejects.toBeInstanceOf(PublicApiError);
  });

  it("rejects a valid data object without the complete API envelope", async () => {
    vi.mocked(fetch).mockImplementation(() => fetchResponse({ data: eventResponse() }));
    await expect(getWebEventRegistrationForm(UUID_REFERENCE)).rejects.toBeInstanceOf(PublicApiError);
  });

  it("rejects response data belonging to a different event", async () => {
    const data = eventResponse();
    data.event.id = "77777777-7777-4777-8777-777777777777";
    vi.mocked(fetch).mockImplementation(() => fetchResponse({ data, error: null, meta: {} }));
    await expect(getWebEventRegistrationForm(UUID_REFERENCE)).rejects.toBeInstanceOf(PublicApiError);
  });

  it.each([
    ["unknown type", (data: ReturnType<typeof responseWithQuestionnaire>) => { data.questions[0].field_type = "date" as never; }],
    ["duplicate field id", (data: ReturnType<typeof responseWithQuestionnaire>) => { data.questions[1].id = data.questions[0].id; }],
    ["duplicate field key", (data: ReturnType<typeof responseWithQuestionnaire>) => { data.questions[1].field_key = data.questions[0].field_key; }],
    ["invalid option", (data: ReturnType<typeof responseWithQuestionnaire>) => { data.questions[2].options[0] = { value: "bad value", label: "Bad" }; }],
    ["duplicate option", (data: ReturnType<typeof responseWithQuestionnaire>) => { data.questions[2].options[1].value = data.questions[2].options[0].value; }],
    ["text options", (data: ReturnType<typeof responseWithQuestionnaire>) => { data.questions[0].options = [{ value: "x", label: "X" }]; }],
    ["missing select options", (data: ReturnType<typeof responseWithQuestionnaire>) => { data.questions[2].options = []; }],
    ["unsupported validation", (data: ReturnType<typeof responseWithQuestionnaire>) => { data.questions[0].validation = { pattern: 1 }; }],
    ["inverted validation", (data: ReturnType<typeof responseWithQuestionnaire>) => { data.questions[0].validation = { min_length: 5, max_length: 2 }; }],
    ["invalid retention", (data: ReturnType<typeof responseWithQuestionnaire>) => { data.questions[0].retention_days = 0; }],
    ["malformed form id", (data: ReturnType<typeof responseWithQuestionnaire>) => { data.questionnaire_form_id = "not-a-uuid"; }],
    ["null form with questions", (data: ReturnType<typeof responseWithQuestionnaire>) => { data.questionnaire_form_id = null; }],
    ["form without questions", (data: ReturnType<typeof responseWithQuestionnaire>) => { data.questions = []; }],
  ])("rejects malformed questionnaire response: %s", async (_name, mutate) => {
    const data = responseWithQuestionnaire();
    mutate(data);
    vi.mocked(fetch).mockImplementation(() => fetchResponse(envelope(data)));
    await expect(getWebEventRegistrationForm(UUID_REFERENCE)).rejects.toBeInstanceOf(PublicApiError);
  });

  it.each([
    "https://example.invalid/consent",
    "http://localhost:5174/consent",
    "http://127.0.0.1:5174/consent",
    "http://[::1]:5174/consent",
  ])("accepts safe public URL %s", (value) => {
    expect(isSafePublicUrl(value)).toBe(true);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<h1>unsafe</h1>",
    "file:///tmp/consent.html",
    "blob:https://example.invalid/id",
    "mailto:person@example.invalid",
    "ftp://example.invalid/consent",
    "https://user:password@example.invalid/consent",
    "not a URL",
  ])("rejects unsafe public URL %s", (value) => {
    expect(isSafePublicUrl(value)).toBe(false);
  });

  it.each([
    "https://example.invalid/consent",
    "http://localhost:5174/consent",
    "http://127.0.0.1:5174/consent",
  ])("accepts a response with safe consent URL %s", async (publishedUrl) => {
    const data = eventResponse();
    const consent = data.legal_documents.find((document) => document.document_type === "event_registration_consent");
    if (!consent) throw new Error("Missing consent fixture");
    consent.published_url = publishedUrl;
    vi.mocked(fetch).mockImplementation(() => fetchResponse({ data, error: null, meta: {} }));
    await expect(getWebEventRegistrationForm(UUID_REFERENCE)).resolves.toEqual(data);
  });

  it("rejects a response with an unsafe consent URL", async () => {
    const data = eventResponse();
    const consent = data.legal_documents.find((document) => document.document_type === "event_registration_consent");
    if (!consent) throw new Error("Missing consent fixture");
    consent.published_url = "javascript:alert(1)";
    vi.mocked(fetch).mockImplementation(() => fetchResponse({ data, error: null, meta: {} }));
    await expect(getWebEventRegistrationForm(UUID_REFERENCE)).rejects.toBeInstanceOf(PublicApiError);
  });

  it("rejects a response with an unsafe privacy URL", async () => {
    const data = eventResponse();
    const privacy = data.legal_documents.find((document) => document.document_type === "privacy_policy");
    if (!privacy) throw new Error("Missing privacy fixture");
    privacy.published_url = "data:text/html,unsafe";
    vi.mocked(fetch).mockImplementation(() => fetchResponse({ data, error: null, meta: {} }));
    await expect(getWebEventRegistrationForm(UUID_REFERENCE)).rejects.toBeInstanceOf(PublicApiError);
  });

  it("normalizes an unsafe optional image URL to null", async () => {
    const data = eventResponse();
    data.event.image_url = "file:///tmp/event.jpg";
    vi.mocked(fetch).mockImplementation(() => fetchResponse({ data, error: null, meta: {} }));
    await expect(getWebEventRegistrationForm(UUID_REFERENCE)).resolves.toMatchObject({
      event: { image_url: null },
    });
  });

  it.each([
    "https://example.invalid/events/shabbat",
    "//example.invalid/events/shabbat",
    "/events/shabbat?source=invite",
    "/events/shabbat#details",
    "/events/shabbat/extra",
    "/events/Shabbat",
    "/events/shabbat\\extra",
  ])("rejects malformed canonical_public_path %s", async (canonicalPath) => {
    const data = eventResponse();
    data.canonical_public_path = canonicalPath;
    vi.mocked(fetch).mockImplementation(() => fetchResponse(envelope(data)));
    await expect(getWebEventRegistrationForm(SLUG_REFERENCE)).rejects.toBeInstanceOf(PublicApiError);
  });

  it.each([null, "false", 0, {}])("strictly rejects resolved_from_alias=%o", async (resolvedFromAlias) => {
    const data = eventResponse() as unknown as Record<string, unknown>;
    data.resolved_from_alias = resolvedFromAlias;
    vi.mocked(fetch).mockImplementation(() => fetchResponse(envelope(data)));
    await expect(getWebEventRegistrationForm(SLUG_REFERENCE)).rejects.toBeInstanceOf(PublicApiError);
  });

  it.each([
    ["missing mode", (data: Record<string, unknown>) => { delete data.occurrence_selection_mode; }],
    ["unknown mode", (data: Record<string, unknown>) => { data.occurrence_selection_mode = "browser_guess"; }],
    ["missing default", (data: Record<string, unknown>) => { delete data.default_occurrence_id; }],
    ["foreign default", (data: Record<string, unknown>) => { data.default_occurrence_id = REGISTRATION_ID; }],
    ["missing state hint", (data: Record<string, unknown>) => { delete data.next_registration_state_check_at; }],
    ["invalid state hint", (data: Record<string, unknown>) => { data.next_registration_state_check_at = "tomorrow"; }],
    ["timezone-less state hint", (data: Record<string, unknown>) => { data.next_registration_state_check_at = "2026-08-11T10:00:00"; }],
    ["none with multiple occurrences", (data: Record<string, unknown>) => { data.occurrence_selection_mode = "none"; }],
    ["user selection with a default", (data: Record<string, unknown>) => { data.default_occurrence_id = OCCURRENCE_ONE_ID; }],
    ["nearest occurrences without a default", (data: Record<string, unknown>) => { data.occurrence_selection_mode = "nearest"; }],
  ])("rejects an invalid occurrence selection contract: %s", async (_name, mutate) => {
    const data = responseWithOccurrences();
    mutate(data as unknown as Record<string, unknown>);
    vi.mocked(fetch).mockImplementation(() => fetchResponse(envelope(data)));
    await expect(getWebEventRegistrationForm(SLUG_REFERENCE)).rejects.toBeInstanceOf(PublicApiError);
  });

  it("accepts fail-closed nearest when no suitable occurrence remains", async () => {
    const data = eventResponse("unavailable");
    data.occurrence_selection_mode = "nearest";
    data.default_occurrence_id = null;
    vi.mocked(fetch).mockImplementation(() => fetchResponse(envelope(data)));
    await expect(getWebEventRegistrationForm(SLUG_REFERENCE)).resolves.toEqual(data);
  });

  it("rejects empty nearest unless registration is unavailable", async () => {
    const data = eventResponse("open");
    data.occurrence_selection_mode = "nearest";
    data.default_occurrence_id = null;
    vi.mocked(fetch).mockImplementation(() => fetchResponse(envelope(data)));
    await expect(getWebEventRegistrationForm(SLUG_REFERENCE)).rejects.toBeInstanceOf(PublicApiError);
  });

  it("validates intent, resend, status, and confirm response envelopes at runtime", async () => {
    vi.mocked(fetch)
      .mockImplementationOnce(() => fetchResponse(envelope({ flow_id: FLOW_ID, next_step: "confirm_email", expires_at: EXPIRES_AT }), 201))
      .mockImplementationOnce(() => fetchResponse(envelope({ next_step: "confirm_email", expires_at: EXPIRES_AT })))
      .mockImplementationOnce(() => fetchResponse(envelope({ state: "email_verification_required", expires_at: EXPIRES_AT, registration: null, account_next_step: null })))
      .mockImplementationOnce(() => fetchResponse(envelope({
        intent_status: "confirmed",
        registration: {
          id: REGISTRATION_ID,
          event_id: EVENT_ID,
          occurrence_id: null,
          status: "confirmed",
          seats_count: 1,
          payment_status: "not_required",
          total_amount: 0,
          total_currency: "RUB",
        },
        account_next_step: "none",
        set_password_code: null,
        set_password_expires_at: null,
      })));

    await expect(createWebRegistrationIntent({
      event_id: EVENT_ID,
      occurrence_id: null,
      first_name: "Анна",
      last_name: "Иванова",
      phone: "+79991234567",
      email: "anna@example.ru",
      seats_count: 1,
      option_selections: [],
      questionnaire_form_id: null,
      answers: [],
      legal_acceptances: [],
      account_choice: "without_password",
      idempotency_key: "opaque-idempotency",
    })).resolves.toMatchObject({ flow_id: FLOW_ID });
    await expect(resendWebRegistrationCode(FLOW_ID)).resolves.toMatchObject({ next_step: "confirm_email" });
    await expect(getWebRegistrationIntentStatus(FLOW_ID)).resolves.toMatchObject({ state: "email_verification_required" });
    await expect(confirmWebRegistrationEmail(FLOW_ID, "123456")).resolves.toMatchObject({ account_next_step: "none" });
  });

  it.each([
    ["missing payment status", (registration: Record<string, unknown>) => { delete registration.payment_status; }],
    ["unknown payment status", (registration: Record<string, unknown>) => { registration.payment_status = "awaiting_payment"; }],
    ["fractional total", (registration: Record<string, unknown>) => { registration.total_amount = 10.5; }],
    ["negative total", (registration: Record<string, unknown>) => { registration.total_amount = -1; }],
    ["amount without currency", (registration: Record<string, unknown>) => { registration.total_currency = null; }],
    ["currency without amount", (registration: Record<string, unknown>) => { registration.total_amount = null; }],
  ])("rejects malformed registration payment result: %s", async (_name, mutate) => {
    const registration: Record<string, unknown> = {
      id: REGISTRATION_ID,
      event_id: EVENT_ID,
      occurrence_id: null,
      status: "pending",
      seats_count: 1,
      payment_status: "pending",
      total_amount: 3000,
      total_currency: "RUB",
    };
    mutate(registration);
    vi.mocked(fetch).mockImplementation(() => fetchResponse(envelope({
      intent_status: "confirmed",
      registration,
      account_next_step: "none",
      set_password_code: null,
      set_password_expires_at: null,
    })));

    await expect(confirmWebRegistrationEmail(FLOW_ID, "123456"))
      .rejects.toMatchObject({ code: "invalid_response" });
  });

  it.each([
    ["intent", () => createWebRegistrationIntent({} as never)],
    ["status", () => getWebRegistrationIntentStatus(FLOW_ID)],
    ["resend", () => resendWebRegistrationCode(FLOW_ID)],
    ["confirm", () => confirmWebRegistrationEmail(FLOW_ID, "123456")],
  ])("rejects malformed successful %s JSON", async (_name, request) => {
    vi.mocked(fetch).mockImplementation(() => fetchResponse(envelope({ unexpected: true })));
    await expect(request()).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("validates direct auth-code responses without credentials", async () => {
    vi.mocked(fetch)
      .mockImplementationOnce(() => fetchResponse({ ok: true }))
      .mockImplementationOnce(() => fetchResponse({ ok: true }));
    await expect(requestSetPassword("person@example.test")).resolves.toEqual({ ok: true });
    await expect(confirmSetPassword("opaque-set-password-code", "password123")).resolves.toEqual({ ok: true });
    expect(vi.mocked(fetch).mock.calls).toEqual([
      ["/api/auth/request-set-password", expect.objectContaining({ method: "POST", credentials: "omit" })],
      ["/api/auth/confirm-set-password", expect.objectContaining({ method: "POST", credentials: "omit" })],
    ]);
  });

  it("rejects malformed auth success and preserves safe error code plus Retry-After", async () => {
    vi.mocked(fetch)
      .mockImplementationOnce(() => fetchResponse({ ok: "yes" }))
      .mockImplementationOnce(() => fetchResponse({ data: null, error: { code: "resend_cooldown", message: "hidden" }, meta: {} }, 429, { "Retry-After": "17" }));
    await expect(requestSetPassword("person@example.test")).rejects.toMatchObject({ code: "invalid_response" });
    await expect(resendWebRegistrationCode(FLOW_ID)).rejects.toMatchObject({ code: "resend_cooldown", retryAfterSeconds: 17 });
  });

  it("rejects a malformed error envelope instead of exposing its message", async () => {
    vi.mocked(fetch).mockImplementation(() => fetchResponse({ message: "sensitive backend detail" }, 409));
    await expect(getWebRegistrationIntentStatus(FLOW_ID)).rejects.toMatchObject({ code: "invalid_response" });
  });
});
