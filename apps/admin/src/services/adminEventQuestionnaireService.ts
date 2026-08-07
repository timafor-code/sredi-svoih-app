import { apiClient } from "./apiClient";
import type {
  AdminEventQuestionnaire,
  EventQuestionnaireDraftFieldInput,
  EventQuestionnaireDraftInput,
  EventQuestionnaireField,
  EventQuestionnaireFieldType,
  EventQuestionnaireForm,
  EventQuestionnaireOption,
  EventQuestionnaireStatus,
  EventQuestionnaireValidation,
} from "../types/eventQuestionnaires";

type JsonRecord = Record<string, unknown>;

const FIELD_TYPES = new Set<EventQuestionnaireFieldType>([
  "short_text",
  "long_text",
  "single_select",
  "multi_select",
  "boolean",
]);

const STATUSES = new Set<EventQuestionnaireStatus>([
  "draft",
  "published",
  "retired",
]);

function contractError(path: string): Error {
  return new Error(`Некорректный ответ API анкеты: ${path}.`);
}

function record(value: unknown, path: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw contractError(path);
  }
  return value as JsonRecord;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string") throw contractError(path);
  return value;
}

function nullableString(value: unknown, path: string): string | null {
  if (value === null) return null;
  return string(value, path);
}

function integer(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw contractError(path);
  }
  return value;
}

function boundedInteger(value: unknown, path: string, minimum: number, maximum: number): number {
  const normalized = integer(value, path);
  if (normalized < minimum || normalized > maximum) throw contractError(path);
  return normalized;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw contractError(path);
  return value;
}

function fieldType(value: unknown, path: string): EventQuestionnaireFieldType {
  if (typeof value !== "string" || !FIELD_TYPES.has(value as EventQuestionnaireFieldType)) {
    throw contractError(`${path} (неподдерживаемый тип)`);
  }
  return value as EventQuestionnaireFieldType;
}

function status(value: unknown, path: string): EventQuestionnaireStatus {
  if (typeof value !== "string" || !STATUSES.has(value as EventQuestionnaireStatus)) {
    throw contractError(`${path} (неподдерживаемый статус)`);
  }
  return value as EventQuestionnaireStatus;
}

function option(value: unknown, path: string): EventQuestionnaireOption {
  const row = record(value, path);
  const normalizedValue = string(row.value, `${path}.value`);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(normalizedValue)) {
    throw contractError(`${path}.value`);
  }
  return {
    value: normalizedValue,
    label: string(row.label, `${path}.label`),
  };
}

function validation(
  value: unknown,
  type: EventQuestionnaireFieldType,
  path: string,
): EventQuestionnaireValidation {
  const row = record(value, path);
  const allowed = type === "short_text" || type === "long_text"
    ? new Set(["min_length", "max_length"])
    : type === "multi_select"
      ? new Set(["min_selections", "max_selections"])
      : new Set<string>();

  for (const key of Object.keys(row)) {
    if (!allowed.has(key)) throw contractError(`${path}.${key} (неподдерживаемое правило)`);
  }

  const normalized: EventQuestionnaireValidation = {};
  if ("min_length" in row) {
    normalized.minLength = boundedInteger(row.min_length, `${path}.min_length`, 0, 10000);
  }
  if ("max_length" in row) {
    normalized.maxLength = boundedInteger(row.max_length, `${path}.max_length`, 0, 10000);
  }
  if ("min_selections" in row) {
    normalized.minSelections = boundedInteger(row.min_selections, `${path}.min_selections`, 0, 10000);
  }
  if ("max_selections" in row) {
    normalized.maxSelections = boundedInteger(row.max_selections, `${path}.max_selections`, 0, 10000);
  }
  return normalized;
}

function questionnaireField(value: unknown, path: string): EventQuestionnaireField {
  const row = record(value, path);
  const normalizedType = fieldType(row.field_type, `${path}.field_type`);
  if (row.data_category !== "ordinary") {
    throw contractError(`${path}.data_category (неподдерживаемая категория)`);
  }
  if (!Array.isArray(row.options)) throw contractError(`${path}.options`);
  const normalizedOptions = row.options.map((item, index) => option(item, `${path}.options[${index}]`));
  const normalizedFieldKey = string(row.field_key, `${path}.field_key`);
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(normalizedFieldKey)) {
    throw contractError(`${path}.field_key`);
  }
  if (
    (normalizedType === "single_select" || normalizedType === "multi_select")
    && normalizedOptions.length === 0
  ) {
    throw contractError(`${path}.options`);
  }
  if (
    normalizedType !== "single_select"
    && normalizedType !== "multi_select"
    && normalizedOptions.length > 0
  ) {
    throw contractError(`${path}.options`);
  }
  if (new Set(normalizedOptions.map((item) => item.value)).size !== normalizedOptions.length) {
    throw contractError(`${path}.options (повторяющиеся значения)`);
  }
  const normalizedValidation = validation(row.validation, normalizedType, `${path}.validation`);
  const minimum = normalizedType === "multi_select"
    ? normalizedValidation.minSelections
    : normalizedValidation.minLength;
  const maximum = normalizedType === "multi_select"
    ? normalizedValidation.maxSelections
    : normalizedValidation.maxLength;
  if (minimum !== undefined && maximum !== undefined && maximum < minimum) {
    throw contractError(`${path}.validation`);
  }
  if (
    normalizedType === "multi_select"
    && (
      (minimum !== undefined && minimum > normalizedOptions.length)
      || (maximum !== undefined && maximum > normalizedOptions.length)
    )
  ) {
    throw contractError(`${path}.validation`);
  }

  return {
    id: string(row.id, `${path}.id`),
    fieldKey: normalizedFieldKey,
    fieldType: normalizedType,
    label: string(row.label, `${path}.label`),
    required: boolean(row.required, `${path}.required`),
    purpose: string(row.purpose, `${path}.purpose`),
    retentionDays: boundedInteger(row.retention_days, `${path}.retention_days`, 1, 36500),
    options: normalizedOptions,
    validation: normalizedValidation,
    dataCategory: "ordinary",
    sortOrder: boundedInteger(row.sort_order, `${path}.sort_order`, 0, 100000),
  };
}

