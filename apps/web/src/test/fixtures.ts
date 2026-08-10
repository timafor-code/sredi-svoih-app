import type { WebEventRegistrationFormResponse, WebRegistrationState } from "../types";

export const EVENT_ID = "11111111-1111-4111-8111-111111111111";
export const PUBLIC_SLUG = "shabbat-dlya-druzey";
export const OCCURRENCE_ONE_ID = "22222222-2222-4222-8222-222222222222";
export const OCCURRENCE_TWO_ID = "33333333-3333-4333-8333-333333333333";
export const OPTION_ID = "44444444-4444-4444-8444-444444444444";
export const QUESTIONNAIRE_FORM_ID = "77777777-7777-4777-8777-777777777777";
export const QUESTION_IDS = {
  short: "88888888-8888-4888-8888-888888888881",
  long: "88888888-8888-4888-8888-888888888882",
  single: "88888888-8888-4888-8888-888888888883",
  multi: "88888888-8888-4888-8888-888888888884",
  boolean: "88888888-8888-4888-8888-888888888885",
};

export function eventResponse(
  registrationState: WebRegistrationState = "open",
): WebEventRegistrationFormResponse {
  return {
    canonical_public_path: `/events/${PUBLIC_SLUG}`,
    resolved_from_alias: false,
    event: {
      id: EVENT_ID,
      title: "Шаббат для друзей",
      subtitle: "Тёплая встреча общины",
      description: "Полное описание\nсо второй строкой.",
      short_description: "Короткое описание",
      starts_at: "2026-09-12T15:00:00+03:00",
      ends_at: "2026-09-12T18:00:00+03:00",
      timezone: "Europe/Moscow",
      location_name: "Общинный центр",
      address: "Москва",
      image_url: "https://images.example.test/event.jpg",
      category: "community",
      capacity: 40,
      waitlist_enabled: false,
      requires_approval: false,
    },
    registration_state: registrationState,
    occurrences: [],
    participation_options: [
      {
        id: OPTION_ID,
        event_id: EVENT_ID,
        title: "Основное участие",
        description: "Одно место",
        price_amount: 0,
        price_currency: "RUB",
        option_type: "participation",
        seat_limit: null,
        allow_quantity: false,
        min_quantity: 1,
        max_quantity: 1,
        counts_toward_capacity: true,
        group_key: null,
        sort_order: 0,
      },
    ],
    legal_documents: [
      {
        id: "55555555-5555-4555-8555-555555555555",
        document_type: "event_registration_consent",
        version: "1.0",
        title: "Согласие на регистрацию",
        content_hash: "consent-hash",
        published_url: "https://legal.example.test/consent",
        effective_at: "2026-08-01T00:00:00+03:00",
      },
      {
        id: "66666666-6666-4666-8666-666666666666",
        document_type: "privacy_policy",
        version: "2.1",
        title: "Политика конфиденциальности",
        content_hash: "privacy-hash",
        published_url: "https://legal.example.test/privacy",
        effective_at: "2026-08-01T00:00:00+03:00",
      },
    ],
    questionnaire_form_id: null,
    questions: [],
  };
}

export function responseWithOccurrences(): WebEventRegistrationFormResponse {
  const data = eventResponse("closed");
  data.occurrences = [
    {
      id: OCCURRENCE_ONE_ID,
      event_id: EVENT_ID,
      title: "Пятница",
      starts_at: "2026-09-11T18:00:00+03:00",
      ends_at: "2026-09-11T21:00:00+03:00",
      timezone: "Europe/Moscow",
      registration_opens_at: null,
      registration_closes_at: null,
      capacity: 20,
      waitlist_enabled: false,
      requires_approval: false,
      registration_state: "closed",
    },
    {
      id: OCCURRENCE_TWO_ID,
      event_id: EVENT_ID,
      title: "Суббота",
      starts_at: "2026-09-12T18:00:00+03:00",
      ends_at: "2026-09-12T21:00:00+03:00",
      timezone: "Europe/Moscow",
      registration_opens_at: null,
      registration_closes_at: null,
      capacity: 20,
      waitlist_enabled: false,
      requires_approval: false,
      registration_state: "open",
    },
  ];
  return data;
}

export function responseWithQuestionnaire(): WebEventRegistrationFormResponse {
  const data = eventResponse();
  data.questionnaire_form_id = QUESTIONNAIRE_FORM_ID;
  data.questions = [
    {
      id: QUESTION_IDS.short,
      field_key: "arrival_code",
      field_type: "short_text",
      label: "Код встречи",
      required: true,
      purpose: "Организовать встречу у входа",
      retention_days: 7,
      options: [],
      validation: { min_length: 2, max_length: 5 },
      sort_order: 0,
    },
    {
      id: QUESTION_IDS.long,
      field_key: "arrival_note",
      field_type: "long_text",
      label: "Комментарий по прибытию",
      required: false,
      purpose: "Учесть обычные организационные детали",
      retention_days: 8,
      options: [],
      validation: { min_length: 2, max_length: 40 },
      sort_order: 1,
    },
    {
      id: QUESTION_IDS.single,
      field_key: "entrance",
      field_type: "single_select",
      label: "Выберите вход",
      required: true,
      purpose: "Распределить поток участников",
      retention_days: 9,
      options: [{ value: "north", label: "Северный" }, { value: "south", label: "Южный" }],
      validation: {},
      sort_order: 2,
    },
    {
      id: QUESTION_IDS.multi,
      field_key: "sessions",
      field_type: "multi_select",
      label: "Выберите сессии",
      required: true,
      purpose: "Подготовить аудитории",
      retention_days: 10,
      options: [{ value: "one", label: "Первая" }, { value: "two", label: "Вторая" }, { value: "three", label: "Третья" }],
      validation: { min_selections: 1, max_selections: 2 },
      sort_order: 3,
    },
    {
      id: QUESTION_IDS.boolean,
      field_key: "needs_badge",
      field_type: "boolean",
      label: "Нужен бейдж?",
      required: true,
      purpose: "Подготовить бейджи",
      retention_days: 11,
      options: [],
      validation: {},
      sort_order: 4,
    },
  ];
  return data;
}
