export const AUTH_ERROR_MESSAGES = {
  actionFailed: 'Не удалось выполнить действие.',
  authRequired: 'Чтобы продолжить, войдите в приложение.',
  duplicateEmail: 'Этот email уже зарегистрирован. Попробуйте войти.',
  emailNotConfirmed: 'Email ещё не подтверждён. Проверьте почту.',
  inviteInvalid: 'Код приглашения недействителен или истёк.',
  passwordMismatch: 'Пароли не совпадают',
  rateLimit: 'Слишком много попыток. Попробуйте позже.',
  signIn: 'Не удалось войти. Проверьте email и пароль.',
  weakPassword: 'Используйте минимум 8 символов',
  googleCancelled: 'Вход через Google отменён.',
  googleNotConfigured: 'Google-вход пока не настроен для этого окружения.',
  googleGeneric: 'Не удалось войти через Google. Попробуйте ещё раз.',
  googleSessionFailed: 'Не удалось завершить вход через Google.',
  appleCancelled: 'Вход через Apple отменён.',
  appleUnavailable: 'Apple-вход недоступен на этом устройстве.',
  appleMissingToken: 'Apple не вернул токен входа.',
  appleNotConfigured: 'Apple-вход пока не настроен для этого окружения.',
  appleGeneric: 'Не удалось войти через Apple. Попробуйте ещё раз.',
} as const;

export const GOOGLE_OAUTH_CANCELLED_MESSAGE = AUTH_ERROR_MESSAGES.googleCancelled;
export const GOOGLE_OAUTH_NOT_CONFIGURED_MESSAGE = AUTH_ERROR_MESSAGES.googleNotConfigured;
export const GOOGLE_OAUTH_GENERIC_MESSAGE = AUTH_ERROR_MESSAGES.googleGeneric;
export const GOOGLE_OAUTH_SESSION_FAILED_MESSAGE = AUTH_ERROR_MESSAGES.googleSessionFailed;
export const APPLE_SIGN_IN_CANCELLED_MESSAGE = AUTH_ERROR_MESSAGES.appleCancelled;
export const APPLE_SIGN_IN_UNAVAILABLE_MESSAGE = AUTH_ERROR_MESSAGES.appleUnavailable;
export const APPLE_SIGN_IN_MISSING_TOKEN_MESSAGE = AUTH_ERROR_MESSAGES.appleMissingToken;
export const APPLE_SIGN_IN_NOT_CONFIGURED_MESSAGE = AUTH_ERROR_MESSAGES.appleNotConfigured;
export const APPLE_SIGN_IN_GENERIC_MESSAGE = AUTH_ERROR_MESSAGES.appleGeneric;

const FRIENDLY_AUTH_MESSAGES = new Set<string>(Object.values(AUTH_ERROR_MESSAGES));

function includesAny(message: string, phrases: string[]): boolean {
  return phrases.some((phrase) => message.includes(phrase));
}

function readErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return fallback;
}

function isProviderSetupError(message: string): boolean {
  return includesAny(message, [
    'provider is not enabled',
    'provider not enabled',
    'unsupported provider',
    'invalid_client',
    'invalid client',
    'oauth client',
    'redirect_uri_mismatch',
    'redirect uri',
    'unauthorized_client',
    'client not found',
    'client_id',
    'client secret',
    'audience',
    'not configured',
  ]);
}

export function getGoogleOAuthErrorMessage(
  error: unknown,
  fallback: string = GOOGLE_OAUTH_GENERIC_MESSAGE,
): string {
  const message = readErrorMessage(error, fallback);
  const normalizedMessage = message.toLowerCase();

  if (message === GOOGLE_OAUTH_CANCELLED_MESSAGE) {
    return GOOGLE_OAUTH_CANCELLED_MESSAGE;
  }

  if (message === GOOGLE_OAUTH_NOT_CONFIGURED_MESSAGE) {
    return GOOGLE_OAUTH_NOT_CONFIGURED_MESSAGE;
  }

  if (message === GOOGLE_OAUTH_SESSION_FAILED_MESSAGE) {
    return GOOGLE_OAUTH_SESSION_FAILED_MESSAGE;
  }

  if (includesAny(normalizedMessage, ['access_denied', 'cancel', 'cancelled', 'dismiss'])) {
    return GOOGLE_OAUTH_CANCELLED_MESSAGE;
  }

  if (isProviderSetupError(normalizedMessage)) {
    return GOOGLE_OAUTH_NOT_CONFIGURED_MESSAGE;
  }

  return fallback;
}

