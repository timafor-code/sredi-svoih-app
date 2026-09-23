import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "./apiClient";
import {
  getSeatingLayout,
  getSeatingTemplate,
  saveSeatingLayout,
} from "./adminSeatingApiService";

vi.mock("./apiClient", () => ({
  apiClient: {
    get: vi.fn(),
    patch: vi.fn(),
  },
}));

const mockedApiClient = vi.mocked(apiClient);

const table = {
  id: "db-table-1",
  layout_id: "layout-1",
  client_table_id: "table-1",
  cx: 100,
  cy: 120,
  w: 180,
  h: 80,
  angle: 0,
  long_side_seats: 2,
  disabled_seat_parts: ["side:a:0", "end:b"],
  is_rabbi_table: true,
  sort_order: 0,
  created_at: "2026-09-23T00:00:00Z",
  updated_at: "2026-09-23T00:00:00Z",
};

const layoutRow = {
  id: "layout-1",
  community_id: "community-1",
  event_id: "event-1",
  occurrence_id: null,
  capacity_unit_id: "unit-1",
  template_id: null,
  title: null,
  capacity_limit_snapshot: null,
  seating_done: false,
  created_by: null,
  created_at: "2026-09-23T00:00:00Z",
  updated_at: "2026-09-23T00:00:00Z",
};

describe("admin seating API disabled-seat serialization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps API disabled_seat_parts onto the domain table", async () => {
    mockedApiClient.get.mockResolvedValue({
      layout: layoutRow,
      tables: [table],
      connections: [],
      assignments: [],
    });

    const layout = await getSeatingLayout({
      eventId: "event-1",
      occurrenceId: null,
      capacityUnitId: "unit-1",
    });

    expect(layout?.tables[0].disabledSeats).toEqual(["side:a:0", "end:b"]);
  });

  it("maps disabledSeats in template snapshots onto the domain table", async () => {
    mockedApiClient.get.mockResolvedValue({
      id: "template-1",
      community_id: "community-1",
      title: "Template",
      description: null,
      snapshot: {
        version: 1,
        canvas: { width: 980, height: 640 },
        tables: [{
          id: "table-1",
          cx: 100,
          cy: 120,
          w: 180,
          h: 80,
          angle: 0,
          sideSeats: 2,
          disabledSeats: ["side:a:0", "end:b"],
          isRabbiTable: true,
        }],
        connections: [],
      },
      is_builtin: false,
      is_active: true,
      created_by: null,
      created_at: "2026-09-23T00:00:00Z",
      updated_at: "2026-09-23T00:00:00Z",
    });

    const template = await getSeatingTemplate("template-1");

    expect(template.snapshot.tables[0].disabledSeats).toEqual(["side:a:0", "end:b"]);
  });

  it("sends disabledSeats when saving a layout", async () => {
    mockedApiClient.patch.mockResolvedValue(layoutRow);

    await saveSeatingLayout({
      eventId: "event-1",
      occurrenceId: null,
      capacityUnitId: "unit-1",
      customTables: [{
        id: "table-1",
        cx: 100,
        cy: 120,
        w: 180,
        h: 80,
        angle: 0,
        sideSeats: 2,
        disabledSeats: ["side:a:0", "end:b"],
        isRabbiTable: true,
      }],
    });

    expect(mockedApiClient.patch).toHaveBeenCalledWith(
      "/admin/seating/layout",
      expect.objectContaining({
        customTables: [expect.objectContaining({
          disabledSeats: ["side:a:0", "end:b"],
        })],
      }),
    );
  });

  it("serializes absent disabledSeats as an empty array", async () => {
    mockedApiClient.patch.mockResolvedValue(layoutRow);

    await saveSeatingLayout({
      eventId: "event-1",
      occurrenceId: null,
      capacityUnitId: "unit-1",
      customTables: [{
        id: "table-1",
        cx: 100,
        cy: 120,
        w: 180,
        h: 80,
        angle: 0,
        sideSeats: 2,
        isRabbiTable: true,
      }],
    });

    expect(mockedApiClient.patch).toHaveBeenCalledWith(
      "/admin/seating/layout",
      expect.objectContaining({
        customTables: [expect.objectContaining({ disabledSeats: [] })],
      }),
    );
  });
});
