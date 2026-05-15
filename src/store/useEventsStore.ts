import { create } from 'zustand';

import { listEventCategories } from '@/services/eventCategoriesService';
import { getEventById, listPublishedEvents } from '@/services/eventsService';
import {
  cancelRegistration as cancelRegistrationService,
  loadMyRegistrations as loadMyRegistrationsService,
  registerForPaidEventSimulated as registerForPaidEventSimulatedService,
  registerForEvent as registerForEventService,
  type RegisterForPaidEventSimulatedInput,
} from '@/services/registrationService';
import { useAuthStore } from '@/store/useAuthStore';
import {
  ACTIVE_EVENT_REGISTRATION_STATUSES,
  DUPLICATE_BLOCKING_EVENT_REGISTRATION_STATUSES,
  type Event,
  type EventItem,
  type EventRegistration,
} from '@/types/event';
import type { EventCategory } from '@/types/eventCategory';

type LoadEventOptions = {
  forceRefresh?: boolean;
};

type EventsState = {
  events: EventItem[];
  categories: EventCategory[];
  selectedEvent: EventItem | null;
  myRegistrations: EventRegistration[];
  loading: boolean;
  selectedEventLoading: boolean;
  registrationsLoading: boolean;
  error: string | null;
  selectedEventError: string | null;
  loadEvents: () => Promise<void>;
  loadEventById: (eventId: string, options?: LoadEventOptions) => Promise<EventItem | null>;
  loadMyRegistrations: () => Promise<void>;
  registerForEvent: (eventId: string) => Promise<EventRegistration>;
  registerForPaidEventSimulated: (
    input: RegisterForPaidEventSimulatedInput,
  ) => Promise<EventRegistration>;
  cancelRegistration: (registrationId: string) => Promise<EventRegistration>;
  getRegistrationForEvent: (eventId: string) => EventRegistration | null;
  resetPrivateState: () => void;
};

const activeRegistrationStatuses = new Set(ACTIVE_EVENT_REGISTRATION_STATUSES);
const duplicateBlockingRegistrationStatuses = new Set(DUPLICATE_BLOCKING_EVENT_REGISTRATION_STATUSES);

const FALLBACK_CATEGORY = {
  title: 'Событие',
  tagColor: '#7B68EE',
  imageIcon: '•',
};

export function isActiveEventRegistration(
  registration: EventRegistration | null | undefined,
): registration is EventRegistration {
  return Boolean(registration && activeRegistrationStatuses.has(registration.status));
}

export function isDuplicateBlockingEventRegistration(
  registration: EventRegistration | null | undefined,
): registration is EventRegistration {
  return Boolean(registration && duplicateBlockingRegistrationStatuses.has(registration.status));
}

export function isSameRegistrationTarget(
  registration: EventRegistration,
  eventId: string,
  occurrenceId?: string | null,
): boolean {
  if (registration.eventId !== eventId) {
    return false;
  }

  const targetOccurrenceId = occurrenceId ?? null;

  return targetOccurrenceId
    ? registration.occurrenceId === targetOccurrenceId
    : !registration.occurrenceId;
}

export function findActiveRegistrationForTarget(
  registrations: EventRegistration[],
  eventId: string,
  occurrenceId?: string | null,
): EventRegistration | null {
  return registrations.find((registration) => (
    isDuplicateBlockingEventRegistration(registration)
    && isSameRegistrationTarget(registration, eventId, occurrenceId)
  )) ?? null;
}

function formatEventDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function categoryKey(communityId: string, slug: string): string {
  return `${communityId}::${slug}`;
}

function buildCategoryIndex(categories: EventCategory[]): Map<string, EventCategory> {
  const index = new Map<string, EventCategory>();

  categories.forEach((category) => {
    index.set(categoryKey(category.communityId, category.slug), category);
  });

  return index;
}

function resolveCategoryDisplay(
  event: Event,
  index: Map<string, EventCategory>,
): Pick<EventItem, 'category' | 'tagColor' | 'imageIcon'> {
  const slug = event.category;

  if (slug) {
    const match = index.get(categoryKey(event.communityId, slug));

    if (match) {
      return {
        category: match.title,
        tagColor: match.color,
        imageIcon: match.icon,
      };
    }
  }

  return {
    category: slug ?? FALLBACK_CATEGORY.title,
    tagColor: FALLBACK_CATEGORY.tagColor,
    imageIcon: FALLBACK_CATEGORY.imageIcon,
  };
}

