export type EventCategory = 'Курс' | 'Клуб' | 'Для детей' | 'Праздник';

export type EventRegistrationMode =
  | 'none'
  | 'external_link'
  | 'internal_free'
  | 'internal_paid';

export interface EventItem {
  id: string;
  title: string;
  date?: string;
  category: EventCategory;
  tagColor: string;
  imageIcon: string;
  featured?: boolean;
  subtitle?: string;
  registrationMode: EventRegistrationMode;
  registrationUrl?: string;
  sourceUrl?: string;
  capacity?: number;
}
