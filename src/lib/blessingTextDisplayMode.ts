import type {
  BlessingLanguage,
  BlessingTextDisplayMode,
  BlessingTextNusach,
  BlessingTransliterationStyle,
  BlessingTranslitNusach,
} from '@/types/blessing';

const displayModesByTextNusach: Record<
  BlessingTextNusach,
  readonly BlessingTextDisplayMode[]
> = {
  chabad: ['he', 'translit_ashkenaz', 'translit_sephard', 'ru'],
  beit_sefaradi: ['he', 'translit_sephard', 'ru'],
};

export function getAvailableBlessingTextDisplayModes(
  selectedTextNusach: BlessingTextNusach,
): readonly BlessingTextDisplayMode[] {
  return displayModesByTextNusach[selectedTextNusach];
}

export function getDisplayModeLanguage(
  mode: BlessingTextDisplayMode,
): BlessingLanguage {
  switch (mode) {
    case 'he':
      return 'he';
    case 'ru':
      return 'ru';
    case 'translit_ashkenaz':
    case 'translit_sephard':
      return 'translit';
  }
}

export function getDisplayModeTranslitNusach(
  mode: BlessingTextDisplayMode,
): BlessingTranslitNusach | undefined {
  switch (mode) {
    case 'translit_ashkenaz':
      return 'ashkenaz';
    case 'translit_sephard':
      return 'sephard';
    case 'he':
    case 'ru':
      return undefined;
  }
}

export function getDisplayModeTransliterationStyle(
  mode: BlessingTextDisplayMode,
): BlessingTransliterationStyle | undefined {
  switch (mode) {
    case 'translit_ashkenaz':
      return 'ashkenazi';
    case 'translit_sephard':
      return 'sephardi';
    case 'he':
    case 'ru':
      return undefined;
  }
}

export function normalizeBlessingTextDisplayMode(value: unknown): BlessingTextDisplayMode {
  switch (value) {
    case 'he':
    case 'translit_ashkenaz':
    case 'translit_sephard':
    case 'ru':
      return value;
    default:
      return 'ru';
  }
}

export function normalizeDisplayModeForTextNusach(
  mode: BlessingTextDisplayMode,
  selectedTextNusach: BlessingTextNusach,
): BlessingTextDisplayMode {
  const availableModes = getAvailableBlessingTextDisplayModes(selectedTextNusach);

  if (availableModes.includes(mode)) {
    return mode;
  }

  if (mode === 'translit_ashkenaz') {
    return 'translit_sephard';
  }

  return availableModes[0] ?? 'ru';
}
