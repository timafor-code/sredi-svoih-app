export type EventCategory = 'Курс' | 'Клуб' | 'Для детей' | 'Праздник';

export interface EventItem {
  id: string;
  title: string;
  date?: string;
  category: EventCategory;
  tagColor: string;
  imageIcon: string;
  featured?: boolean;
  subtitle?: string;
}
