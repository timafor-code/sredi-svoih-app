import type {
  MyRegistration,
  WebEventRegistrationFormResponse,
  WebRegistrationState,
} from "../types";

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

type MyRegistrationOverrides = Partial<Omit<MyRegistration, "event" | "occurrence">> & {
  event?: Partial<MyRegistration["event"]>;
  occurrence?: Partial<NonNullable<MyRegistration["occurrence"]>> | null;
};

export function myRegistration(overrides: MyRegistrationOverrides = {}): MyRegistration {
  const event: MyRegistration["event"] = {
    id: EVENT_ID,
    community_id: "99999999-9999-4999-8999-999999999999",
    event_kind: "shabbat",
    title: "Шаббат для друзей",
    subtitle: "Тёплая встреча общины",
    description: "Описание",
    short_description: "Короткое описание",
    starts_at: "2026-09-12T15:00:00+03:00",
    ends_at: "2026-09-12T18:00:00+03:00",
    is_permanent: false,
    timezone: "Europe/Moscow",
    location_name: "Общинный центр",
    address: "Москва, ул. Примерная, 1",
    latitude: null,
    longitude: null,
    image_url: null,
    category: "community",
    audience: null,
    visibility: "public",
    status: "published",
    source_url: null,
    registration_mode: "internal_paid",
    registration_url: null,
    capacity: 40,
    waitlist_enabled: false,
    requires_approval: false,
    price_amount: 1500,
    price_currency: "RUB",
    published_at: "2026-08-01T00:00:00+03:00",
    created_at: "2026-08-01T00:00:00+03:00",
    updated_at: "2026-08-01T00:00:00+03:00",
    ...overrides.event,
  };
  const occurrence = overrides.occurrence === undefined
    ? null
    : overrides.occurrence === null
      ? null
      : {
        id: OCCURRENCE_TWO_ID,
        event_id: EVENT_ID,
        title: "Суббота",
        starts_at: "2026-09-12T15:00:00+03:00",
        ends_at: "2026-09-12T18:00:00+03:00",
        timezone: "Europe/Moscow",
        registration_opens_at: null,
        registration_closes_at: null,
        capacity: 20,
        waitlist_enabled: false,
        requires_approval: false,
        status: "active",
        sort_order: 0,
        created_at: "2026-08-01T00:00:00+03:00",
        updated_at: "2026-08-01T00:00:00+03:00",
        ...overrides.occurrence,
      };

  return {
    id: REGISTRATION_FIXTURE_ID,
    event_id: event.id,
    occurrence_id: occurrence?.id ?? null,
    user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    status: "confirmed",
    seats_count: 2,
    guest_names: ["Мария Иванова"],
    comment: null,
    registered_at: "2026-08-12T10:00:00+03:00",
    confirmed_at: "2026-08-12T10:01:00+03:00",
    cancelled_at: null,
    payment_status: "pending",
    payment_id: null,
    created_at: "2026-08-12T10:00:00+03:00",
    updated_at: "2026-08-12T10:01:00+03:00",
    event,
    occurrence,
    selected_options: [{
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      option_id: OPTION_ID,
      title_snapshot: "Основное участие",
      description_snapshot: "Одно место",
      option_type_snapshot: "participation",
      quantity: 2,
      unit_price_amount: 1500,
      total_amount: 3000,
      currency: "RUB",
      counts_toward_capacity: true,
      seats_count: 2,
      is_donation: false,
      created_at: "2026-08-12T10:00:00+03:00",
    }],
    capacity_reservations: [{
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      capacity_unit_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      option_id: OPTION_ID,
      capacity_unit_key_snapshot: "seat",
      capacity_unit_title_snapshot: "Место",
      option_title_snapshot: "Основное участие",
      quantity: 2,
      seats_per_quantity: 1,
      seats_count: 2,
      created_at: "2026-08-12T10:00:00+03:00",
    }],
    total_amount: 3000,
    total_currency: "RUB",
    ...Object.fromEntries(
      Object.entries(overrides).filter(([key]) => key !== "event" && key !== "occurrence"),
    ),
  } as MyRegistration;
}

export const REGISTRATION_FIXTURE_ID = "77777777-7777-4777-8777-777777777700";

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
      registration_mode: "internal_free",
      capacity: 40,
      waitlist_enabled: false,
      requires_approval: false,
    },
    registration_state: registrationState,
    occurrence_selection_mode: "none",
    default_occurrence_id: null,
    next_registration_state_check_at: null,
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
        is_donation: false,
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

export function responseWithPaidOptions(): WebEventRegistrationFormResponse {
  const data = eventResponse();
  const baseOption = data.participation_options[0];
  data.participation_options = [
    {
      ...baseOption,
      id: "44444444-4444-4444-8444-444444444401",
      title: "Платное участие",
      description: "Основной билет на мероприятие",
      price_amount: 1500,
      option_type: "participation",
      allow_quantity: true,
      min_quantity: 2,
      max_quantity: 4,
      group_key: "attendance",
    },
    {
      ...baseOption,
      id: "44444444-4444-4444-8444-444444444402",
      title: "Семейное участие",
      description: "Единый вариант для семьи",
      price_amount: 3500,
      option_type: "family",
      group_key: "attendance",
      sort_order: 1,
    },
    {
      ...baseOption,
      id: "44444444-4444-4444-8444-444444444403",
      title: "Общая трапеза",
      price_amount: 600,
      option_type: "meal",
      sort_order: 2,
    },
    {
      ...baseOption,
      id: "44444444-4444-4444-8444-444444444404",
      title: "Пакет выходного дня",
      price_amount: 2500,
      option_type: "package",
      sort_order: 3,
    },
    {
      ...baseOption,
      id: "44444444-4444-4444-8444-444444444405",
      title: "Детское участие",
      price_amount: 500,
      option_type: "child",
      sort_order: 4,
    },
    {
      ...baseOption,
      id: "44444444-4444-4444-8444-444444444406",
      title: "Онлайн-подключение",
      description: "Не требует места в зале",
      option_type: "other",
      counts_toward_capacity: false,
      sort_order: 5,
    },
    {
      ...baseOption,
      id: "44444444-4444-4444-8444-444444444407",
      title: "Поддержать детскую программу",
      description: "Дополнительный добровольный взнос",
      price_amount: 750,
      option_type: "participation",
      is_donation: true,
      counts_toward_capacity: false,
      sort_order: 6,
    },
    {
      ...baseOption,
      id: "44444444-4444-4444-8444-444444444408",
      title: "Пожертвование общине",
      price_amount: 1000,
      option_type: "donation",
      is_donation: true,
      counts_toward_capacity: false,
      sort_order: 7,
    },
  ];
  return data;
}

export function responseWithOccurrences(): WebEventRegistrationFormResponse {
  const data = eventResponse("closed");
  data.occurrence_selection_mode = "user_select";
  data.default_occurrence_id = null;
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
