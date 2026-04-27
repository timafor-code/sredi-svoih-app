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

/**
 * Counting of the Omer — sefirah for a given day (1..49).
 *
 * Formula matches hebcal's Omer model:
 *   week  = floor((day - 1) / 7)   → outer attribute (Chesed → Malkhut)
 *   inner = (day - 1) % 7          → inner attribute, cycles each week
 * Day 8 (week=1, inner=0) → "Хесед ше-бе-Гвура".
 */
const ATTR_RU = ['Хесед', 'Гвура', 'Тиферет', 'Нецах', 'Ход', 'Йесод', 'Малхут'];

export function sefirahRu(omerDay: number): string {
  if (!Number.isInteger(omerDay) || omerDay < 1 || omerDay > 49) return '';
  const week = Math.floor((omerDay - 1) / 7);
  const inner = (omerDay - 1) % 7;
  return `${ATTR_RU[inner]} ше-бе-${ATTR_RU[week]}`;
}
