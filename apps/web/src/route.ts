export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const PUBLIC_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const UUID_LIKE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RESERVED_PUBLIC_SLUGS = new Set([
  "new",
  "admin",
  "api",
  "auth",
  "privacy",
  "support",
  "assets",
  "static",
  "null",
  "undefined",
]);

export type EventRoute = {
  kind: "uuid" | "slug";
  value: string;
  requestedOccurrenceId: string | null;
};

export type InvalidRoute = { kind: "invalid" };

function isPublicSlugSegment(value: string): boolean {
  return value.length >= 2
    && value.length <= 80
    && PUBLIC_SLUG_PATTERN.test(value)
    && !UUID_LIKE_PATTERN.test(value);
}

export function isCanonicalPublicPath(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = value.match(/^\/events\/([^/]+)$/);
  return Boolean(
    match
    && isPublicSlugSegment(match[1])
    && !RESERVED_PUBLIC_SLUGS.has(match[1]),
  );
}

export function parseRoute(pathname: string, search: string): EventRoute | InvalidRoute {
  const match = pathname.match(/^\/events\/([^/]+)$/);
  if (!match) return { kind: "invalid" };

  const value = match[1];
  const kind = UUID_PATTERN.test(value)
    ? "uuid"
    : isPublicSlugSegment(value)
      ? "slug"
      : null;
  if (kind === null) return { kind: "invalid" };

  const occurrence = new URLSearchParams(search).get("occurrence");
  return {
    kind,
    value: kind === "uuid" ? value.toLowerCase() : value,
    requestedOccurrenceId: occurrence && UUID_PATTERN.test(occurrence)
      ? occurrence.toLowerCase()
      : null,
  };
}

export function replaceCanonicalEventPath(
  canonicalPublicPath: string,
  requestedOccurrenceId: string | null,
  occurrenceIds: readonly string[],
): boolean {
  const occurrenceId = requestedOccurrenceId
    && occurrenceIds.some((value) => value.toLowerCase() === requestedOccurrenceId)
    ? requestedOccurrenceId
    : null;
  const search = occurrenceId ? `?occurrence=${encodeURIComponent(occurrenceId)}` : "";
  const nextUrl = `${canonicalPublicPath}${search}${window.location.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl !== currentUrl) {
    window.history.replaceState(window.history.state, "", nextUrl);
    return true;
  }
  return false;
}

export function replaceOccurrenceQuery(occurrenceId: string): void {
  const nextUrl = `${window.location.pathname}?occurrence=${encodeURIComponent(occurrenceId)}${window.location.hash}`;
  window.history.replaceState(window.history.state, "", nextUrl);
}
