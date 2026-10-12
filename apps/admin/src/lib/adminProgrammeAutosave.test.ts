import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PROGRAMME_AUTOSAVE_DELAY_MS,
  ProgrammeAutosaveCoordinator,
} from "./adminProgrammeAutosave";

describe("ProgrammeAutosaveCoordinator", () => {
  afterEach(() => vi.useRealTimers());

  it("waits for two seconds after one user edit", () => {
    vi.useFakeTimers();
    const ready = vi.fn();
    const autosave = new ProgrammeAutosaveCoordinator("event-a", ready);

    autosave.markUserEdit();
    vi.advanceTimersByTime(PROGRAMME_AUTOSAVE_DELAY_MS - 1);
    expect(ready).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(autosave.takeSaveRequest()).toEqual({ eventId: "event-a", revision: 1 });
  });

  it("debounces multiple edits into the latest revision", () => {
    vi.useFakeTimers();
    const ready = vi.fn();
    const autosave = new ProgrammeAutosaveCoordinator("event-a", ready);

    autosave.markUserEdit();
    vi.advanceTimersByTime(1_000);
    autosave.markUserEdit();
    vi.advanceTimersByTime(1_999);
    expect(ready).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(autosave.takeSaveRequest()).toEqual({ eventId: "event-a", revision: 2 });
  });

  it("keeps an edit made during a request pending for a later save", () => {
    vi.useFakeTimers();
    const ready = vi.fn();
    const autosave = new ProgrammeAutosaveCoordinator("event-a", ready);

    autosave.markUserEdit();
    vi.advanceTimersByTime(PROGRAMME_AUTOSAVE_DELAY_MS);
    const first = autosave.takeSaveRequest();
    expect(first).not.toBeNull();
    autosave.markUserEdit();
    vi.advanceTimersByTime(PROGRAMME_AUTOSAVE_DELAY_MS);
    expect(autosave.takeSaveRequest()).toBeNull();

    const completion = autosave.complete(first!, "saved");
    expect(completion).toMatchObject({ current: true, savedCurrentRevision: false, shouldSave: true });
    expect(autosave.takeSaveRequest()).toEqual({ eventId: "event-a", revision: 2 });
  });

  it("does not automatically retry a failed save, but permits an explicit retry", () => {
    vi.useFakeTimers();
    const autosave = new ProgrammeAutosaveCoordinator("event-a", vi.fn());

    autosave.markUserEdit();
    vi.advanceTimersByTime(PROGRAMME_AUTOSAVE_DELAY_MS);
    const request = autosave.takeSaveRequest();
    autosave.complete(request!, "failed");
    expect(autosave.takeSaveRequest()).toBeNull();
    expect(autosave.retry()).toBe(true);
    expect(autosave.takeSaveRequest()).toEqual(request);
  });

  it("keeps an invalid draft pending without submitting another request until it is corrected", () => {
    vi.useFakeTimers();
    const autosave = new ProgrammeAutosaveCoordinator("event-a", vi.fn());

    autosave.markUserEdit();
    vi.advanceTimersByTime(PROGRAMME_AUTOSAVE_DELAY_MS);
    const invalidRequest = autosave.takeSaveRequest();
    autosave.complete(invalidRequest!, "invalid");
    expect(autosave.hasPendingChanges).toBe(true);
    expect(autosave.takeSaveRequest()).toBeNull();

    autosave.markUserEdit();
    vi.advanceTimersByTime(PROGRAMME_AUTOSAVE_DELAY_MS);
    expect(autosave.takeSaveRequest()).toEqual({ eventId: "event-a", revision: 2 });
  });

  it("holds a blocked parent mutation until availability is restored", () => {
    vi.useFakeTimers();
    const autosave = new ProgrammeAutosaveCoordinator("event-a", vi.fn());

    autosave.markUserEdit();
    vi.advanceTimersByTime(PROGRAMME_AUTOSAVE_DELAY_MS);
    autosave.pauseForBlockedParent();
    expect(autosave.takeSaveRequest()).toBeNull();
    expect(autosave.resumeWhenParentIsAvailable()).toBe(true);
    expect(autosave.takeSaveRequest()).toEqual({ eventId: "event-a", revision: 1 });
  });

  it("invalidates timers and completed requests from a previous event", () => {
    vi.useFakeTimers();
    const ready = vi.fn();
    const autosave = new ProgrammeAutosaveCoordinator("event-a", ready);

    autosave.markUserEdit();
    autosave.reset("event-b");
    vi.advanceTimersByTime(PROGRAMME_AUTOSAVE_DELAY_MS);
    expect(ready).not.toHaveBeenCalled();

    autosave.markUserEdit();
    vi.advanceTimersByTime(PROGRAMME_AUTOSAVE_DELAY_MS);
    const request = autosave.takeSaveRequest();
    autosave.reset("event-c");
    expect(autosave.complete(request!, "saved")).toMatchObject({ current: false });
    expect(autosave.hasPendingChanges).toBe(false);
  });
});
