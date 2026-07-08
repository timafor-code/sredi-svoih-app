import { isAdminApiProviderEnabled } from "./apiClient";
import {
  listAdminEventParticipationOptions as listAdminEventParticipationOptionsViaApi,
  replaceAdminEventParticipationOptions as replaceAdminEventParticipationOptionsViaApi,
} from "./adminParticipationOptionsApiService";
import { requireSupabaseClient } from "./supabaseClient";
import type {
  ParticipationOption,
  ParticipationOptionInput,
  ParticipationOptionRow,
} from "../types/participationOptions";

type SupabaseSelectError = {
  message?: string;
  details?: string | null;
  hint?: string | null;
};

function formatSupabaseError(action: string, error: SupabaseSelectError): string {
  const details = [error.message, error.details, error.hint].filter(Boolean).join(" ");
  return `${action} failed: ${details || "Unknown Supabase error"}`;
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return typeof value === "string" ? value : String(value);
}

function safeNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function nullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
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
    .map((entry) => (typeof entry === "string" ? entry.trim() : null))
    .filter((entry): entry is string => Boolean(entry && entry.length > 0));
}

export function normalizeParticipationOptionRow(
  row: Partial<ParticipationOptionRow>,
): ParticipationOption {
  return {
    id: nullableString(row.id) ?? "",
    eventId: nullableString(row.event_id) ?? "",
    title: nullableString(row.title) ?? "",
    description: nullableString(row.description),
    priceAmount: safeNumber(row.price_amount, 0),
    priceCurrency: nullableString(row.price_currency) ?? "RUB",
    optionType: nullableString(row.option_type) ?? "participation",
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
    createdAt: nullableString(row.created_at) ?? "",
    updatedAt: nullableString(row.updated_at) ?? "",
  };
}

export async function listAdminEventParticipationOptions(
  eventId: string,
): Promise<ParticipationOption[]> {
  if (isAdminApiProviderEnabled("events")) {
    return listAdminEventParticipationOptionsViaApi(eventId);
  }

  const supabase = requireSupabaseClient();
  const { data, error } = await supabase.rpc("admin_list_event_participation_options", {
    p_event_id: eventId,
  });

  if (error) {
    throw new Error(formatSupabaseError("List participation options", error));
  }

  return ((data ?? []) as ParticipationOptionRow[]).map(normalizeParticipationOptionRow);
}

type ParticipationOptionRpcPayload = {
  title: string;
  description: string | null;
  priceAmount: number;
  priceCurrency: string;
  optionType: string;
  seatLimit: number | null;
  allowQuantity: boolean;
  minQuantity: number;
  maxQuantity: number;
  isDonation: boolean;
  countsTowardCapacity: boolean;
  groupKey: string | null;
  conflictsWith: string[];
  sortOrder: number;
  isActive: boolean;
};

function toRpcPayload(input: ParticipationOptionInput): ParticipationOptionRpcPayload {
  return {
    title: input.title,
    description: input.description,
    priceAmount: input.priceAmount,
    priceCurrency: input.priceCurrency,
    optionType: input.optionType,
    seatLimit: input.seatLimit,
    allowQuantity: input.allowQuantity,
    minQuantity: input.minQuantity,
    maxQuantity: input.maxQuantity,
    isDonation: input.isDonation,
    countsTowardCapacity: input.countsTowardCapacity,
    groupKey: input.groupKey,
    conflictsWith: input.conflictsWith,
    sortOrder: input.sortOrder,
    isActive: input.isActive,
  };
}

export async function replaceAdminEventParticipationOptions(
  eventId: string,
  options: ParticipationOptionInput[],
): Promise<ParticipationOption[]> {
  if (isAdminApiProviderEnabled("events")) {
    return replaceAdminEventParticipationOptionsViaApi(eventId, options);
  }

  const supabase = requireSupabaseClient();
  const payload = options.map(toRpcPayload);
  const { data, error } = await supabase.rpc("admin_replace_event_participation_options", {
    p_event_id: eventId,
    p_options: payload,
  });

  if (error) {
    throw new Error(formatSupabaseError("Replace participation options", error));
  }

  return ((data ?? []) as ParticipationOptionRow[]).map(normalizeParticipationOptionRow);
}
