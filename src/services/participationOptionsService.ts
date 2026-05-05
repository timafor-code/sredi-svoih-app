import { supabase } from './supabaseClient';
import type {
  EventParticipationOption,
  EventParticipationOptionRow,
} from '@/types/participationOption';

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return typeof value === 'string' ? value : String(value);
}

function safeNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function nullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeConflictsWith(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : null))
    .filter((entry): entry is string => Boolean(entry && entry.length > 0));
}

export function normalizeParticipationOptionRow(
  row: Partial<EventParticipationOptionRow>,
): EventParticipationOption {
  return {
    id: nullableString(row.id) ?? '',
    eventId: nullableString(row.event_id) ?? '',
    title: nullableString(row.title) ?? '',
    description: nullableString(row.description),
    priceAmount: safeNumber(row.price_amount, 0),
    priceCurrency: nullableString(row.price_currency) ?? 'RUB',
    optionType: nullableString(row.option_type) ?? 'participation',
    seatLimit: nullableNumber(row.seat_limit),
    allowQuantity: row.allow_quantity === true,
    minQuantity: safeNumber(row.min_quantity, 1),
    maxQuantity: safeNumber(row.max_quantity, 1),
    isDonation: row.is_donation === true,
    countsTowardCapacity: row.counts_toward_capacity !== false,
    groupKey: nullableString(row.group_key),
    conflictsWith: normalizeConflictsWith(row.conflicts_with),
    sortOrder: safeNumber(row.sort_order, 0),
    isActive: row.is_active !== false,
    createdAt: nullableString(row.created_at) ?? '',
    updatedAt: nullableString(row.updated_at) ?? '',
  };
}

export async function listEventParticipationOptions(
  eventId: string,
): Promise<EventParticipationOption[]> {
  const { data, error } = await supabase.rpc('list_event_participation_options', {
    p_event_id: eventId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as EventParticipationOptionRow[])
    .map(normalizeParticipationOptionRow)
    .sort((first, second) => {
      if (first.sortOrder !== second.sortOrder) {
        return first.sortOrder - second.sortOrder;
      }

      return first.title.localeCompare(second.title, 'ru');
    });
}
