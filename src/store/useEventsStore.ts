import { create } from 'zustand';

import { getEventById, listPublishedEvents } from '@/services/eventsService';
import {
  cancelRegistration as cancelRegistrationService,
  loadMyRegistrations as loadMyRegistrationsService,
  registerForEvent as registerForEventService,
} from '@/services/registrationService';
import { useAuthStore } from '@/store/useAuthStore';
import {
  ACTIVE_EVENT_REGISTRATION_STATUSES,
  type Event,
  type EventItem,
  type EventRegistration,
} from '@/types/event';

type LoadEventOptions = {
  forceRefresh?: boolean;
};

type EventsState = {
  events: EventItem[];
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
  cancelRegistration: (registrationId: string) => Promise<EventRegistration>;
  getRegistrationForEvent: (eventId: string) => EventRegistration | null;
  resetPrivateState: () => void;
};

const activeRegistrationStatuses = new Set(ACTIVE_EVENT_REGISTRATION_STATUSES);

export function isActiveEventRegistration(
  registration: EventRegistration | null | undefined,
): registration is EventRegistration {
  return Boolean(registration && activeRegistrationStatuses.has(registration.status));
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

function mapCategory(category: string | null): Pick<EventItem, 'category' | 'tagColor' | 'imageIcon'> {
  switch (category) {
    case 'lecture':
    case 'class':
      return {
        category: 'Курс',
        tagColor: '#4A90D9',
        imageIcon: '📚',
      };

    case 'holiday':
    case 'shabbat':
      return {
        category: 'Праздник',
        tagColor: '#F07A2A',
        imageIcon: '🕯️',
      };

    case 'children':
      return {
        category: 'Для детей',
        tagColor: '#E84393',
        imageIcon: '🎨',
      };

    default:
      return {
        category: 'Клуб',
        tagColor: '#7B68EE',
        imageIcon: '✡️',
      };
  }
}

function mapEvent(event: Event, index = 1): EventItem {
  const category = mapCategory(event.category);

  return {
    id: event.id,
    title: event.title,
    subtitle: event.subtitle ?? undefined,
    shortDescription: event.shortDescription,
    description: event.description,
    date: formatEventDate(event.startsAt),
    featured: index === 0,
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
    ...category,
  };
}

function friendlyRegistrationError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Не удалось выполнить действие.';

  if (message === 'Auth required') {
    return 'Нужен вход';
  }

  if (
    message.includes('duplicate key')
    || message.includes('event_registrations_event_id_user_id_key')
    || message.includes('already registered')
  ) {
    return 'Вы уже записаны';
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
  const nextRegistration = registration.event || !existingRegistration?.event
    ? registration
    : { ...registration, event: existingRegistration.event };

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
  eventId: string,
): EventItem | null {
  const listedEvent = events.find((event) => event.id === eventId);

  if (listedEvent) {
    return listedEvent;
  }

  const registrationEvent = registrations.find((registration) => registration.event?.id === eventId)?.event;

  return registrationEvent ? mapEvent(registrationEvent) : null;
}

export const useEventsStore = create<EventsState>((set, get) => ({
  events: [],
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
      const events = await listPublishedEvents();

      set({
        events: events.map(mapEvent),
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
    const currentSelectedEvent = get().selectedEvent?.id === eventId ? get().selectedEvent : null;
    const cachedEvent = options.forceRefresh
      ? null
      : currentSelectedEvent ?? findLoadedEvent(get().events, get().myRegistrations, eventId);

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

      const eventItem = mapEvent(event);

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

      if (message === 'Вы уже записаны') {
        await get().loadMyRegistrations();
      } else {
        set({ registrationsLoading: false, error: message });
      }

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
