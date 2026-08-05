export type PersonalField = "firstName" | "lastName" | "phone" | "email";
export type PersonalErrors = Partial<Record<PersonalField, string>>;

const CONTROL_CHARACTER = /\p{C}/u;

export function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function validateName(value: string): string | null {
  const normalized = normalizeName(value);
  if (!normalized) return "Заполните это поле.";
  if (normalized.length > 100) return "Введите не более 100 символов.";
  if (CONTROL_CHARACTER.test(normalized)) return "Удалите недопустимые символы.";
  return null;
}

export function normalizeRussianPhone(value: string): string | null {
  const compact = value.trim().replace(/[\s()\-]/g, "");
  if (/^\+7\d{10}$/.test(compact)) return compact;
  if (/^8\d{10}$/.test(compact)) return `+7${compact.slice(1)}`;
  if (/^7\d{10}$/.test(compact)) return `+${compact}`;
  return null;
}

export function validatePhone(value: string): string | null {
  if (!value.trim()) return "Введите телефон.";
  if (!normalizeRussianPhone(value)) {
    return "Введите российский номер в формате +7XXXXXXXXXX или 8XXXXXXXXXX.";
  }
  return null;
}

export function validateEmail(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) return "Введите email.";
  if (normalized.length > 254) return "Введите email не длиннее 254 символов.";
  if (CONTROL_CHARACTER.test(normalized) || /\s/.test(normalized)) {
    return "Проверьте email: в нём не должно быть пробелов.";
  }
  if (normalized.split("@").length !== 2) return "Введите корректный email.";
  const [local, domain] = normalized.split("@");
  if (!local || local.length > 64 || !domain || !domain.includes(".")) {
    return "Введите корректный email.";
  }
  return null;
}

export function validatePersonalFields(values: Record<PersonalField, string>): PersonalErrors {
  const errors: PersonalErrors = {};
  const firstNameError = validateName(values.firstName);
  const lastNameError = validateName(values.lastName);
  const phoneError = validatePhone(values.phone);
  const emailError = validateEmail(values.email);
  if (firstNameError) errors.firstName = firstNameError;
  if (lastNameError) errors.lastName = lastNameError;
  if (phoneError) errors.phone = phoneError;
  if (emailError) errors.email = emailError;
  return errors;
}
