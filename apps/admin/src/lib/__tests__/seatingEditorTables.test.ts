import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "../../services/apiClient";
import {
  getSeatingLayout,
  saveSeatingLayout,
} from "../../services/adminSeatingApiService";
import {
  createEditorTable,
  normalizeEditorTables,
} from "../seatingEditorTables";
import type { SeatingTable } from "../../types/seating";

vi.mock("../../services/apiClient", () => ({
  apiClient: {
    get: vi.fn(),
    patch: vi.fn(),
  },
}));

const mockedApiClient = vi.mocked(apiClient);

function table(overrides: Partial<SeatingTable> = {}): SeatingTable {
  return {
    angle: 0,
    cx: 200,
    cy: 200,
    h: 80,
    id: "table-1",
    isRabbiTable: false,
    sideSeats: 3,
    w: 180,
    ...overrides,
  };
}

describe("seating editor tables", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps disabled seats", () => {
    expect(normalizeEditorTables([table({ disabledSeats: ["end:b"] })])[0].disabledSeats)
      .toEqual(["end:b"]);
  });

  it("drops unknown parts, dedupes, and sorts disabled seats", () => {
    expect(normalizeEditorTables([table({
      disabledSeats: ["side:b:1", "unknown", "end:a", "side:b:1", "bad:1"],
    })])[0].disabledSeats).toEqual(["end:a", "side:b:1"]);
  });

  it("keeps disabled parts outside the current side-seat range", () => {
    expect(normalizeEditorTables([table({
      disabledSeats: ["side:a:2"],
      sideSeats: 2,
    })])[0].disabledSeats).toEqual(["side:a:2"]);
  });

  it("uses an empty disabled-seat list when the field is absent", () => {
    expect(normalizeEditorTables([table()])[0].disabledSeats).toEqual([]);
  });

  it("keeps exactly one rabbi table", () => {
    const tables = normalizeEditorTables([
      table({ id: "table-1", isRabbiTable: true }),
      table({ id: "table-2", isRabbiTable: true }),
    ]);

    expect(tables.filter((item) => item.isRabbiTable)).toHaveLength(1);
  });

  it("creates tables with normalized disabled seats", () => {
    expect(createEditorTable({
      disabledSeats: ["side:a:2", "end:a", "side:a:2", "unknown"],
    }).disabledSeats).toEqual(["end:a", "side:a:2"]);
  });

  it("preserves disabled seats through editor, save payload, API row, and editor", async () => {
    const original = normalizeEditorTables([table({
      disabledSeats: ["side:a:2", "end:b"],
      sideSeats: 2,
    })]);
    mockedApiClient.patch.mockResolvedValue({
      capacity_unit_id: "unit-1",
      community_id: "community-1",
      created_at: "2026-09-23T00:00:00Z",
      event_id: "event-1",
      id: "layout-1",
      occurrence_id: null,
      seating_done: false,
      updated_at: "2026-09-23T00:00:00Z",
    });

    await saveSeatingLayout({
      capacityUnitId: "unit-1",
      customTables: original,
      eventId: "event-1",
      occurrenceId: null,
    });

    const payload = mockedApiClient.patch.mock.calls[0][1] as {
      customTables: SeatingTable[];
    };
    const savedTable = payload.customTables[0];
    mockedApiClient.get.mockResolvedValue({
      assignments: [],
      connections: [],
      layout: {
        capacity_unit_id: "unit-1",
        community_id: "community-1",
        created_at: "2026-09-23T00:00:00Z",
        event_id: "event-1",
        id: "layout-1",
        occurrence_id: null,
        seating_done: false,
        updated_at: "2026-09-23T00:00:00Z",
      },
      tables: [{
        ...savedTable,
        client_table_id: savedTable.id,
        disabled_seat_parts: savedTable.disabledSeats,
        is_rabbi_table: savedTable.isRabbiTable,
        long_side_seats: savedTable.sideSeats,
      }],
    });

    const loaded = await getSeatingLayout({
      capacityUnitId: "unit-1",
      eventId: "event-1",
      occurrenceId: null,
    });

    expect(normalizeEditorTables(loaded?.tables ?? [])[0].disabledSeats)
      .toEqual(["end:b", "side:a:2"]);
  });
});
