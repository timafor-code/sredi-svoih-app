import { apiClient } from './apiClient';
import type { EventParticipationOption } from '@/types/participationOption';

type ApiParticipationOption = {
  id: string;
  event_id: string;
  title: string;
  description: string | null;
  price_amount: number;
  price_currency: string;
  option_type: string;
  seat_limit: number | null;
  allow_quantity: boolean;
  min_quantity: number;
  max_quantity: number;
  is_donation: boolean;
  counts_toward_capacity: boolean;
  group_key: string | null;
  conflicts_with: unknown[];
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export function normalizeApiParticipationOption(
  row: ApiParticipationOption,
): EventParticipationOption {
  return {
    id: row.id,
    eventId: row.event_id,
    title: row.title,
    description: row.description,
    priceAmount: row.price_amount,
    priceCurrency: row.price_currency,
    optionType: row.option_type,
    seatLimit: row.seat_limit,
    allowQuantity: row.allow_quantity,
    minQuantity: row.min_quantity,
    maxQuantity: row.max_quantity,
    isDonation: row.is_donation,
    countsTowardCapacity: row.counts_toward_capacity,
    groupKey: row.group_key,
    conflictsWith: row.conflicts_with.filter((value): value is string => typeof value === 'string'),
    sortOrder: row.sort_order,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listEventParticipationOptions(
  eventId: string,
): Promise<EventParticipationOption[]> {
  const response = await apiClient.get<ApiParticipationOption[] | null>(
    `/events/${encodeURIComponent(eventId)}/participation-options`,
  );

  return (response ?? [])
    .map(normalizeApiParticipationOption)
    .sort((first, second) => first.sortOrder - second.sortOrder || first.title.localeCompare(second.title, 'ru'));
}
