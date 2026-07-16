import type { ParticipationOption, ParticipationOptionRow } from "../types/participationOptions";

function string(value: unknown, fallback = ""): string {
  return value == null ? fallback : String(value);
}

function number(value: unknown, fallback: number | null = null): number | null {
  const result = typeof value === "number" ? value : Number(value);
  return Number.isFinite(result) ? result : fallback;
}

export function normalizeParticipationOptionRow(
  row: Partial<ParticipationOptionRow>,
): ParticipationOption {
  return {
    id: string(row.id), eventId: string(row.event_id), title: string(row.title),
    description: row.description == null ? null : String(row.description), priceAmount: number(row.price_amount, 0) ?? 0,
    priceCurrency: string(row.price_currency, "RUB"), optionType: string(row.option_type, "participation"),
    seatLimit: number(row.seat_limit), allowQuantity: row.allow_quantity === true,
    minQuantity: number(row.min_quantity, 1) ?? 1, maxQuantity: number(row.max_quantity, 1) ?? 1,
    isDonation: row.is_donation === true, countsTowardCapacity: row.counts_toward_capacity !== false,
    groupKey: row.group_key == null ? null : String(row.group_key),
    conflictsWith: Array.isArray(row.conflicts_with)
      ? row.conflicts_with.filter((value): value is string => typeof value === "string") : [],
    sortOrder: number(row.sort_order, 0) ?? 0, isActive: row.is_active !== false,
    createdAt: string(row.created_at), updatedAt: string(row.updated_at),
  };
}

export {
  listAdminEventParticipationOptions,
  replaceAdminEventParticipationOptions,
} from "./adminParticipationOptionsApiService";
