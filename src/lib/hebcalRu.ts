import type { MonthName } from '@hebcal/hdate';

/**
 * Russian transliterations for things @hebcal/core can only render in
 * `en` / `ashkenazi` / `he`. Keep these tables here so the rest of the app
 * stays UI-language-agnostic.
 */

const MONTH_RU: Record<MonthName, string> = {
  Nisan: 'Нисан',
  Iyyar: 'Ияр',
  Sivan: 'Сиван',
  Tamuz: 'Тамуз',
  Av: 'Ав',
  Elul: 'Элул',
  Tishrei: 'Тишрей',
  Cheshvan: 'Хешван',
  Kislev: 'Кислев',
  Tevet: 'Тевет',
  "Sh'vat": 'Шват',
  Adar: 'Адар',
  'Adar I': 'Адар I',
  'Adar II': 'Адар II',
};

export function monthNameRu(name: MonthName | string): string {
  return MONTH_RU[name as MonthName] ?? name;
}

/**
 * 54 parshiot keyed by hebcal's English transliteration (matches
 * the `parshiot` array exported from `@hebcal/core`).
 */
const PARSHA_RU: Record<string, string> = {
  Bereshit: 'Берешит',
  Noach: 'Ноах',
  'Lech-Lecha': 'Лех-Леха',
  Vayera: 'Ваейра',
  'Chayei Sara': 'Хаей Сара',
  Toldot: 'Толдот',
  Vayetzei: 'Вайеце',
  Vayishlach: 'Ваишлах',
  Vayeshev: 'Вайешев',
  Miketz: 'Микец',
  Vayigash: 'Ваигаш',
  Vayechi: 'Ваехи',
  Shemot: 'Шемот',
  Vaera: 'Ваэра',
  Bo: 'Бо',
  Beshalach: 'Бешалах',
  Yitro: 'Итро',
  Mishpatim: 'Мишпатим',
  Terumah: 'Трума',
  Tetzaveh: 'Тецаве',
  'Ki Tisa': 'Ки Тиса',
  Vayakhel: 'Ваякхел',
  Pekudei: 'Пкудей',
  Vayikra: 'Ваикра',
  Tzav: 'Цав',
  Shmini: 'Шмини',
  Tazria: 'Тазриа',
  Metzora: 'Мецора',
  'Achrei Mot': 'Ахарей Мот',
  Kedoshim: 'Кдошим',
  Emor: 'Эмор',
  Behar: 'Беар',
  Bechukotai: 'Бехукотай',
  Bamidbar: 'Бемидбар',
  Nasso: 'Насо',
  "Beha'alotcha": 'Беаалотха',
  "Sh'lach": 'Шлах',
  Korach: 'Корах',
  Chukat: 'Хукат',
  Balak: 'Балак',
  Pinchas: 'Пинхас',
  Matot: 'Матот',
  Masei: 'Масей',
  Devarim: 'Дварим',
  Vaetchanan: 'Ваэтханан',
  Eikev: 'Экев',
  "Re'eh": 'Реэ',
  Shoftim: 'Шофтим',
  'Ki Teitzei': 'Ки Теце',
  'Ki Tavo': 'Ки Таво',
  Nitzavim: 'Ницавим',
  Vayeilech: 'Вайелех',
  Haazinu: 'Аазину',
  "V'Zot HaBerachah": 'Везот а-Браха',
};

/**
 * Translates a parsha name (single or doubled like `Matot-Masei`) to Russian.
 * Falls back to the English form for any unknown entry.
 */
export function parshaNameRu(name: string): string {
  if (!name) return name;
  if (name.includes('-')) {
    return name
      .split('-')
      .map((p) => PARSHA_RU[p.trim()] ?? p.trim())
      .join('-');
  }
  return PARSHA_RU[name] ?? name;
}

