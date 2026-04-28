import { create } from 'zustand';

import { listPublishedEvents, type CommunityEvent } from '@/services/eventsService';
import type { EventItem } from '@/types/event';

type EventsState = {
  events: EventItem[];
  loading: boolean;
  error: string | null;
  loadEvents: () => Promise<void>;
};

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

function mapEvent(event: CommunityEvent, index: number): EventItem {
  const category = mapCategory(event.category);

  return {
    id: event.id,
    title: event.title,
    subtitle: event.short_description ?? event.subtitle ?? undefined,
    date: formatEventDate(event.starts_at),
    featured: index === 0,
    ...category,
  };
}

export const useEventsStore = create<EventsState>((set) => ({
  events: [],
  loading: false,
  error: null,

  loadEvents: async () => {
    set({ loading: true, error: null });

    try {
      const events = await listPublishedEvents();

      set({
        events: events.map(mapEvent),
        loading: false,
        error: null,
      });
    } catch (error) {
      set({
        events: [],
        loading: false,
        error: error instanceof Error ? error.message : 'Не удалось загрузить события',
      });
    }
  },
}));