function mapEvent(
  event: Event,
  index: Map<string, EventCategory>,
  position = 1,
): EventItem {
  const display = resolveCategoryDisplay(event, index);

  return {
    id: event.id,
    communityId: event.communityId,
    eventKind: event.eventKind,
    title: event.title,
    subtitle: event.subtitle ?? undefined,
    shortDescription: event.shortDescription,
    description: event.description,
    date: formatEventDate(event.startsAt),
    featured: position === 0,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    timezone: event.timezone,
    locationName: event.locationName,
    address: event.address,
    latitude: event.latitude,
    longitude: event.longitude,
    imageUrl: event.imageUrl,
    rawCategory: event.category,
    audience: event.audience,
    visibility: event.visibility,
    status: event.status,
    sourceType: event.sourceType,
    sourceUrl: event.sourceUrl,
    registrationMode: event.registrationMode,
    registrationUrl: event.registrationUrl,
    capacity: event.capacity,
    waitlistEnabled: event.waitlistEnabled,
    requiresApproval: event.requiresApproval,
    priceAmount: event.priceAmount,
    priceCurrency: event.priceCurrency,
    publishedAt: event.publishedAt,
    isPermanent: event.isPermanent,
    ...display,
  };
}

function friendlyRegistrationError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Не удалось выполнить действие.';
  const normalized = message.toLowerCase();

  if (message === 'Auth required') {
    return 'Нужен вход';
  }

  if (
    message.includes('event_registrations_event_user_occurrence_active_unique')
  ) {
    return 'Вы уже записаны на этот сеанс';
  }

  if (
    message.includes('duplicate key')
    || message.includes('event_registrations_event_id_user_id_key')
    || message.includes('event_registrations_event_user_no_occurrence_active_unique')
    || message.includes('already registered')
  ) {
    return 'Вы уже записаны';
  }

  if (normalized.includes('occurrenceid is required')) {
    return 'Выберите дату или сеанс события';
  }

  if (
    normalized.includes('registration closed')
    || normalized.includes('registration is closed')
    || normalized.includes('registration not open')
    || normalized.includes('registration is not open')
    || normalized.includes('not yet open')
    || normalized.includes('outside registration window')
    || normalized.includes('occurrence not found')
  ) {
    return 'Регистрация сейчас недоступна';
  }

  if (normalized.includes('no seats')) {
    return 'Свободных мест нет';
  }

  if (
    normalized.includes('select at least one participation option')
    || normalized.includes('select at least one option that reserves a seat')
  ) {
    return 'Выберите вариант участия';
  }

  return message;
}

function sortRegistrations(registrations: EventRegistration[]): EventRegistration[] {
  return [...registrations].sort((first, second) => (
    new Date(second.registeredAt).getTime() - new Date(first.registeredAt).getTime()
  ));
}

function upsertRegistration(
  registrations: EventRegistration[],
  registration: EventRegistration,
): EventRegistration[] {
  const existingRegistration = registrations.find((item) => item.id === registration.id);
  const nextRegistration: EventRegistration = {
    ...registration,
    event: registration.event ?? existingRegistration?.event,
    occurrence: registration.occurrence ?? existingRegistration?.occurrence,
    selectedOptions: registration.selectedOptions.length > 0
      ? registration.selectedOptions
      : existingRegistration?.selectedOptions ?? [],
    totalAmount: registration.totalAmount ?? existingRegistration?.totalAmount ?? null,
    totalCurrency: registration.totalCurrency ?? existingRegistration?.totalCurrency ?? null,
  };

  return sortRegistrations([
    nextRegistration,
    ...registrations.filter((item) => item.id !== registration.id),
  ]);
}

function findRegistrationForEvent(
  registrations: EventRegistration[],
  eventId: string,
): EventRegistration | null {
  const eventRegistrations = registrations.filter((registration) => registration.eventId === eventId);

  return eventRegistrations.find(isActiveEventRegistration) ?? eventRegistrations[0] ?? null;
}

function findLoadedEvent(
  events: EventItem[],
  registrations: EventRegistration[],
  categoryIndex: Map<string, EventCategory>,
  eventId: string,
): EventItem | null {
  const listedEvent = events.find((event) => event.id === eventId);

  if (listedEvent) {
    return listedEvent;
  }

  const registrationEvent = registrations.find((registration) => registration.event?.id === eventId)?.event;

  return registrationEvent ? mapEvent(registrationEvent, categoryIndex) : null;
}

