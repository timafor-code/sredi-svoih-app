import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isSameProgrammeSaveRequest,
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
    expect(completion).toMatchObject({ current: true, completedLatestRevision: false, shouldSave: true });
    expect(autosave.takeSaveRequest()).toEqual({ eventId: "event-a", revision: 2 });
  });

  it("treats a revert during an in-flight save as a newer intent that is saved", () => {
    vi.useFakeTimers();
    const autosave = new ProgrammeAutosaveCoordinator("event-a", vi.fn());

    autosave.markUserEdit(); // "Минха" -> "Минха 19:00"
    vi.advanceTimersByTime(PROGRAMME_AUTOSAVE_DELAY_MS);
    const intermediateValue = autosave.takeSaveRequest();
    autosave.markUserEdit(); // "Минха 19:00" -> "Минха"
    vi.advanceTimersByTime(PROGRAMME_AUTOSAVE_DELAY_MS);

    expect(autosave.complete(intermediateValue!, "saved"))
      .toMatchObject({ completedLatestRevision: false, shouldSave: true });
    const revertedValue = autosave.takeSaveRequest();
    expect(revertedValue).toEqual({ eventId: "event-a", revision: 2 });
    expect(autosave.complete(revertedValue!, "saved"))
      .toMatchObject({ completedLatestRevision: true, shouldSave: false });
    expect(autosave.hasPendingChanges).toBe(false);
  });

  it("saves a newer revision after an older request fails once its debounce is ready", () => {
    vi.useFakeTimers();
    const autosave = new ProgrammeAutosaveCoordinator("event-a", vi.fn());

    autosave.markUserEdit();
    vi.advanceTimersByTime(PROGRAMME_AUTOSAVE_DELAY_MS);
    const first = autosave.takeSaveRequest();
    autosave.markUserEdit();
    vi.advanceTimersByTime(PROGRAMME_AUTOSAVE_DELAY_MS);

    expect(autosave.complete(first!, "failed"))
      .toMatchObject({ completedLatestRevision: false, shouldSave: true });
    expect(autosave.takeSaveRequest()).toEqual({ eventId: "event-a", revision: 2 });
  });

  it("keeps the remaining debounce after an older request fails early", () => {
    vi.useFakeTimers();
    const ready = vi.fn();
    const autosave = new ProgrammeAutosaveCoordinator("event-a", ready);

    autosave.markUserEdit();
    vi.advanceTimersByTime(PROGRAMME_AUTOSAVE_DELAY_MS);
    const first = autosave.takeSaveRequest();
    autosave.markUserEdit();
    vi.advanceTimersByTime(1_000);

    expect(autosave.complete(first!, "failed"))
      .toMatchObject({ completedLatestRevision: false, shouldSave: false });
    expect(autosave.takeSaveRequest()).toBeNull();
    vi.advanceTimersByTime(1_000);
    expect(ready).toHaveBeenCalledTimes(2);
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

  it("allows only one active Programme save request", () => {
    vi.useFakeTimers();
    const autosave = new ProgrammeAutosaveCoordinator("event-a", vi.fn());

    autosave.markUserEdit();
    vi.advanceTimersByTime(PROGRAMME_AUTOSAVE_DELAY_MS);
    const first = autosave.takeSaveRequest();
    expect(autosave.isSaving).toBe(true);
    expect(autosave.takeSaveRequest()).toBeNull();

    autosave.markUserEdit();
    vi.advanceTimersByTime(PROGRAMME_AUTOSAVE_DELAY_MS);
    expect(autosave.takeSaveRequest()).toBeNull();
    autosave.complete(first!, "saved");
    expect(autosave.takeSaveRequest()).toEqual({ eventId: "event-a", revision: 2 });
    expect(autosave.isSaving).toBe(true);
  });

  it("does not treat an older completion as the newer active request", () => {
    const older = { eventId: "event-a", revision: 1 };
    const newer = { eventId: "event-a", revision: 2 };

    expect(isSameProgrammeSaveRequest(newer, older)).toBe(false);
    expect(isSameProgrammeSaveRequest(newer, newer)).toBe(true);
  });

  it("does not request a save for initial state or automatic projection alone", () => {
    vi.useFakeTimers();
    const ready = vi.fn();
    const autosave = new ProgrammeAutosaveCoordinator("event-a", ready);

    vi.advanceTimersByTime(PROGRAMME_AUTOSAVE_DELAY_MS * 2);
    expect(ready).not.toHaveBeenCalled();
    expect(autosave.takeSaveRequest()).toBeNull();
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
