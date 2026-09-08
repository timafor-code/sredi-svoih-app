import { describe, expect, it } from "vitest";

import { buildImportDraftPrefill } from "./ImportReviewPage";
import type { AdminImportReviewItem } from "../types/importReview";

function itemWithTitle(parsedTitle: string): AdminImportReviewItem {
  return {
    id: "import-item-id",
    sourceId: "source-id",
    runId: "run-id",
    externalId: "external-id",
    sourceUrl: "https://example.invalid/event",
    parsedTitle,
    parsedStartsAt: "2026-10-01T16:00:00.000Z",
    parsedLocation: null,
    rawPayload: {},
    status: "new",
    createdAt: "2026-09-08T00:00:00.000Z",
    linkedEventId: null,
    importReview: null,
    adminReview: null,
    sourceName: "Example",
    communityId: "community-id",
  };
}

describe("buildImportDraftPrefill", () => {
  it("makes an inferred Holiday draft canonical", () => {
    const draft = buildImportDraftPrefill(itemWithTitle("Праздник Суккот"));

    expect(draft.event.category).toBe("holiday");
    expect(draft.event.eventKind).toBe("holiday");
  });

  it("makes an inferred Shabbat draft canonical", () => {
    const draft = buildImportDraftPrefill(itemWithTitle("Шабат в общине"));

    expect(draft.event.category).toBe("shabbat");
    expect(draft.event.eventKind).toBe("shabbat");
  });

  it("retains the ordinary event-kind default for ordinary imports", () => {
    const draft = buildImportDraftPrefill(itemWithTitle("Открытая лекция"));

    expect(draft.event.category).toBe("lecture");
    expect(draft.event.eventKind).toBe("single");
  });
});
