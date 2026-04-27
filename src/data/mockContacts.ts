import type { ContactItem } from '@/types/contact';
export const mockContacts: ContactItem[] = [
  { id: '1', name: 'Давид Коэн', hebrewName: 'דוד כהן', role: 'Участник', city: 'Москва', phone: '+7 (916) 234-56-78', email: 'david@example.com', tribe: 'Коэн', dobGregorian: '14 мая 1988', dobHebrew: '26 Ияра 5748', nextBirthday: '26 Ияра 5786' },
  { id: '2', name: 'Рахель Леви', hebrewName: 'רחל לוי', role: 'Участница', city: 'Москва', phone: '+7 (916) 111-11-11', email: 'rachel@example.com', tribe: 'Леви', dobGregorian: '6 мая 1992', dobHebrew: '3 Сивана 5752', nextBirthday: '3 Сивана 5786' }
];
