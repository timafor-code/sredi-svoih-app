export const PROGRAMME_AUTOSAVE_DELAY_MS = 2_000;

export type ProgrammeSaveRequest = Readonly<{
  eventId: string;
  revision: number;
}>;

export function isSameProgrammeSaveRequest(
  left: ProgrammeSaveRequest | null,
  right: ProgrammeSaveRequest,
): boolean {
  return left?.eventId === right.eventId && left.revision === right.revision;
}

type ProgrammeAutosaveOutcome = "saved" | "blocked" | "dependency" | "failed" | "invalid";

type ProgrammeAutosaveTimer = Pick<typeof globalThis, "clearTimeout" | "setTimeout">;

/**
 * Keeps the timing and revision rules for the Programme editor independent of
 * rendering. A completed request is allowed to confirm only the revision it
 * was started for, so later local edits are never replaced by an old response.
 */
export class ProgrammeAutosaveCoordinator {
  private eventId: string;
  private revision = 0;
  private pending = false;
  private ready = false;
  private saving = false;
  private paused: "none" | "blocked" | "dependency" | "failed" | "invalid" = "none";
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    eventId: string,
    private readonly onReady: () => void,
    private readonly timerApi: ProgrammeAutosaveTimer = globalThis,
  ) {
    this.eventId = eventId;
  }

  get hasPendingChanges(): boolean {
    return this.pending;
  }

  get isScheduled(): boolean {
    return this.timer !== null;
  }

  get isSaving(): boolean {
    return this.saving;
  }

  reset(eventId: string): void {
    this.clearTimer();
    this.eventId = eventId;
    this.revision = 0;
    this.pending = false;
    this.ready = false;
    this.saving = false;
    this.paused = "none";
  }

  markUserEdit(): void {
    this.revision += 1;
    this.pending = true;
    this.ready = false;
    this.paused = "none";
    this.schedule(PROGRAMME_AUTOSAVE_DELAY_MS);
  }

  takeSaveRequest(): ProgrammeSaveRequest | null {
    if (!this.pending || !this.ready || this.saving || this.paused !== "none") return null;
    this.saving = true;
    return { eventId: this.eventId, revision: this.revision };
  }

  complete(request: ProgrammeSaveRequest, outcome: ProgrammeAutosaveOutcome): {
    current: boolean;
    completedLatestRevision: boolean;
    shouldSave: boolean;
  } {
    if (request.eventId !== this.eventId) {
      return { current: false, completedLatestRevision: false, shouldSave: false };
    }

    this.saving = false;
    const completedLatestRevision = request.revision === this.revision;
    if (outcome === "saved" && completedLatestRevision) {
      this.pending = false;
      this.ready = false;
      this.paused = "none";
      return { current: true, completedLatestRevision: true, shouldSave: false };
    }

    if (outcome === "saved") {
      return {
        current: true,
        completedLatestRevision: false,
        shouldSave: this.ready && this.paused === "none",
      };
    }

    // A failed older request must not turn a newer revision into a failed
    // draft. Its timer/readiness state remains intact and can save safely once
    // this request releases the single-write lock.
    if (!completedLatestRevision && outcome !== "blocked" && outcome !== "dependency") {
      return {
        current: true,
        completedLatestRevision: false,
        shouldSave: this.ready && this.paused === "none",
      };
    }

    this.paused = outcome;
    return { current: true, completedLatestRevision, shouldSave: false };
  }

  pauseForBlockedParent(): void {
    if (!this.pending) return;
    this.ready = true;
    this.paused = "blocked";
  }

  resumeWhenParentIsAvailable(): boolean {
    if (!this.pending || this.paused !== "blocked") return false;
    this.paused = "none";
    return this.ready && !this.saving;
  }

  resumeWhenValidationDependenciesAreAvailable(): boolean {
    if (!this.pending || this.paused !== "dependency") return false;
    this.paused = "none";
    return this.ready && !this.saving;
  }

  retry(): boolean {
    if (!this.pending || this.saving) return false;
    this.clearTimer();
    this.ready = true;
    this.paused = "none";
    return true;
  }

  cancel(): void {
    this.clearTimer();
  }

  private schedule(delay: number): void {
    this.clearTimer();
    this.timer = this.timerApi.setTimeout(() => {
      this.timer = null;
      this.ready = true;
      this.onReady();
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    this.timerApi.clearTimeout(this.timer);
    this.timer = null;
  }
}
