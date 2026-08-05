import { beforeEach, describe, expect, it, vi } from "vitest";
import { getWebEventRegistrationForm, isSafePublicUrl, PublicApiError } from "./api";
import { EVENT_ID, eventResponse } from "./test/fixtures";

function fetchResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response);
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
});
