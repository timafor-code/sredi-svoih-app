export interface EventCategory {
  id: string;
  communityId: string;
  slug: string;
  title: string;
  description: string | null;
  color: string;
  icon: string;
  sortOrder: number;
  isActive: boolean;
}
