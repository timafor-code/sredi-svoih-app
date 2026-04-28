export interface ContactActivity {
  icon: string;
  subtitle: string;
  title: string;
}

export interface ContactItem {
  activities?: ContactActivity[];
  age?: number;
  avatarBg?: string;
  bio?: string;
  city: string;
  dobGregorian: string;
  dobHebrew: string;
  email: string;
  hebrewName: string;
  id: string;
  initials: string;
  marital?: string;
  name: string;
  nextBirthday: string;
  nextBirthdaySub?: string;
  phone: string;
  role?: string;
  roleColor?: string;
  subtitle?: string;
  synced?: boolean;
  tribe: 'Коэн' | 'Леви' | 'Исраэль';
}
