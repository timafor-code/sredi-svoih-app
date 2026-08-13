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
  email: string;
  firstName: string;
  hebrewBirthDateDay: string;
  hebrewBirthDateMonthNameRu: string;
  hebrewBirthDateOriginal: Record<string, unknown> | null;
  hebrewBirthDateRecognized: boolean;
  hebrewBirthDateTouched: boolean;
  hebrewBirthDateYear: string;
  hebrewName: string;
  lastName: string;
  maritalStatus: AdminMemberMaritalStatus | "";
  nusach: string;
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

const HEBREW_MONTH_NAMES_RU = [
  "Нисан",
  "Ияр",
  "Сиван",
  "Тамуз",
  "Ав",
  "Элул",
  "Тишрей",
  "Хешван",
  "Кислев",
  "Тевет",
  "Шват",
  "Адар",
  "Адар I",
  "Адар II",
] as const;

type HebrewMonthNameRu = (typeof HEBREW_MONTH_NAMES_RU)[number];

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

  const updateHebrewBirthDate = (
    key:
      | "hebrewBirthDateDay"
      | "hebrewBirthDateMonthNameRu"
      | "hebrewBirthDateYear",
    value: string,
  ) => {
    onChange({
      ...draft,
      [key]: value,
      hebrewBirthDateTouched: true,
    });
  };

  const clearHebrewBirthDate = () => {
    onChange({
      ...draft,
      hebrewBirthDateDay: "",
      hebrewBirthDateMonthNameRu: "",
      hebrewBirthDateTouched: true,
      hebrewBirthDateYear: "",
    });
  };

  return (
    <div className="member-detail-grid">
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
        <span>Еврейское имя</span>
        <input
          disabled={disabled}
          onChange={(event) => updateDraft("hebrewName", event.target.value)}
          type="text"
          value={draft.hebrewName}
        />
      </label>

      <label className="event-form-field">
        <span>Email для связи</span>
        <input
          disabled={disabled}
          onChange={(event) => updateDraft("email", event.target.value)}
          type="email"
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

      <fieldset
        className="member-hebrew-date-editor event-form-field--wide"
        disabled={disabled}
      >
        <legend>Еврейская дата рождения</legend>
        <div className="member-hebrew-date-editor__fields">
          <label className="event-form-field">
            <span>День</span>
            <input
              max="30"
              min="1"
              onChange={(event) =>
                updateHebrewBirthDate("hebrewBirthDateDay", event.target.value)
              }
              step="1"
              type="number"
              value={draft.hebrewBirthDateDay}
            />
          </label>

          <label className="event-form-field">
            <span>Месяц</span>
            <select
              onChange={(event) =>
                updateHebrewBirthDate(
                  "hebrewBirthDateMonthNameRu",
                  event.target.value,
                )
              }
              value={draft.hebrewBirthDateMonthNameRu}
            >
              <option value="">Не указан</option>
              {HEBREW_MONTH_NAMES_RU.map((monthName) => (
                <option key={monthName} value={monthName}>
                  {monthName}
                </option>
              ))}
            </select>
          </label>

          <label className="event-form-field">
            <span>Год</span>
            <input
              min="1"
              onChange={(event) =>
                updateHebrewBirthDate("hebrewBirthDateYear", event.target.value)
              }
              step="1"
              type="number"
              value={draft.hebrewBirthDateYear}
            />
          </label>
        </div>

        {draft.hebrewBirthDateOriginal &&
        !draft.hebrewBirthDateRecognized &&
        !draft.hebrewBirthDateTouched ? (
          <p className="member-hebrew-date-editor__note">
            Сохранено значение прежнего формата. Заполните дату заново или
            очистите её; без изменений существующее значение будет сохранено.
          </p>
        ) : null}

        <button
          className="member-hebrew-date-editor__clear"
          onClick={clearHebrewBirthDate}
          type="button"
        >
          Очистить дату
        </button>
      </fieldset>

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
  const structuredHebrewBirthDate = readStructuredHebrewBirthDate(
    detail.hebrewBirthDate,
  );

  return {
    about: profile?.about ?? "",
    birthDate: formatDateInputValue(detail.birthDate),
    birthTimeContext: normalizeBirthTimeContextDraft(profile?.birthTimeContext),
    city: detail.city ?? "",
    email: detail.email ?? "",
    firstName: detail.firstName ?? "",
    hebrewBirthDateDay: structuredHebrewBirthDate?.day.toString() ?? "",
    hebrewBirthDateMonthNameRu:
      structuredHebrewBirthDate?.monthNameRu ?? "",
    hebrewBirthDateOriginal: detail.hebrewBirthDate,
    hebrewBirthDateRecognized: structuredHebrewBirthDate !== null,
    hebrewBirthDateTouched: false,
    hebrewBirthDateYear: structuredHebrewBirthDate?.year.toString() ?? "",
    hebrewName: profile?.hebrewName ?? "",
    lastName: detail.lastName ?? "",
    maritalStatus: normalizeMaritalStatusDraft(profile?.maritalStatus),
    nusach: detail.nusach ?? "",
    phone: detail.phone ?? "",
    tribeStatus: normalizeTribeStatusDraft(profile?.tribeStatus),
  };
}

