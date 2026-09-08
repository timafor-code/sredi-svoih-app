import { describe, expect, it } from "vitest";

import { cloneSchedule } from "../../components/events/EventProgrammeEditor";
import { toAdminEventSchedulePayload } from "../adminEventsApiService";
import { normalizeAdminEventRow } from "../adminEventsService";

import type { AdminEventSchedule, AdminEventRow } from "../../types/events";

const SYSTEM_KEY = "candle_lighting_moscow" as const;

function scheduleRow(): AdminEventRow["schedule"] {
  return {
    version: 1,
    days: [{
      date: "2026-09-25",
      label: null,
      note: null,
      items: [{
        time: "18:30",
        title: "Зажигание свечей",
        option_id: null,
        system_key: SYSTEM_KEY,
      }],
    }],
  };
}

function normalizedSchedule(): AdminEventSchedule {
  const event = normalizeAdminEventRow({
    id: "event-id",
    community_id: "community-id",
    schedule: scheduleRow(),
  });
  if (!event.schedule) throw new Error("expected a normalized schedule");
  return event.schedule;
}

describe("admin event schedule system key contract", () => {
  it("normalizes API system_key to systemKey and serializes it back", () => {
    const schedule = normalizedSchedule();
    expect(schedule.days[0].items[0].systemKey).toBe(SYSTEM_KEY);
    expect(toAdminEventSchedulePayload(schedule)).toEqual(scheduleRow());
  });

  it("preserves the system key when Programme drafts are cloned", () => {
    const draft = cloneSchedule(normalizedSchedule());
    expect(draft?.days[0].items[0].systemKey).toBe(SYSTEM_KEY);
  });
});
