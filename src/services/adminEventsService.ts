import {
  normalizeEventRow,
  type CommunityEventRow,
} from '@/services/eventsService';
import { supabase } from './supabaseClient';
import type { Event } from '@/types/event';
import type {
  AdminEventPayload,
  AdminImportItem,
  AdminImportReview,
  JsonObject,
  JsonValue,
} from '@/types/adminEvent';

type SupabaseRpcError = {
  message?: string;
  details?: string | null;
  hint?: string | null;
};

type AdminImportItemRow = {
  id: string;
  source_id: string;
  run_id: string | null;
  external_id: string | null;
  source_url: string | null;
  raw_payload: JsonValue | null;
  parsed_title: string | null;
  parsed_starts_at: string | null;
  parsed_location: string | null;
  linked_event_id: string | null;
  status: string | null;
  created_at: string;
  source_name: string | null;
  community_id: string | null;
};

function isJsonObject(value: JsonValue | null | undefined): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeImportReview(rawPayload: JsonValue): AdminImportReview | null {
  if (!isJsonObject(rawPayload)) {
    return null;
  }

  const review = rawPayload.importReview;

  return isJsonObject(review) ? (review as AdminImportReview) : null;
}

function normalizeImportItemRow(row: AdminImportItemRow): AdminImportItem {
  const rawPayload = row.raw_payload ?? {};

  return {
    id: row.id,
    sourceId: row.source_id,
    runId: row.run_id,
    externalId: row.external_id,
    sourceUrl: row.source_url,
    rawPayload,
    importReview: normalizeImportReview(rawPayload),
    parsedTitle: row.parsed_title,
    parsedStartsAt: row.parsed_starts_at,
    parsedLocation: row.parsed_location,
    linkedEventId: row.linked_event_id,
    status: row.status,
    createdAt: row.created_at,
    sourceName: row.source_name,
    communityId: row.community_id,
  };
}

function normalizeSingleImportItem(
  data: AdminImportItemRow | AdminImportItemRow[] | null,
): AdminImportItem {
  const row = Array.isArray(data) ? data[0] : data;

  if (!row) {
    throw new Error('Admin import item result is empty');
  }

  return normalizeImportItemRow(row);
}

function normalizeSingleEvent(data: CommunityEventRow | CommunityEventRow[] | null): Event {
  const row = Array.isArray(data) ? data[0] : data;

  if (!row) {
    throw new Error('Admin event result is empty');
  }

  return normalizeEventRow(row);
}

function throwRpcError(action: string, error: SupabaseRpcError): never {
  const details = [error.message, error.details, error.hint].filter(Boolean).join(' ');

  throw new Error(`${action} failed: ${details || 'Unknown Supabase error'}`);
}

export async function listImportItemsNeedingReview(limitCount?: number): Promise<AdminImportItem[]> {
  const args = typeof limitCount === 'number' ? { limit_count: limitCount } : {};
  const { data, error } = await supabase.rpc('admin_list_import_items_needing_review', args);

  if (error) {
    throwRpcError('List admin import items', error);
  }

  return ((data ?? []) as AdminImportItemRow[]).map(normalizeImportItemRow);
}

export async function getImportItem(id: string): Promise<AdminImportItem> {
  const { data, error } = await supabase.rpc('admin_get_import_item', {
    import_item_id: id,
  });

  if (error) {
    throwRpcError('Load admin import item', error);
  }

  return normalizeSingleImportItem(data as AdminImportItemRow | AdminImportItemRow[] | null);
}

export async function createEvent(payload: AdminEventPayload): Promise<Event> {
  const { data, error } = await supabase.rpc('admin_create_event', {
    payload,
  });

  if (error) {
    throwRpcError('Create admin event', error);
  }

  return normalizeSingleEvent(data as CommunityEventRow | CommunityEventRow[] | null);
}

export async function publishImportItem(
  importItemId: string,
  payload: AdminEventPayload,
): Promise<Event> {
  const { data, error } = await supabase.rpc('admin_publish_import_item', {
    import_item_id: importItemId,
    payload,
  });

  if (error) {
    throwRpcError('Publish admin import item', error);
  }

  return normalizeSingleEvent(data as CommunityEventRow | CommunityEventRow[] | null);
}

export async function ignoreImportItem(
  importItemId: string,
  reason?: string,
): Promise<AdminImportItem> {
  const { data, error } = await supabase.rpc('admin_ignore_import_item', {
    import_item_id: importItemId,
    reason: reason ?? null,
  });

  if (error) {
    throwRpcError('Ignore admin import item', error);
  }

  return normalizeSingleImportItem(data as AdminImportItemRow | AdminImportItemRow[] | null);
}
