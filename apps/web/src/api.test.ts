import { beforeEach, describe, expect, it, vi } from "vitest";
import { getWebEventRegistrationForm, PublicApiError } from "./api";
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
});