export function buildAdminMemberProfileUpdateFields(
  detail: AdminMemberListRow | AdminMemberProfile,
  draft: AdminMemberProfileDraft,
): AdminMemberProfileUpdateFieldsResult {
  const hebrewBirthDateResult = buildHebrewBirthDateUpdate(draft);

  if (!hebrewBirthDateResult.ok) {
    return hebrewBirthDateResult;
  }

  const fields: AdminUpdateUserProfileFields = {};
  const currentHebrewName = "hebrewName" in detail ? detail.hebrewName : null;
  const currentBirthTimeContext =
    "birthTimeContext" in detail ? detail.birthTimeContext : null;
  const currentTribeStatus = "tribeStatus" in detail ? detail.tribeStatus : null;
  const currentMaritalStatus =
    "maritalStatus" in detail ? detail.maritalStatus : null;
  const currentAbout = "about" in detail ? detail.about : null;

  const firstName = nullableTrimmedString(draft.firstName);
  if (firstName !== nullableTrimmedString(detail.firstName)) {
    fields.firstName = firstName;
  }

  const lastName = nullableTrimmedString(draft.lastName);
  if (lastName !== nullableTrimmedString(detail.lastName)) {
    fields.lastName = lastName;
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

  if (
    hebrewBirthDateResult.changed &&
    !areJsonRecordsEqual(hebrewBirthDateResult.value, detail.hebrewBirthDate)
  ) {
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

  return { fields, ok: true };
}

function buildHebrewBirthDateUpdate(
  draft: AdminMemberProfileDraft,
):
  | { changed: boolean; ok: true; value: Record<string, unknown> | null }
  | { error: string; ok: false } {
  if (!draft.hebrewBirthDateTouched) {
    return {
      changed: false,
      ok: true,
      value: draft.hebrewBirthDateOriginal,
    };
  }

  const dayText = draft.hebrewBirthDateDay.trim();
  const monthNameRu = draft.hebrewBirthDateMonthNameRu.trim();
  const yearText = draft.hebrewBirthDateYear.trim();

  if (!dayText && !monthNameRu && !yearText) {
    return { changed: true, ok: true, value: null };
  }

  if (!dayText || !monthNameRu || !yearText) {
    return {
      error: "Укажите день, месяц и год еврейской даты рождения.",
      ok: false,
    };
  }

  if (!/^\d+$/.test(dayText)) {
    return {
      error: "День еврейской даты должен быть целым числом от 1 до 30.",
      ok: false,
    };
  }
  const day = Number(dayText);
  if (day < 1 || day > 30) {
    return {
      error: "День еврейской даты должен быть целым числом от 1 до 30.",
      ok: false,
    };
  }

  if (!isHebrewMonthNameRu(monthNameRu)) {
    return {
      error: "Выберите месяц еврейской даты из списка.",
      ok: false,
    };
  }

  if (!/^\d+$/.test(yearText) || Number(yearText) < 1) {
    return {
      error: "Год еврейской даты должен быть положительным целым числом.",
      ok: false,
    };
  }
  const year = Number(yearText);

  return {
    changed: true,
    ok: true,
    value: {
      ...(draft.hebrewBirthDateOriginal ?? {}),
      day,
      labelRu: `${day} ${monthNameRu} ${year}`,
      monthNameRu,
      year,
    },
  };
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

function readStructuredHebrewBirthDate(
  value: Record<string, unknown> | null,
): { day: number; monthNameRu: string; year: number } | null {
  if (!value) {
    return null;
  }

  const { day, monthNameRu, year } = value;
  if (
    typeof day !== "number" ||
    !Number.isInteger(day) ||
    day < 1 ||
    day > 30 ||
    typeof monthNameRu !== "string" ||
    !isHebrewMonthNameRu(monthNameRu) ||
    typeof year !== "number" ||
    !Number.isInteger(year) ||
    year < 1
  ) {
    return null;
  }

  return {
    day,
    monthNameRu,
    year,
  };
}

function isHebrewMonthNameRu(value: string): value is HebrewMonthNameRu {
  return HEBREW_MONTH_NAMES_RU.includes(value as HebrewMonthNameRu);
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