const HOLIDAY_RU: Record<string, string> = {
  'Asara B\'Tevet': 'Пост 10 Тевета',
  'Chanukah': 'Ханука',
  'Erev Pesach': 'Канун Песаха',
  'Erev Rosh Hashana': 'Канун Рош ха-Шана',
  'Erev Shavuot': 'Канун Шавуота',
  'Erev Sukkot': 'Канун Суккота',
  'Erev Tish\'a B\'Av': 'Канун 9 Ава',
  'Erev Yom Kippur': 'Канун Йом Кипура',
  'Lag BaOmer': 'Лаг ба-Омер',
  'Pesach': 'Песах',
  'Pesach Sheni': 'Песах Шени',
  'Purim': 'Пурим',
  'Rosh Chodesh': 'Рош Ходеш',
  'Rosh Hashana': 'Рош ха-Шана',
  'Shavuot': 'Шавуот',
  'Shmini Atzeret': 'Шмини Ацерет',
  'Simchat Torah': 'Симхат Тора',
  'Sukkot': 'Суккот',
  'Ta\'anit Bechorot': 'Пост первенцев',
  'Ta\'anit Esther': 'Пост Эстер',
  'Tish\'a B\'Av': '9 Ава',
  'Tu B\'Av': 'Ту бе-Ав',
  'Tu BiShvat': 'Ту би-Шват',
  'Tzom Tammuz': 'Пост 17 Тамуза',
  'Yom HaAtzma\'ut': 'Йом ха-Ацмаут',
  'Yom HaShoah': 'Йом ха-Шоа',
  'Yom HaZikaron': 'Йом ха-Зикарон',
  'Yom Kippur': 'Йом Кипур',
  'Yom Yerushalayim': 'Йом Йерушалаим',
};

export function holidayNameRu(name: string): string {
  if (!name) return name;
  const cleaned = name
    .replace(/:.*$/, '')
    .replace(/\s+\d+$/, '')
    .replace(/\s+\([^)]*\)$/, '')
    .trim();
  return HOLIDAY_RU[name] ?? HOLIDAY_RU[cleaned] ?? cleaned;
}

/**
 * Counting of the Omer — sefirah for a given day (1..49).
 *
 * Formula matches hebcal's Omer model:
 *   week  = floor((day - 1) / 7)   → outer attribute (Chesed → Malkhut)
 *   inner = (day - 1) % 7          → inner attribute, cycles each week
 * Day 8 (week=1, inner=0) → "Хесед ше-бе-Гвура".
 */
const ATTR_RU = ['Хесед', 'Гвура', 'Тиферет', 'Нецах', 'Ход', 'Йесод', 'Малхут'];
const ATTR_MEANING_RU = ['Любовь', 'Строгость', 'Гармония', 'Победа', 'Смирение', 'Связь', 'Царство'];
const ATTR_MEANING_GENITIVE_RU = ['любви', 'строгости', 'гармонии', 'победы', 'смирения', 'связи', 'царства'];

export function sefirahRu(omerDay: number): string {
  if (!Number.isInteger(omerDay) || omerDay < 1 || omerDay > 49) return '';
  const week = Math.floor((omerDay - 1) / 7);
  const inner = (omerDay - 1) % 7;
  return `${ATTR_RU[inner]} ше-бе-${ATTR_RU[week]}`;
}

export function sefirahMeaningRu(omerDay: number): string {
  if (!Number.isInteger(omerDay) || omerDay < 1 || omerDay > 49) return '';
  const week = Math.floor((omerDay - 1) / 7);
  const inner = (omerDay - 1) % 7;
  return `${ATTR_MEANING_RU[inner]} внутри ${ATTR_MEANING_GENITIVE_RU[week]}`;
}

export function formatOmerDayRu(omerDay: number): string {
  return `${omerDay}-й день Омера`;
}

export function formatOmerCountingRu(omerDay: number): string {
  const lastTwo = omerDay % 100;
  const last = omerDay % 10;
  const unit = lastTwo >= 11 && lastTwo <= 14 ? 'дней' : last === 1 ? 'день' : last >= 2 && last <= 4 ? 'дня' : 'дней';
  return `Сегодня ${omerDay} ${unit} Омера.`;
}
