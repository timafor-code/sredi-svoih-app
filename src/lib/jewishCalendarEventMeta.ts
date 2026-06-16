export type JewishCalendarEventKind =
  | 'fast'
  | 'holiday'
  | 'modern_holiday'
  | 'minor_holiday'
  | 'other';

type JewishCalendarEventMetaConfig = {
  descriptionRu: string;
  observanceNoteRu?: string;
  typeLabelRu?: string;
};

export type JewishCalendarEventMeta = {
  descriptionRu: string;
  observanceNoteRu?: string;
  typeLabelRu: string;
};

const FALLBACK_DESCRIPTION_RU = 'Краткое описание будет добавлено позже.';

const TYPE_LABEL_RU: Record<JewishCalendarEventKind, string> = {
  fast: 'Пост',
  holiday: 'Праздник',
  minor_holiday: 'Праздник',
  modern_holiday: 'Памятная дата',
  other: 'Дата календаря',
};

const EVENT_META_BY_BASENAME: Record<string, JewishCalendarEventMetaConfig> = {
  'Asara B\'Tevet': {
    descriptionRu:
      'Пост 10 Тевета связан с началом осады Иерусалима. Это день памяти о событиях, которые привели к разрушению Первого Храма.',
  },
  Chanukah: {
    descriptionRu:
      'Ханука напоминает о восстановлении служения в Храме и чуде света. В календаре это радостные дни памяти и благодарности.',
  },
  'Lag BaOmer': {
    descriptionRu:
      'Лаг ба-Омер отмечается на 33-й день счета Омера. День связан с радостью, памятью о рабби Шимоне бар Йохае и традициями общинного празднования.',
  },
  Pesach: {
    descriptionRu:
      'Песах посвящен исходу из Египта и теме освобождения. Это один из центральных праздников еврейского года.',
  },
  'Pesach Sheni': {
    descriptionRu:
      'Песах Шени - дата, связанная со второй возможностью принести пасхальную жертву в эпоху Храма. Сегодня она воспринимается как напоминание о возможности исправления.',
  },
  Purim: {
    descriptionRu:
      'Пурим напоминает о спасении еврейского народа в истории Мегилат Эстер. Это радостный праздник памяти, благодарности и общинной поддержки.',
  },
  'Rosh Hashana': {
    descriptionRu:
      'Рош ха-Шана открывает новый год еврейского календаря. Это время суда, памяти и внутреннего обновления.',
  },
  Shavuot: {
    descriptionRu:
      'Шавуот связан с дарованием Торы и завершением счета Омера. В календаре он стоит как праздник Торы и духовной ответственности.',
  },
  'Shmini Atzeret': {
    descriptionRu:
      'Шмини Ацерет следует сразу за днями Суккота. Это отдельный праздник, завершающий осенний праздничный период.',
  },
  'Simchat Torah': {
    descriptionRu:
      'Симхат Тора отмечает завершение и новое начало годового цикла чтения Торы. День связан с радостью Торы и общинным празднованием.',
  },
  Sukkot: {
    descriptionRu:
      'Суккот напоминает о странствиях еврейского народа в пустыне и о доверии Всевышнему. Это один из трех паломнических праздников.',
  },
  'Ta\'anit Esther': {
    descriptionRu:
      'Пост Эстер связан с событиями, предшествующими Пуриму. Он напоминает о молитве, единстве и тревожном ожидании перед спасением.',
  },
  'Tish\'a B\'Av': {
    descriptionRu:
      '9 Ава - день траура в еврейском календаре. Он связан с разрушением Первого и Второго Храма и памятью о трагических событиях еврейской истории.',
  },
  'Tu B\'Av': {
    descriptionRu:
      'Ту бе-Ав - радостная дата еврейского календаря. В традиции она связана с темами примирения, любви и добрых перемен.',
  },
  'Tu BiShvat': {
    descriptionRu:
      'Ту би-Шват называют новым годом деревьев. День связан с благодарностью за плоды земли и вниманием к миру творения.',
  },
  'Tzom Tammuz': {
    descriptionRu:
      '17 Тамуза - пост, с которого начинается период траура трех недель перед 9 Ава. Эта дата связана с разрушением стен Иерусалима и памятью о трагических событиях еврейской истории. Здесь дано только краткое информационное описание.',
  },
  'Yom HaAtzma\'ut': {
    descriptionRu:
      'Йом ха-Ацмаут отмечает День независимости Государства Израиль. В календаре это современная памятная дата, связанная с благодарностью и историей народа Израиля.',
  },
  'Yom HaShoah': {
    descriptionRu:
      'Йом ха-Шоа - день памяти Катастрофы и героизма. Он посвящен памяти жертв Холокоста и сохранению исторической памяти.',
  },
  'Yom HaZikaron': {
    descriptionRu:
      'Йом ха-Зикарон - день памяти павших солдат Израиля и жертв террора. Это современная памятная дата еврейского календаря.',
  },
  'Yom Kippur': {
    descriptionRu:
      'Йом Кипур - День искупления и один из самых значимых дней еврейского года. Он связан с тшувой, молитвой и внутренним исправлением.',
  },
  'Yom Yerushalayim': {
    descriptionRu:
      'Йом Йерушалаим отмечает объединение Иерусалима в 1967 году. Это современная дата, связанная с памятью о городе и его значении для еврейского народа.',
  },
};

function normalizeBasename(name: string) {
  return name
    .replace(/:.*$/, '')
    .replace(/\s+\d+$/, '')
    .replace(/\s+\([^)]*\)$/, '')
    .trim();
}

export function getJewishCalendarEventMeta(
  nameEn: string,
  kind: JewishCalendarEventKind,
): JewishCalendarEventMeta {
  const meta = EVENT_META_BY_BASENAME[nameEn] ?? EVENT_META_BY_BASENAME[normalizeBasename(nameEn)];

  return {
    descriptionRu: meta?.descriptionRu ?? FALLBACK_DESCRIPTION_RU,
    observanceNoteRu: meta?.observanceNoteRu,
    typeLabelRu: meta?.typeLabelRu ?? TYPE_LABEL_RU[kind],
  };
}
