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
import { EVENT_ID, eventResponse } from "./test/fixtures";

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

function envelope<T>(data: T) {
  return { data, error: null, meta: {} };
}

describe("public event API", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));

  it("uses the public GET contract without credentials", async () => {
    vi.mocked(fetch).mockImplementation(() => fetchResponse({ data: eventResponse(), error: null, meta: {} }));
    await getWebEventRegistrationForm(EVENT_ID);
    expect(fetch).toHaveBeenCalledWith(
      `/api/events/${EVENT_ID}/registration-form?channel=web`,
      expect.objectContaining({
        method: "GET",
        credentials: "omit",
        headers: { Accept: "application/json" },
      }),
    );
  });

  it("rejects incomplete response JSON", async () => {
    vi.mocked(fetch).mockImplementation(() => fetchResponse({ data: { event: { id: EVENT_ID } } }));
    await expect(getWebEventRegistrationForm(EVENT_ID)).rejects.toBeInstanceOf(PublicApiError);
  });

  it("rejects a valid data object without the complete API envelope", async () => {
    vi.mocked(fetch).mockImplementation(() => fetchResponse({ data: eventResponse() }));
    await expect(getWebEventRegistrationForm(EVENT_ID)).rejects.toBeInstanceOf(PublicApiError);
  });

  it("rejects response data belonging to a different event", async () => {
    const data = eventResponse();
    data.event.id = "77777777-7777-4777-8777-777777777777";
    vi.mocked(fetch).mockImplementation(() => fetchResponse({ data, error: null, meta: {} }));
    await expect(getWebEventRegistrationForm(EVENT_ID)).rejects.toBeInstanceOf(PublicApiError);
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
    await expect(getWebEventRegistrationForm(EVENT_ID)).resolves.toEqual(data);
  });

  it("rejects a response with an unsafe consent URL", async () => {
    const data = eventResponse();
    const consent = data.legal_documents.find((document) => document.document_type === "event_registration_consent");
    if (!consent) throw new Error("Missing consent fixture");
    consent.published_url = "javascript:alert(1)";
    vi.mocked(fetch).mockImplementation(() => fetchResponse({ data, error: null, meta: {} }));
    await expect(getWebEventRegistrationForm(EVENT_ID)).rejects.toBeInstanceOf(PublicApiError);
  });

  it("rejects a response with an unsafe privacy URL", async () => {
    const data = eventResponse();
    const privacy = data.legal_documents.find((document) => document.document_type === "privacy_policy");
    if (!privacy) throw new Error("Missing privacy fixture");
    privacy.published_url = "data:text/html,unsafe";
    vi.mocked(fetch).mockImplementation(() => fetchResponse({ data, error: null, meta: {} }));
    await expect(getWebEventRegistrationForm(EVENT_ID)).rejects.toBeInstanceOf(PublicApiError);
  });

  it("normalizes an unsafe optional image URL to null", async () => {
    const data = eventResponse();
    data.event.image_url = "file:///tmp/event.jpg";
    vi.mocked(fetch).mockImplementation(() => fetchResponse({ data, error: null, meta: {} }));
    await expect(getWebEventRegistrationForm(EVENT_ID)).resolves.toMatchObject({
      event: { image_url: null },
    });
  });

  it("validates intent, resend, status, and confirm response envelopes at runtime", async () => {
    vi.mocked(fetch)
      .mockImplementationOnce(() => fetchResponse(envelope({ flow_id: FLOW_ID, next_step: "confirm_email", expires_at: EXPIRES_AT }), 201))
      .mockImplementationOnce(() => fetchResponse(envelope({ next_step: "confirm_email", expires_at: EXPIRES_AT })))
      .mockImplementationOnce(() => fetchResponse(envelope({ state: "email_verification_required", expires_at: EXPIRES_AT, registration: null, account_next_step: null })))
      .mockImplementationOnce(() => fetchResponse(envelope({
        intent_status: "confirmed",
        registration: { id: REGISTRATION_ID, event_id: EVENT_ID, occurrence_id: null, status: "confirmed", seats_count: 1 },
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
