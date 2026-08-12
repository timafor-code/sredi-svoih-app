import { normalizeInternationalPhone } from "./phone";

export type PersonalField = "firstName" | "lastName" | "phone" | "email";
export type PersonalErrors = Partial<Record<PersonalField, string>>;

const CONTROL_CHARACTER = /\p{C}/u;

export function validateSeatsCount(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) return "Укажите количество мест.";
  const seatsCount = Number(normalized);
  if (!Number.isInteger(seatsCount) || seatsCount < 1 || seatsCount > 1000) {
    return "Введите целое количество мест от 1 до 1000.";
  }
  return null;
}

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

export function validatePhone(value: string): string | null {
  if (!value.trim()) return "Введите телефон.";
  if (!normalizeInternationalPhone(value)) {
    return "Введите корректный номер телефона с кодом страны";
  }
  return null;
}

export function normalizeRussianPhone(value: string): string | null {
  const normalized = normalizeInternationalPhone(value);
  return normalized?.startsWith("+7") ? normalized : null;
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
