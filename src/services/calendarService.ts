import { getHebrewDate, getHebrewDateLabel, getOmerInfo, getUpcomingHoliday, getWeeklyParsha } from '@/lib/hebcal';
import { formatRuDate } from '@/lib/dates';
import { getDailyZmanim, getHebcalLocation } from '@/lib/zmanim';

export const calendarService = {
  getToday: (date = new Date(), city = 'Москва') => {
    const location = getHebcalLocation(city);
    const hdate = getHebrewDate(date, location);

    return {
      gregorianDate: formatRuDate(date, location.getTzid()),
      hebrewDate: getHebrewDateLabel(hdate),
      holiday: getUpcomingHoliday(hdate, location.getIsrael()),
      omer: getOmerInfo(hdate),
      parsha: getWeeklyParsha(hdate, location.getIsrael()),
      zmanim: getDailyZmanim({ city, date }),
    };
  },
};