export function getAppleSignInErrorMessage(
  error: unknown,
  fallback: string = APPLE_SIGN_IN_GENERIC_MESSAGE,
): string {
  const message = readErrorMessage(error, fallback);
  const normalizedMessage = message.toLowerCase();

  if (message === APPLE_SIGN_IN_CANCELLED_MESSAGE) {
    return APPLE_SIGN_IN_CANCELLED_MESSAGE;
  }

  if (message === APPLE_SIGN_IN_UNAVAILABLE_MESSAGE) {
    return APPLE_SIGN_IN_UNAVAILABLE_MESSAGE;
  }

  if (message === APPLE_SIGN_IN_MISSING_TOKEN_MESSAGE) {
    return APPLE_SIGN_IN_MISSING_TOKEN_MESSAGE;
  }

  if (message === APPLE_SIGN_IN_NOT_CONFIGURED_MESSAGE) {
    return APPLE_SIGN_IN_NOT_CONFIGURED_MESSAGE;
  }

  if (
    includesAny(normalizedMessage, [
      'err_request_canceled',
      'err_request_cancelled',
      'cancel',
      'cancelled',
    ])
  ) {
    return APPLE_SIGN_IN_CANCELLED_MESSAGE;
  }

  if (includesAny(normalizedMessage, ['unavailable', 'not available'])) {
    return APPLE_SIGN_IN_UNAVAILABLE_MESSAGE;
  }

  if (
    includesAny(normalizedMessage, ['identity token', 'id token', 'token']) &&
    includesAny(normalizedMessage, ['missing', 'empty', 'not returned', 'не вернул'])
  ) {
    return APPLE_SIGN_IN_MISSING_TOKEN_MESSAGE;
  }

  if (isProviderSetupError(normalizedMessage)) {
    return APPLE_SIGN_IN_NOT_CONFIGURED_MESSAGE;
  }

  return fallback;
}

export function getAuthErrorMessage(
  error: unknown,
  fallback: string = AUTH_ERROR_MESSAGES.actionFailed,
): string {
  const message = readErrorMessage(error, fallback);
  const normalizedMessage = message.toLowerCase();
  const normalizedFallback = fallback.toLowerCase();

  if (!message) {
    return fallback;
  }

  if (FRIENDLY_AUTH_MESSAGES.has(message)) {
    return message;
  }

  if (message === 'Auth required') {
    return AUTH_ERROR_MESSAGES.authRequired;
  }

  if (normalizedFallback.includes('google')) {
    return getGoogleOAuthErrorMessage(message, fallback);
  }

  if (normalizedFallback.includes('apple')) {
    return getAppleSignInErrorMessage(message, fallback);
  }

  if (
    includesAny(normalizedMessage, [
      'invalid login credentials',
      'invalid credentials',
      'invalid email or password',
    ])
  ) {
    return AUTH_ERROR_MESSAGES.signIn;
  }

  if (
    includesAny(normalizedMessage, [
      'already registered',
      'already been registered',
      'user already exists',
      'уже зарегистрирован',
    ])
  ) {
    return AUTH_ERROR_MESSAGES.duplicateEmail;
  }

  if (
    (normalizedMessage.includes('password') || normalizedMessage.includes('парол')) &&
    includesAny(normalizedMessage, ['weak', 'too short', 'at least', 'minimum', 'слаб', 'прост'])
  ) {
    return AUTH_ERROR_MESSAGES.weakPassword;
  }

  if (
    includesAny(normalizedMessage, [
      'email not confirmed',
      'email is not confirmed',
      'ещё не подтвержд',
      'еще не подтвержд',
    ])
  ) {
    return AUTH_ERROR_MESSAGES.emailNotConfirmed;
  }

  if (
    includesAny(normalizedMessage, [
      'rate limit',
      'too many requests',
      'email send rate',
      'security purposes',
      'слишком много попыток',
    ])
  ) {
    return AUTH_ERROR_MESSAGES.rateLimit;
  }

  if (normalizedMessage.includes('invalid or expired invite code')) {
    return AUTH_ERROR_MESSAGES.inviteInvalid;
  }

  return message || fallback;
}

export function isAuthCancellationMessage(message: string | null | undefined): boolean {
  return message === GOOGLE_OAUTH_CANCELLED_MESSAGE || message === APPLE_SIGN_IN_CANCELLED_MESSAGE;
}
