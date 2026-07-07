import type { ApiEventCategoryResponse } from '@/types/api';
import type { EventCategory } from '@/types/eventCategory';

import { apiClient } from './apiClient';

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return typeof value === 'string' ? value : String(value);
}

function requiredString(value: unknown, fallback: string): string {
  const normalized = nullableString(value);

  return normalized && normalized.trim().length > 0 ? normalized : fallback;
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

function safeNumber(value: unknown, fallback: number): number {
  const parsed = nullableNumber(value);

  return parsed === null ? fallback : parsed;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();

    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }

  return fallback;
}

export function normalizeApiEventCategory(row: ApiEventCategoryResponse): EventCategory {
  return {
    id: requiredString(row.id, ''),
    communityId: requiredString(row.community_id, ''),
    slug: requiredString(row.slug, ''),
    title: requiredString(row.title, ''),
    description: nullableString(row.description),
    color: requiredString(row.color, '#7B68EE'),
    icon: requiredString(row.icon, '\u2022'),
    sortOrder: safeNumber(row.sort_order, 0),
    isActive: normalizeBoolean(row.is_active, true),
  };
}

export async function listEventCategories(): Promise<EventCategory[]> {
  const response = await apiClient.get<ApiEventCategoryResponse[] | null>(
    '/event-categories',
  );

  return (response ?? []).map(normalizeApiEventCategory);
}
