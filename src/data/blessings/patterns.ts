import type { BlessingPattern } from '@/types/blessing';

export const blessingPatterns = [
  {
    key: 'bread_meal',
    steps: ['netilat_yadayim', 'hamotzi', 'birkat_hamazon'],
  },
  {
    key: 'tree_fruit_regular',
    steps: ['bore_pri_haetz', 'bore_nefashot'],
    conditionKeys: ['after_blessing_if_required_amount'],
  },
  {
    key: 'seven_species_fruit',
    steps: ['bore_pri_haetz', 'mein_shalosh_al_haetz'],
    conditionKeys: ['kazayit_within_time'],
  },
  {
    key: 'ground_fruit_regular',
    steps: ['bore_pri_haadama', 'bore_nefashot'],
    conditionKeys: ['after_blessing_if_required_amount'],
  },
  {
    key: 'shehakol_regular',
    steps: ['shehakol', 'bore_nefashot'],
    conditionKeys: ['after_blessing_if_required_amount'],
  },
  {
    key: 'drink_shehakol',
    steps: ['shehakol', 'bore_nefashot'],
    conditionKeys: ['drink_for_benefit', 'reviit_within_time'],
  },
  {
    key: 'wine_grape',
    steps: ['bore_pri_hagafen', 'mein_shalosh_al_hagefen'],
    conditionKeys: ['reviit_within_time'],
  },
  {
    key: 'mezonot_al_hamichya',
    steps: ['bore_minei_mezonot', 'mein_shalosh_al_hamichya'],
    conditionKeys: ['kazayit_within_time'],
  },
  {
    key: 'mezonot_bore_nefashot',
    steps: ['bore_minei_mezonot', 'bore_nefashot'],
    conditionKeys: ['after_blessing_if_required_amount'],
  },
  {
    key: 'conditional',
    steps: [],
    conditionKeys: ['ask_rav_mixed_food'],
  },
] as const satisfies readonly BlessingPattern[];