function form(value: unknown, path: string): EventQuestionnaireForm {
  const row = record(value, path);
  if (row.channel !== "web") throw contractError(`${path}.channel`);
  if (!Array.isArray(row.fields)) throw contractError(`${path}.fields`);

  const fields = row.fields
    .map((item, index) => questionnaireField(item, `${path}.fields[${index}]`))
    .sort((left, right) => left.sortOrder - right.sortOrder);
  if (new Set(fields.map((field) => field.fieldKey)).size !== fields.length) {
    throw contractError(`${path}.fields (повторяющиеся ключи)`);
  }

  return {
    id: string(row.id, `${path}.id`),
    eventId: string(row.event_id, `${path}.event_id`),
    channel: "web",
    version: boundedInteger(row.version, `${path}.version`, 1, Number.MAX_SAFE_INTEGER),
    purpose: string(row.purpose, `${path}.purpose`),
    status: status(row.status, `${path}.status`),
    publishedAt: nullableString(row.published_at, `${path}.published_at`),
    createdAt: string(row.created_at, `${path}.created_at`),
    updatedAt: string(row.updated_at, `${path}.updated_at`),
    fields,
  };
}

function normalizeResponse(value: unknown): AdminEventQuestionnaire {
  const row = record(value, "response");
  if (row.channel !== "web") throw contractError("response.channel");

  const draft = row.draft === null ? null : form(row.draft, "response.draft");
  const published = row.published === null
    ? null
    : form(row.published, "response.published");

  if (draft && draft.status !== "draft") throw contractError("response.draft.status");
  if (published && published.status !== "published") {
    throw contractError("response.published.status");
  }

  return {
    eventId: string(row.event_id, "response.event_id"),
    channel: "web",
    draft,
    published,
  };
}

function validationPayload(field: EventQuestionnaireDraftFieldInput): Record<string, number> {
  if (field.fieldType === "short_text" || field.fieldType === "long_text") {
    return {
      ...(field.validation.minLength === undefined ? {} : { min_length: field.validation.minLength }),
      ...(field.validation.maxLength === undefined ? {} : { max_length: field.validation.maxLength }),
    };
  }
  if (field.fieldType === "multi_select") {
    return {
      ...(field.validation.minSelections === undefined
        ? {}
        : { min_selections: field.validation.minSelections }),
      ...(field.validation.maxSelections === undefined
        ? {}
        : { max_selections: field.validation.maxSelections }),
    };
  }
  return {};
}

function draftPayload(input: EventQuestionnaireDraftInput) {
  return {
    purpose: input.purpose,
    fields: input.fields.map((field) => ({
      field_key: field.fieldKey,
      field_type: field.fieldType,
      label: field.label,
      required: field.required,
      purpose: field.purpose,
      retention_days: field.retentionDays,
      options: field.fieldType === "single_select" || field.fieldType === "multi_select"
        ? field.options.map((item) => ({ value: item.value, label: item.label }))
        : [],
      validation: validationPayload(field),
      data_category: "ordinary" as const,
      sort_order: field.sortOrder,
    })),
  };
}

export async function getAdminEventQuestionnaire(
  eventId: string,
): Promise<AdminEventQuestionnaire> {
  const response = await apiClient.get<unknown>(
    `/admin/events/${encodeURIComponent(eventId)}/web-questionnaire`,
  );
  return normalizeResponse(response);
}

export async function saveAdminEventQuestionnaireDraft(
  eventId: string,
  input: EventQuestionnaireDraftInput,
): Promise<AdminEventQuestionnaire> {
  const response = await apiClient.put<unknown, ReturnType<typeof draftPayload>>(
    `/admin/events/${encodeURIComponent(eventId)}/web-questionnaire/draft`,
    draftPayload(input),
  );
  return normalizeResponse(response);
}

export async function publishAdminEventQuestionnaire(
  eventId: string,
): Promise<AdminEventQuestionnaire> {
  const response = await apiClient.post<unknown, undefined>(
    `/admin/events/${encodeURIComponent(eventId)}/web-questionnaire/publish`,
    undefined,
  );
  return normalizeResponse(response);
}
