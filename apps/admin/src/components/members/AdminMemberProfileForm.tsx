import type {
  AdminMemberBirthTimeContext,
  AdminMemberListRow,
  AdminMemberMaritalStatus,
  AdminMemberProfile,
  AdminMemberTribeStatus,
  AdminUpdateUserProfileFields,
} from "../../types/members";

export type AdminMemberProfileDraft = {
  about: string;
  birthDate: string;
  birthTimeContext: AdminMemberBirthTimeContext;
  city: string;
  displayName: string;
  email: string;
  firstName: string;
  fullName: string;
  hebrewBirthDate: string;
  hebrewName: string;
  lastName: string;
  maritalStatus: AdminMemberMaritalStatus | "";
  nusach: string;
  onboardingCompleted: boolean;
  phone: string;
  tribeStatus: AdminMemberTribeStatus | "";
};

export type AdminMemberProfileUpdateFieldsResult =
  | { fields: AdminUpdateUserProfileFields; ok: true }
  | { error: string; ok: false };

export const ADMIN_MEMBER_BIRTH_TIME_CONTEXT_OPTIONS: Array<{
  label: string;
  value: AdminMemberBirthTimeContext;
}> = [
  { value: "unknown", label: "Неизвестно" },
  { value: "before_sunset", label: "До захода солнца" },
  { value: "after_sunset", label: "После захода солнца" },
];

export const ADMIN_MEMBER_TRIBE_STATUS_OPTIONS: Array<{
  label: string;
  value: AdminMemberTribeStatus;
}> = [
  { value: "kohen", label: "Коэн" },
  { value: "levi", label: "Леви" },
  { value: "israel", label: "Исраэль" },
];

export const ADMIN_MEMBER_MARITAL_STATUS_OPTIONS: Array<{
  label: string;
  value: AdminMemberMaritalStatus;
}> = [
  { value: "single", label: "Не женат / не замужем" },
  { value: "married", label: "Женат / замужем" },
  { value: "divorced", label: "В разводе" },
  { value: "widowed", label: "Вдовец / вдова" },
  { value: "other", label: "Другое" },
];

