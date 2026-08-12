import {
  appCapabilities,
  type AppCapabilityMatrix,
} from '@/config/appCapabilities';

const GUEST_BLOCKED_PROFILE_ROUTE_NAMES = [
  'profile/edit',
  'profile/onboarding',
  'profile/my-registrations',
  'profile/my-events',
  'profile/past-registrations',
  'profile/registration-groups/[eventId]',
] as const;

export const GUEST_BLOCKED_ROUTE_NAMES = [
  ...GUEST_BLOCKED_PROFILE_ROUTE_NAMES,
  'contacts/community/[id]',
  'contacts/[id]',
] as const;

export const INTERNAL_EVENT_REGISTRATION_ROUTE_NAMES = [
  'events/register/[id]',
  'events/paid-occurrences',
  'events/paid-options',
  'modals/event-registration',
] as const;

const GUEST_BLOCKED_PROFILE_PATHS = new Set(
  GUEST_BLOCKED_PROFILE_ROUTE_NAMES.map((routeName) => `/${routeName}`),
);

export function normalizeAppPathname(pathname: string): string {
  const withoutQueryOrHash = pathname.split(/[?#]/, 1)[0] ?? '/';
  const withLeadingSlash = withoutQueryOrHash.startsWith('/')
    ? withoutQueryOrHash
    : `/${withoutQueryOrHash}`;
  const normalizedSlashes = withLeadingSlash.replace(/\/{2,}/g, '/');

  if (normalizedSlashes === '/') {
    return normalizedSlashes;
  }

  return normalizedSlashes.replace(/\/+$/, '') || '/';
}

export function isGuestBlockedPathname(
  pathname: string,
  capabilities: AppCapabilityMatrix = appCapabilities,
): boolean {
  if (!capabilities.isGuestOnly) {
    return false;
  }

  const normalizedPathname = normalizeAppPathname(pathname);

  if (GUEST_BLOCKED_PROFILE_PATHS.has(normalizedPathname)) {
    return true;
  }

  if (/^\/profile\/registration-groups\/[^/]+$/.test(normalizedPathname)) {
    return true;
  }

  if (normalizedPathname.startsWith('/contacts/community/')) {
    return true;
  }

  const legacyContactMatch = normalizedPathname.match(/^\/contacts\/([^/]+)$/);

  return Boolean(
    legacyContactMatch
    && legacyContactMatch[1] !== 'iphone'
    && legacyContactMatch[1] !== 'community',
  );
}

export function isInternalEventRegistrationBlockedPathname(
  pathname: string,
  capabilities: AppCapabilityMatrix = appCapabilities,
): boolean {
  if (capabilities.canUseInternalAccountEventRegistration) {
    return false;
  }

  const normalizedPathname = normalizeAppPathname(pathname);

  return normalizedPathname === '/events/paid-occurrences'
    || normalizedPathname === '/events/paid-options'
    || normalizedPathname === '/modals/event-registration'
    || /^\/events\/register\/[^/]+$/.test(normalizedPathname);
}
