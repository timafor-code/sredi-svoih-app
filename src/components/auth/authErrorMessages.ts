export const AUTH_ERROR_MESSAGES = {
  duplicateEmail: 'Этот email уже зарегистрирован. Попробуйте войти.',
  emailNotConfirmed: 'Email ещё не подтверждён. Проверьте почту.',
  passwordMismatch: 'Пароли не совпадают.',
  rateLimit: 'Слишком много попыток. Попробуйте позже.',
  signIn: 'Не удалось войти. Проверьте email и пароль.',
  weakPassword: 'Пароль слишком простой. Используйте минимум 6 символов.',
} as const;

function includesAny(message: string, phrases: string[]): boolean {
  return phrases.some((phrase) => message.includes(phrase));
}

export function getAuthErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : fallback;
  const normalizedMessage = message.toLowerCase();

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

  return message || fallback;
}
