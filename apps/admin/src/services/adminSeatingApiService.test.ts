import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "./apiClient";
import {
  getSeatingLayout,
  getSeatingTemplate,
  saveSeatingLayout,
  saveSeatingLayoutState,
} from "./adminSeatingApiService";

vi.mock("./apiClient", () => ({
  apiClient: {
    get: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
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

  it("preserves persisted assignment guest identity on layout load", async () => {
    mockedApiClient.get.mockResolvedValue({
      layout: layoutRow, tables: [], connections: [], assignments: [{
        id: "assignment-1", layout_id: "layout-1", registration_id: "registration-1",
        guest_index: 2, user_id: "user-1", seat_key: "table-1:side:a:0",
        guest_label: "Иван Иванов", guest_initials: "ИИ", assignment_type: "guest",
      }],
    });
    const layout = await getSeatingLayout({ eventId: "event-1", occurrenceId: null, capacityUnitId: "unit-1" });
    expect(layout?.assignments[0]).toMatchObject({ registrationId: "registration-1", guestIndex: 2, userId: "user-1", guestLabel: "Иван Иванов" });
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

  it("saves atomic layout state with unchanged concurrency timestamp", async () => {
    mockedApiClient.put.mockResolvedValue({
      layout: layoutRow,
      assignments: { layout_id: "layout-1", placed_count: 1, pooled_count: 2, reserve_count: 1 },
    });
    const result = await saveSeatingLayoutState({
      eventId: "event-1", occurrenceId: null, capacityUnitId: "unit-1",
      customTables: [{ id: "table-1", cx: 100, cy: 120, w: 180, h: 80, angle: 0, sideSeats: 2, disabledSeats: ["side:a:0"], isRabbiTable: true }],
      expectedUpdatedAt: "2026-09-23T00:00:00.123456Z",
      assignments: { chairs: [], pool: [] },
    });
    expect(mockedApiClient.put).toHaveBeenCalledWith(
      "/admin/seating/layout/state",
      expect.objectContaining({
        expectedUpdatedAt: "2026-09-23T00:00:00.123456Z",
        assignments: expect.any(Object),
        customTables: [expect.objectContaining({ disabledSeats: ["side:a:0"] })],
      }),
    );
    expect(result.layout.updatedAt).toBe(layoutRow.updated_at);
    expect(result.assignments).toMatchObject({ placedCount: 1, pooledCount: 2, reserveCount: 1 });
  });

  it("serializes guestIndex but never client-supplied userId", async () => {
    mockedApiClient.put.mockResolvedValue({ layout: layoutRow, assignments: null });
    await saveSeatingLayoutState({
      eventId: "event-1", occurrenceId: null, capacityUnitId: "unit-1", customTables: [], expectedUpdatedAt: null,
      assignments: { chairs: [{ type: "guest", registrationId: "registration-1", guestIndex: 2, name: "Иван Иванов", initials: "ИИ", seatKey: "table-1:side:a:0", ...({ userId: "must-not-serialize" } as Record<string, unknown>) }], pool: [{ type: "guest", registrationId: "registration-1", guestIndex: null, name: "Participant", initials: "P", seatKey: null }] },
    });
    expect(mockedApiClient.put).toHaveBeenCalledWith("/admin/seating/layout/state", expect.objectContaining({
      assignments: expect.objectContaining({ chairs: [expect.objectContaining({ guestIndex: 2 })], pool: [expect.objectContaining({ guestIndex: null })] }),
    }));
    const payload = mockedApiClient.put.mock.calls[0]?.[1] as { assignments: { chairs: Array<Record<string, unknown>> } };
    expect(payload.assignments.chairs[0]).not.toHaveProperty("userId");
  });

  it("omits atomic assignments when not provided", async () => {
    mockedApiClient.put.mockResolvedValue({ layout: layoutRow, assignments: null });
    await saveSeatingLayoutState({
      eventId: "event-1", occurrenceId: null, capacityUnitId: "unit-1",
      customTables: [], expectedUpdatedAt: null,
    });
    expect(mockedApiClient.put).toHaveBeenCalledWith(
      "/admin/seating/layout/state",
      expect.not.objectContaining({ assignments: expect.anything() }),
    );
  });

  it("keeps converted editor saves on the atomic state operation", async () => {
    const editorSource = await readFile(
      new URL("../components/seating/SeatingLayoutEditor.tsx", import.meta.url),
      "utf8",
    );

    expect(editorSource).not.toMatch(/\bsaveSeatingAssignments\b/);
    expect(editorSource).not.toMatch(/\bsaveSeatingLayout\b/);
    expect((editorSource.match(/saveLayoutState\(\{/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
