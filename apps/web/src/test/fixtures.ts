import type { WebEventRegistrationFormResponse, WebRegistrationState } from "../types";

export const EVENT_ID = "11111111-1111-4111-8111-111111111111";
export const OCCURRENCE_ONE_ID = "22222222-2222-4222-8222-222222222222";
export const OCCURRENCE_TWO_ID = "33333333-3333-4333-8333-333333333333";
export const OPTION_ID = "44444444-4444-4444-8444-444444444444";

export function eventResponse(
  registrationState: WebRegistrationState = "open",
): WebEventRegistrationFormResponse {
  return {
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
