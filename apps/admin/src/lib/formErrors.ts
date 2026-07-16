export function clearFormErrors<ErrorKey extends string>(
  errors: Partial<Record<ErrorKey, string | undefined>>,
  keys: readonly ErrorKey[],
): Partial<Record<ErrorKey, string | undefined>> {
  const next = { ...errors };

  keys.forEach((key) => {
    delete next[key];
  });

  return next;
}

export function firstActiveFormErrorKey<ErrorKey extends string>(
  errors: Partial<Record<ErrorKey, string | undefined>>,
  excludedKeys: readonly ErrorKey[] = [],
): ErrorKey | null {
  for (const [key, message] of Object.entries(errors) as Array<[
    ErrorKey,
    string | undefined,
  ]>) {
    if (
      !excludedKeys.includes(key) &&
      typeof message === "string" &&
      message.trim().length > 0
    ) {
      return key;
    }
  }

  return null;
}