export const useEventsStore = create<EventsState>((set, get) => ({
  events: [],
  categories: [],
  selectedEvent: null,
  myRegistrations: [],
  loading: false,
  selectedEventLoading: false,
  registrationsLoading: false,
  error: null,
  selectedEventError: null,

  loadEvents: async () => {
    set({ loading: true, error: null });

    try {
      const [events, categories] = await Promise.all([
        listPublishedEvents(),
        listEventCategories().catch(() => [] as EventCategory[]),
      ]);
      const categoryIndex = buildCategoryIndex(categories);

      set({
        events: events.map((event, index) => mapEvent(event, categoryIndex, index)),
        categories,
        loading: false,
        error: null,
      });

      if (useAuthStore.getState().user) {
        void get().loadMyRegistrations().catch(() => undefined);
      } else {
        set({ myRegistrations: [], registrationsLoading: false });
      }
    } catch (error) {
      set({
        events: [],
        loading: false,
        error: error instanceof Error ? error.message : 'Не удалось загрузить события',
      });
    }
  },

  loadEventById: async (eventId: string, options: LoadEventOptions = {}) => {
    const categoryIndex = buildCategoryIndex(get().categories);
    const currentSelectedEvent = get().selectedEvent?.id === eventId ? get().selectedEvent : null;
    const cachedEvent = options.forceRefresh
      ? null
      : currentSelectedEvent ?? findLoadedEvent(get().events, get().myRegistrations, categoryIndex, eventId);

    if (cachedEvent) {
      set({
        selectedEvent: cachedEvent,
        selectedEventLoading: false,
        selectedEventError: null,
      });
      return cachedEvent;
    }

    set({
      selectedEvent: null,
      selectedEventLoading: true,
      selectedEventError: null,
    });

    try {
      const event = await getEventById(eventId);

      if (!event) {
        set((state) => ({
          events: state.events.filter((item) => item.id !== eventId),
          selectedEvent: null,
          selectedEventLoading: false,
          selectedEventError: 'Событие недоступно',
        }));
        return null;
      }

      const eventItem = mapEvent(event, categoryIndex);

      set({
        selectedEvent: eventItem,
        selectedEventLoading: false,
        selectedEventError: null,
      });

      return eventItem;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось загрузить событие';

      set({
        selectedEvent: null,
        selectedEventLoading: false,
        selectedEventError: message,
      });
      throw new Error(message);
    }
  },

  loadMyRegistrations: async () => {
    if (!useAuthStore.getState().user) {
      set({ myRegistrations: [], registrationsLoading: false });
      return;
    }

    set({ registrationsLoading: true, error: null });

    try {
      const registrations = await loadMyRegistrationsService();

      set({
        myRegistrations: sortRegistrations(registrations),
        registrationsLoading: false,
        error: null,
      });
    } catch (error) {
      const message = friendlyRegistrationError(error);

      set({
        myRegistrations: [],
        registrationsLoading: false,
        error: message,
      });
      throw new Error(message);
    }
  },

  registerForEvent: async (eventId: string) => {
    const existingRegistration = findRegistrationForEvent(get().myRegistrations, eventId);

    if (isActiveEventRegistration(existingRegistration)) {
      return existingRegistration;
    }

    set({ registrationsLoading: true, error: null });

    try {
      const registration = await registerForEventService(eventId, 1, null);

      set((state) => ({
        myRegistrations: upsertRegistration(state.myRegistrations, registration),
        registrationsLoading: false,
        error: null,
      }));

      return registration;
    } catch (error) {
      const message = friendlyRegistrationError(error);

      if (message === 'Вы уже записаны' || message === 'Вы уже записаны на этот сеанс') {
        await get().loadMyRegistrations();
      } else {
        set({ registrationsLoading: false, error: message });
      }

      throw new Error(message);
    }
  },

  registerForPaidEventSimulated: async (input: RegisterForPaidEventSimulatedInput) => {
    set({ registrationsLoading: true, error: null });

    try {
      const registration = await registerForPaidEventSimulatedService(input);

      // Always reload the full server list. Repeat paid registrations on the
      // same (event, occurrence) produce separate rows with new ids; merging by
      // a single RPC return value would still leave room for the local state to
      // miss a row if the RPC payload is lean (no embedded options/event), so
      // refetch and let the server be the source of truth.
      try {
        const registrations = await loadMyRegistrationsService();
        const hydrated = registrations.find((item) => item.id === registration.id);

        set({
          myRegistrations: sortRegistrations(registrations),
          registrationsLoading: false,
          error: null,
        });

        return hydrated ?? registration;
      } catch {
        set((state) => ({
          myRegistrations: upsertRegistration(state.myRegistrations, registration),
          registrationsLoading: false,
          error: null,
        }));

        return registration;
      }
    } catch (error) {
      const message = friendlyRegistrationError(error);

      set({ registrationsLoading: false, error: message });

      throw new Error(message);
    }
  },

  cancelRegistration: async (registrationId: string) => {
    set({ registrationsLoading: true, error: null });

    try {
      const registration = await cancelRegistrationService(registrationId);

      set((state) => ({
        myRegistrations: upsertRegistration(state.myRegistrations, registration),
        registrationsLoading: false,
        error: null,
      }));

      return registration;
    } catch (error) {
      const message = friendlyRegistrationError(error);

      set({ registrationsLoading: false, error: message });
      throw new Error(message);
    }
  },

  getRegistrationForEvent: (eventId: string) => findRegistrationForEvent(get().myRegistrations, eventId),

  resetPrivateState: () => {
    set((state) => ({
      events: state.events.filter((event) => event.visibility === 'public'),
      selectedEvent: state.selectedEvent?.visibility === 'public' ? state.selectedEvent : null,
      myRegistrations: [],
      error: null,
      selectedEventError: null,
      selectedEventLoading: false,
      registrationsLoading: false,
    }));
  },
}));
