export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type EventRoute = {
  kind: "event";
  eventId: string;
  requestedOccurrenceId: string | null;
};

export type InvalidRoute = { kind: "invalid" };

export function parseRoute(pathname: string, search: string): EventRoute | InvalidRoute {
  const match = pathname.match(/^\/events\/([^/]+)$/);
  if (!match || !UUID_PATTERN.test(match[1])) {
    return { kind: "invalid" };
  }

  const occurrence = new URLSearchParams(search).get("occurrence");
  return {
    kind: "event",
    eventId: match[1].toLowerCase(),
    requestedOccurrenceId: occurrence && UUID_PATTERN.test(occurrence)
      ? occurrence.toLowerCase()
      : null,
  };
}

export function replaceOccurrenceQuery(occurrenceId: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("occurrence", occurrenceId);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}
