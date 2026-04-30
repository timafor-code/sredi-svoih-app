import { getHebrewDate } from './hebcal';
import { monthNameRu } from './hebcalRu';
import type { HebrewBirthDateProfile } from '@/types/profile';

export function buildHebrewBirthDateProfile(date: Date): HebrewBirthDateProfile {
  const hebrewDate = getHebrewDate(date);
  const day = hebrewDate.getDate();
  const monthName = monthNameRu(hebrewDate.getMonthName());
  const year = hebrewDate.getFullYear();

  return {
    labelRu: `${day} ${monthName} ${year}`,
    day,
    monthNameRu: monthName,
    year,
  };
}
