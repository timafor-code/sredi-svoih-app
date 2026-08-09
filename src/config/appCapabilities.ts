export type AppAccessMode = 'guest_only' | 'account';

export type EventRegistrationMode =
  | 'disabled'
  | 'public_web'
  | 'account';

export type AppCapabilityMatrix = Readonly<{
  appAccessMode: AppAccessMode;
  eventRegistrationMode: EventRegistrationMode;
  isGuestOnly: boolean;
  isAccountMode: boolean;
  canUseAccountFeatures: boolean;
  canUsePublicWebEventRegistration: boolean;
  canUseInternalAccountEventRegistration: boolean;
}>;

export function parseAppAccessMode(value: string | undefined): AppAccessMode {
  return value === 'account' ? 'account' : 'guest_only';
}

export function parseEventRegistrationMode(
  value: string | undefined,
): EventRegistrationMode {
  if (value === 'public_web' || value === 'account') {
    return value;
  }

  return 'disabled';
}

export function resolveAppCapabilities(
  appAccessModeValue: string | undefined,
  eventRegistrationModeValue: string | undefined,
): AppCapabilityMatrix {
  const appAccessMode = parseAppAccessMode(appAccessModeValue);
  const eventRegistrationMode = parseEventRegistrationMode(eventRegistrationModeValue);
  const isAccountMode = appAccessMode === 'account';

  return Object.freeze({
    appAccessMode,
    eventRegistrationMode,
    isGuestOnly: !isAccountMode,
    isAccountMode,
    canUseAccountFeatures: isAccountMode,
    canUsePublicWebEventRegistration: eventRegistrationMode === 'public_web',
    canUseInternalAccountEventRegistration:
      isAccountMode && eventRegistrationMode === 'account',
  });
}

export const appCapabilities = resolveAppCapabilities(
  process.env.EXPO_PUBLIC_APP_ACCESS_MODE,
  process.env.EXPO_PUBLIC_EVENT_REGISTRATION_MODE,
);
