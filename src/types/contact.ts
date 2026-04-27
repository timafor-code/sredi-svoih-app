export interface ContactItem {
  id: string; name: string; hebrewName: string; role?: string; city: string;
  phone: string; email: string; tribe: 'Коэн' | 'Леви' | 'Исраэль';
  dobGregorian: string; dobHebrew: string; nextBirthday: string;
}
