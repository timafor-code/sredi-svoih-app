export type EventCategory = 'Курсы' | 'Праздники' | 'Клуб';
export interface EventItem { id: string; title: string; date: string; category: EventCategory; featured?: boolean; }
