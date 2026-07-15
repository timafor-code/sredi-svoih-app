import { create } from 'zustand';

import { getEffectiveEventStartsAt } from '@/lib/eventTime';
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
  myRegistrationsUserId: string | null;
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
const MY_REGISTRATIONS_DEBUG_TAG = '[mobile registrations]';
const MY_REGISTRATIONS_DEBUG_EVENT_TITLE = 'Шаббат открыто';

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
  const effectiveStartsAt = event.effectiveStartsAt ?? event.nextOccurrence?.startsAt ?? null;
  const effectiveEndsAt = event.effectiveEndsAt ?? event.nextOccurrence?.endsAt ?? null;
  const dateStartsAt = getEffectiveEventStartsAt(event);

  return {
    id: event.id,
    communityId: event.communityId,
    eventKind: event.eventKind,
    title: event.title,
    subtitle: event.subtitle ?? undefined,
    shortDescription: event.shortDescription,
    description: event.description,
    date: formatEventDate(dateStartsAt),
    featured: position === 0,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    nextOccurrence: event.nextOccurrence ?? null,
    effectiveStartsAt,
    effectiveEndsAt,
    hasOccurrences: event.hasOccurrences,
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

function getCurrentAuthUser() {
  return useAuthStore.getState().user;
}

function summarizeRegistrationForDebug(registration: EventRegistration) {
  return {
    id: registration.id,
    eventId: registration.eventId,
    occurrenceId: registration.occurrenceId,
    status: registration.status,
    registeredAt: registration.registeredAt,
    title: registration.event?.title ?? null,
  };
}

function summarizeDebugEventRegistrations(registrations: EventRegistration[]) {
  const eventRegistrations = registrations.filter((registration) => (
    registration.event?.title === MY_REGISTRATIONS_DEBUG_EVENT_TITLE
  ));

  if (eventRegistrations.length === 0) {
    return null;
  }

  return {
    eventIds: Array.from(new Set(eventRegistrations.map((registration) => registration.eventId))),
    totalRegistrationsCount: eventRegistrations.length,
    registrationIds: eventRegistrations.map((registration) => registration.id),
    occurrenceIds: eventRegistrations.map((registration) => registration.occurrenceId),
    selectedOptions: eventRegistrations.map((registration) => ({
      registrationId: registration.id,
      titles: registration.selectedOptions.map((option) => ({
        title: option.title,
        quantity: option.quantity,
        seatsCount: option.seatsCount,
        isDonation: option.isDonation,
      })),
    })),
  };
}

function logMyRegistrationsLoadDebug(
  user: NonNullable<ReturnType<typeof getCurrentAuthUser>>,
  registrations: EventRegistration[],
): void {
  if (!__DEV__) {
    return;
  }

  console.info(`${MY_REGISTRATIONS_DEBUG_TAG} loadMyRegistrationsService result`, {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? null,
    authUser: {
      id: user.id,
      email: user.email ?? null,
    },
    registrationsCount: registrations.length,
    registrations: registrations.map(summarizeRegistrationForDebug),
    debugEventTitle: MY_REGISTRATIONS_DEBUG_EVENT_TITLE,
    debugEventGroup: summarizeDebugEventRegistrations(registrations),
  });
}

function logMyRegistrationsLoadErrorDebug(
  user: NonNullable<ReturnType<typeof getCurrentAuthUser>>,
  message: string,
): void {
  if (!__DEV__) {
    return;
  }

  console.warn(`${MY_REGISTRATIONS_DEBUG_TAG} loadMyRegistrationsService failed`, {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? null,
    authUser: {
      id: user.id,
      email: user.email ?? null,
    },
    message,
  });
}

function clearRegistrationsForUserSwitch(
  state: EventsState,
  userId: string,
): Pick<EventsState, 'myRegistrations' | 'myRegistrationsUserId'> {
  return state.myRegistrationsUserId === userId
    ? {
      myRegistrations: state.myRegistrations,
      myRegistrationsUserId: userId,
    }
    : {
      myRegistrations: [],
      myRegistrationsUserId: userId,
    };
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
  myRegistrationsUserId: null,
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
        set({ myRegistrations: [], myRegistrationsUserId: null, registrationsLoading: false });
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
    const requestedUser = getCurrentAuthUser();

    if (!requestedUser) {
      set({ myRegistrations: [], myRegistrationsUserId: null, registrationsLoading: false });
      return;
    }

    const requestedUserId = requestedUser.id;

    set((state) => ({
      ...clearRegistrationsForUserSwitch(state, requestedUserId),
      registrationsLoading: true,
      error: null,
    }));

    try {
      const registrations = await loadMyRegistrationsService();
      const currentUser = getCurrentAuthUser();

      if (!currentUser || currentUser.id !== requestedUserId) {
        set({
          myRegistrations: [],
          myRegistrationsUserId: currentUser?.id ?? null,
          registrationsLoading: false,
        });
        return;
      }

      const sortedRegistrations = sortRegistrations(registrations);

      logMyRegistrationsLoadDebug(currentUser, sortedRegistrations);

      set({
        myRegistrations: sortedRegistrations,
        myRegistrationsUserId: currentUser.id,
        registrationsLoading: false,
        error: null,
      });
    } catch (error) {
      const message = friendlyRegistrationError(error);

      logMyRegistrationsLoadErrorDebug(requestedUser, message);

      const currentUser = getCurrentAuthUser();

      set({
        myRegistrations: [],
        myRegistrationsUserId: currentUser?.id ?? null,
        registrationsLoading: false,
        error: currentUser ? message : null,
      });
      throw new Error(message);
    }
  },

  registerForEvent: async (eventId: string) => {
    const requestedUser = getCurrentAuthUser();

    if (!requestedUser) {
      throw new Error('Auth required');
    }

    const requestedUserId = requestedUser.id;
    const currentState = get();
    const existingRegistration = findRegistrationForEvent(
      currentState.myRegistrationsUserId === requestedUserId ? currentState.myRegistrations : [],
      eventId,
    );

    if (isActiveEventRegistration(existingRegistration)) {
      return existingRegistration;
    }

    set((state) => ({
      ...clearRegistrationsForUserSwitch(state, requestedUserId),
      registrationsLoading: true,
      error: null,
    }));

    try {
      const registration = await registerForEventService(eventId, 1, null);
      const currentUser = getCurrentAuthUser();

      if (!currentUser || currentUser.id !== requestedUserId) {
        set({
          myRegistrations: [],
          myRegistrationsUserId: currentUser?.id ?? null,
          registrationsLoading: false,
        });
        return registration;
      }

      set((state) => ({
        myRegistrations: upsertRegistration(
          state.myRegistrationsUserId === currentUser.id ? state.myRegistrations : [],
          registration,
        ),
        myRegistrationsUserId: currentUser.id,
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
    const requestedUser = getCurrentAuthUser();

    if (!requestedUser) {
      throw new Error('Auth required');
    }

    const requestedUserId = requestedUser.id;

    set((state) => ({
      ...clearRegistrationsForUserSwitch(state, requestedUserId),
      registrationsLoading: true,
      error: null,
    }));

    try {
      const registration = await registerForPaidEventSimulatedService(input);
      const currentUserAfterRegistration = getCurrentAuthUser();

      if (!currentUserAfterRegistration || currentUserAfterRegistration.id !== requestedUserId) {
        set({
          myRegistrations: [],
          myRegistrationsUserId: currentUserAfterRegistration?.id ?? null,
          registrationsLoading: false,
        });
        return registration;
      }

      // Always reload the full server list. Repeat paid registrations on the
      // same (event, occurrence) produce separate rows with new ids; merging by
      // a single RPC return value would still leave room for the local state to
      // miss a row if the RPC payload is lean (no embedded options/event), so
      // refetch and let the server be the source of truth.
      try {
        const registrations = await loadMyRegistrationsService();
        const currentUserAfterReload = getCurrentAuthUser();

        if (!currentUserAfterReload || currentUserAfterReload.id !== requestedUserId) {
          set({
            myRegistrations: [],
            myRegistrationsUserId: currentUserAfterReload?.id ?? null,
            registrationsLoading: false,
          });
          return registration;
        }

        const sortedRegistrations = sortRegistrations(registrations);
        const hydrated = registrations.find((item) => item.id === registration.id);

        logMyRegistrationsLoadDebug(currentUserAfterReload, sortedRegistrations);

        set({
          myRegistrations: sortedRegistrations,
          myRegistrationsUserId: currentUserAfterReload.id,
          registrationsLoading: false,
          error: null,
        });

        return hydrated ?? registration;
      } catch (reloadError) {
        const message = friendlyRegistrationError(reloadError);

        logMyRegistrationsLoadErrorDebug(requestedUser, message);

        set({
          myRegistrations: [],
          myRegistrationsUserId: getCurrentAuthUser()?.id ?? null,
          registrationsLoading: false,
          error: message,
        });

        return registration;
      }
    } catch (error) {
      const message = friendlyRegistrationError(error);

      set({ registrationsLoading: false, error: message });

      throw new Error(message);
    }
  },

  cancelRegistration: async (registrationId: string) => {
    const requestedUser = getCurrentAuthUser();

    if (!requestedUser) {
      throw new Error('Auth required');
    }

    const requestedUserId = requestedUser.id;

    set((state) => ({
      ...clearRegistrationsForUserSwitch(state, requestedUserId),
      registrationsLoading: true,
      error: null,
    }));

    try {
      const registration = await cancelRegistrationService(registrationId);
      const currentUser = getCurrentAuthUser();

      if (!currentUser || currentUser.id !== requestedUserId) {
        set({
          myRegistrations: [],
          myRegistrationsUserId: currentUser?.id ?? null,
          registrationsLoading: false,
        });
        return registration;
      }

      set((state) => ({
        myRegistrations: upsertRegistration(
          state.myRegistrationsUserId === currentUser.id ? state.myRegistrations : [],
          registration,
        ),
        myRegistrationsUserId: currentUser.id,
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

  getRegistrationForEvent: (eventId: string) => {
    const currentUser = getCurrentAuthUser();
    const state = get();

    if (!currentUser || state.myRegistrationsUserId !== currentUser.id) {
      return null;
    }

    return findRegistrationForEvent(state.myRegistrations, eventId);
  },

  resetPrivateState: () => {
    set((state) => ({
      events: state.events.filter((event) => event.visibility === 'public'),
      selectedEvent: state.selectedEvent?.visibility === 'public' ? state.selectedEvent : null,
      myRegistrations: [],
      myRegistrationsUserId: null,
      error: null,
      selectedEventError: null,
      selectedEventLoading: false,
      registrationsLoading: false,
    }));
  },
}));
