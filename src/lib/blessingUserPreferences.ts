import type {
  BlessingTextNusach,
  BlessingTransliterationStyle,
  BlessingTranslitNusach,
} from '@/types/blessing';
import { isProfileNusach, type ProfileNusach } from '@/types/profile';

export type BlessingUserPreferences = {
  selectedTextNusach: BlessingTextNusach;
  transliterationStyle: BlessingTransliterationStyle;
  translitNusach: BlessingTranslitNusach;
};

const ashkenaziDefaults: BlessingUserPreferences = {
  selectedTextNusach: 'chabad',
  transliterationStyle: 'ashkenazi',
  translitNusach: 'ashkenaz',
};

const blessingPreferencesByProfileNusach: Record<ProfileNusach, BlessingUserPreferences> = {
  ashkenaz: ashkenaziDefaults,
  chabad: ashkenaziDefaults,
  common: ashkenaziDefaults,
  sephardi: {
    selectedTextNusach: 'beit_sefaradi',
    transliterationStyle: 'sephardi',
    translitNusach: 'sephard',
  },
};

export function resolveBlessingUserPreferences(
  profileNusach: string | null | undefined,
): BlessingUserPreferences {
  const normalizedNusach = isProfileNusach(profileNusach) ? profileNusach : 'common';

  return blessingPreferencesByProfileNusach[normalizedNusach];
}
