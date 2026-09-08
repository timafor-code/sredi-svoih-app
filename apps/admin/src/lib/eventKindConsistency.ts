/**
 * Keeps the owner-facing Jewish calendar categories aligned with the runtime
 * event kind, without deriving unrelated event kinds from their categories.
 */
export function getConsistentEventKind(category: string, currentEventKind: string): string {
  if (category === "shabbat") {
    return "shabbat";
  }

  if (category === "holiday") {
    return "holiday";
  }

  return currentEventKind === "shabbat" || currentEventKind === "holiday"
    ? "single"
    : currentEventKind;
}
