import { supabase } from './supabaseClient';
import type { EventCategory } from '@/types/eventCategory';

type EventCategoryRow = {
  id: string;
  community_id: string;
  slug: string;
  title: string;
  description: string | null;
  color: string;
  icon: string;
  sort_order: number;
  is_active: boolean;
};

const EVENT_CATEGORY_FIELDS = `
  id,
  community_id,
  slug,
  title,
  description,
  color,
  icon,
  sort_order,
  is_active
`;

function normalizeRow(row: EventCategoryRow): EventCategory {
  return {
    id: row.id,
    communityId: row.community_id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    color: row.color,
    icon: row.icon,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  };
}

export async function listEventCategories(): Promise<EventCategory[]> {
  const { data, error } = await supabase
    .from('event_categories')
    .select(EVENT_CATEGORY_FIELDS)
    .order('community_id', { ascending: true })
    .order('is_active', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('title', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as EventCategoryRow[]).map(normalizeRow);
}