export function AdminMemberProfileForm({
  disabled,
  draft,
  onChange,
}: {
  disabled: boolean;
  draft: AdminMemberProfileDraft;
  onChange: (draft: AdminMemberProfileDraft) => void;
}) {
  const updateDraft = <Key extends keyof AdminMemberProfileDraft>(
    key: Key,
    value: AdminMemberProfileDraft[Key],
  ) => {
    onChange({ ...draft, [key]: value });
  };

  return (
    <div className="member-detail-grid">
      <label className="event-form-field">
        <span>Полное имя</span>
        <input
          disabled={disabled}
          onChange={(event) => updateDraft("fullName", event.target.value)}
          type="text"
          value={draft.fullName}
        />
      </label>

      <label className="event-form-field">
        <span>Имя</span>
        <input
          disabled={disabled}
          onChange={(event) => updateDraft("firstName", event.target.value)}
          type="text"
          value={draft.firstName}
        />
      </label>

      <label className="event-form-field">
        <span>Фамилия</span>
        <input
          disabled={disabled}
          onChange={(event) => updateDraft("lastName", event.target.value)}
          type="text"
          value={draft.lastName}
        />
      </label>

      <label className="event-form-field">
        <span>Отображаемое имя</span>
        <input
          disabled={disabled}
          onChange={(event) => updateDraft("displayName", event.target.value)}
          type="text"
          value={draft.displayName}
        />
      </label>

      <label className="event-form-field">
        <span>Еврейское имя</span>
        <input
          disabled={disabled}
          onChange={(event) => updateDraft("hebrewName", event.target.value)}
          type="text"
          value={draft.hebrewName}
        />
      </label>

      <label className="event-form-field">
        <span>Email профиля</span>
        <input
          disabled={disabled}
          onChange={(event) => updateDraft("email", event.target.value)}
          type="text"
          value={draft.email}
        />
      </label>

      <label className="event-form-field">
        <span>Телефон</span>
        <input
          disabled={disabled}
          onChange={(event) => updateDraft("phone", event.target.value)}
          type="tel"
          value={draft.phone}
        />
      </label>

      <label className="event-form-field">
        <span>Город</span>
        <input
          disabled={disabled}
          onChange={(event) => updateDraft("city", event.target.value)}
          type="text"
          value={draft.city}
        />
      </label>

      <label className="event-form-field">
        <span>Дата рождения</span>
        <input
          disabled={disabled}
          onChange={(event) => updateDraft("birthDate", event.target.value)}
          type="date"
          value={draft.birthDate}
        />
      </label>

      <label className="event-form-field">
        <span>Время рождения</span>
        <select
          disabled={disabled}
          onChange={(event) =>
            updateDraft(
              "birthTimeContext",
              event.target.value as AdminMemberBirthTimeContext,
            )
          }
          value={draft.birthTimeContext}
        >
          {ADMIN_MEMBER_BIRTH_TIME_CONTEXT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="event-form-field">
        <span>Нусах</span>
        <input
          disabled={disabled}
          onChange={(event) => updateDraft("nusach", event.target.value)}
          type="text"
          value={draft.nusach}
        />
      </label>

      <label className="event-form-field">
        <span>Статус происхождения</span>
        <select
          disabled={disabled}
          onChange={(event) =>
            updateDraft(
              "tribeStatus",
              event.target.value as AdminMemberTribeStatus | "",
            )
          }
          value={draft.tribeStatus}
        >
          <option value="">Не указано</option>
          {ADMIN_MEMBER_TRIBE_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="event-form-field">
        <span>Семейное положение</span>
        <select
          disabled={disabled}
          onChange={(event) =>
            updateDraft(
              "maritalStatus",
              event.target.value as AdminMemberMaritalStatus | "",
            )
          }
          value={draft.maritalStatus}
        >
          <option value="">Не указано</option>
          {ADMIN_MEMBER_MARITAL_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="event-form-field">
        <span>Онбординг завершён</span>
        <select
          disabled={disabled}
          onChange={(event) =>
            updateDraft("onboardingCompleted", event.target.value === "true")
          }
          value={draft.onboardingCompleted ? "true" : "false"}
        >
          <option value="true">Да</option>
          <option value="false">Нет</option>
        </select>
      </label>

      <label className="event-form-field event-form-field--wide">
        <span>Еврейская дата рождения (JSON)</span>
        <textarea
          disabled={disabled}
          onChange={(event) =>
            updateDraft("hebrewBirthDate", event.target.value)
          }
          placeholder='{"day":10,"monthNameRu":"Хешван","year":5746}'
          value={draft.hebrewBirthDate}
        />
      </label>

      <label className="event-form-field event-form-field--wide">
        <span>О себе</span>
        <textarea
          disabled={disabled}
          maxLength={200}
          onChange={(event) => updateDraft("about", event.target.value)}
          value={draft.about}
        />
      </label>
    </div>
  );
}

export function createAdminMemberProfileDraft(
  member: AdminMemberListRow,
  profile: AdminMemberProfile | null,
): AdminMemberProfileDraft {
  const detail = profile ?? member;

  return {
    about: profile?.about ?? "",
    birthDate: formatDateInputValue(detail.birthDate),
    birthTimeContext: normalizeBirthTimeContextDraft(profile?.birthTimeContext),
    city: detail.city ?? "",
    displayName: detail.displayName ?? "",
    email: detail.email ?? "",
    firstName: detail.firstName ?? "",
    fullName: profile?.fullName ?? "",
    hebrewBirthDate: formatJsonForEdit(detail.hebrewBirthDate),
    hebrewName: profile?.hebrewName ?? "",
    lastName: detail.lastName ?? "",
    maritalStatus: normalizeMaritalStatusDraft(profile?.maritalStatus),
    nusach: detail.nusach ?? "",
    onboardingCompleted: detail.onboardingCompleted,
    phone: detail.phone ?? "",
    tribeStatus: normalizeTribeStatusDraft(profile?.tribeStatus),
  };
}

export function buildAdminMemberProfileUpdateFields(
  detail: AdminMemberListRow | AdminMemberProfile,
  draft: AdminMemberProfileDraft,
): AdminMemberProfileUpdateFieldsResult {
  const hebrewBirthDateResult = parseHebrewBirthDateDraft(draft.hebrewBirthDate);

  if (!hebrewBirthDateResult.ok) {
    return hebrewBirthDateResult;
  }

  const fields: AdminUpdateUserProfileFields = {};
  const currentFullName = "fullName" in detail ? detail.fullName : null;
  const currentHebrewName = "hebrewName" in detail ? detail.hebrewName : null;
  const currentBirthTimeContext =
    "birthTimeContext" in detail ? detail.birthTimeContext : null;
  const currentTribeStatus = "tribeStatus" in detail ? detail.tribeStatus : null;
  const currentMaritalStatus =
    "maritalStatus" in detail ? detail.maritalStatus : null;
  const currentAbout = "about" in detail ? detail.about : null;

  const fullName = nullableTrimmedString(draft.fullName);
  if (fullName !== nullableTrimmedString(currentFullName)) {
    fields.fullName = fullName;
  }

  const firstName = nullableTrimmedString(draft.firstName);
  if (firstName !== nullableTrimmedString(detail.firstName)) {
    fields.firstName = firstName;
  }

  const lastName = nullableTrimmedString(draft.lastName);
  if (lastName !== nullableTrimmedString(detail.lastName)) {
    fields.lastName = lastName;
  }

  const displayName = nullableTrimmedString(draft.displayName);
  if (displayName !== nullableTrimmedString(detail.displayName)) {
    fields.displayName = displayName;
  }

  const hebrewName = nullableTrimmedString(draft.hebrewName);
  if (hebrewName !== nullableTrimmedString(currentHebrewName)) {
    fields.hebrewName = hebrewName;
  }

  const email = nullableTrimmedString(draft.email);
  if (email !== nullableTrimmedString(detail.email)) {
    fields.email = email;
  }

  const phone = nullableTrimmedString(draft.phone);
  if (phone !== nullableTrimmedString(detail.phone)) {
    fields.phone = phone;
  }

  const city = nullableTrimmedString(draft.city);
  if (city !== nullableTrimmedString(detail.city)) {
    fields.city = city;
  }

  const birthDate = nullableTrimmedString(draft.birthDate);
  if (birthDate !== nullableTrimmedString(formatDateInputValue(detail.birthDate))) {
    fields.birthDate = birthDate;
  }

  if (!areJsonRecordsEqual(hebrewBirthDateResult.value, detail.hebrewBirthDate)) {
    fields.hebrewBirthDate = hebrewBirthDateResult.value;
  }

  if (
    draft.birthTimeContext !==
    normalizeBirthTimeContextDraft(currentBirthTimeContext)
  ) {
    fields.birthTimeContext = draft.birthTimeContext;
  }

  const nusach = nullableTrimmedString(draft.nusach);
  if (nusach !== nullableTrimmedString(detail.nusach)) {
    fields.nusach = nusach;
  }

  const tribeStatus = draft.tribeStatus || null;
  if (tribeStatus !== (normalizeTribeStatusDraft(currentTribeStatus) || null)) {
    fields.tribeStatus = tribeStatus;
  }

  const maritalStatus = draft.maritalStatus || null;
  if (
    maritalStatus !== (normalizeMaritalStatusDraft(currentMaritalStatus) || null)
  ) {
    fields.maritalStatus = maritalStatus;
  }

  const about = nullableTrimmedString(draft.about);
  if (about !== nullableTrimmedString(currentAbout)) {
    fields.about = about;
  }

  if (draft.onboardingCompleted !== detail.onboardingCompleted) {
    fields.onboardingCompleted = draft.onboardingCompleted;
  }

  return { fields, ok: true };
}

function parseHebrewBirthDateDraft(
  value: string,
): { ok: true; value: Record<string, unknown> | null } | { error: string; ok: false } {
  const normalized = value.trim();

  if (!normalized) {
    return { ok: true, value: null };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(normalized) as unknown;
  } catch {
    return {
      error:
        "Еврейская дата рождения должна быть корректным JSON-объектом.",
      ok: false,
    };
  }

  if (!isRecord(parsed)) {
    return {
      error:
        "Еврейская дата рождения должна быть JSON-объектом или пустым значением.",
      ok: false,
    };
  }

  return { ok: true, value: parsed };
}

function nullableTrimmedString(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";

  return normalized.length > 0 ? normalized : null;
}

function formatDateInputValue(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  const dateMatch = value.match(/^\d{4}-\d{2}-\d{2}/);

  if (dateMatch) {
    return dateMatch[0];
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 10);
}

function formatJsonForEdit(value: Record<string, unknown> | null): string {
  if (!value) {
    return "";
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

function areJsonRecordsEqual(
  left: Record<string, unknown> | null,
  right: Record<string, unknown> | null,
): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function normalizeBirthTimeContextDraft(
  value: string | null | undefined,
): AdminMemberBirthTimeContext {
  return ADMIN_MEMBER_BIRTH_TIME_CONTEXT_OPTIONS.some(
    (option) => option.value === value,
  )
    ? (value as AdminMemberBirthTimeContext)
    : "unknown";
}

function normalizeTribeStatusDraft(
  value: string | null | undefined,
): AdminMemberTribeStatus | "" {
  return ADMIN_MEMBER_TRIBE_STATUS_OPTIONS.some((option) => option.value === value)
    ? (value as AdminMemberTribeStatus)
    : "";
}

function normalizeMaritalStatusDraft(
  value: string | null | undefined,
): AdminMemberMaritalStatus | "" {
  return ADMIN_MEMBER_MARITAL_STATUS_OPTIONS.some(
    (option) => option.value === value,
  )
    ? (value as AdminMemberMaritalStatus)
    : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
