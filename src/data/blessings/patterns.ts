import type { BlessingPattern } from '@/types/blessing';

export const blessingPatterns = [
  {
    key: 'hamotzi_meal',
    steps: ['netilat_yadayim', 'hamotzi', 'birkat_hamazon'],
    conditionKeys: ['bread_meal_context'],
  },
  {
    key: 'bread_meal',
    steps: ['netilat_yadayim', 'hamotzi', 'birkat_hamazon'],
    conditionKeys: ['bread_meal_context'],
  },
  {
    key: 'haetz_bore_nefashot',
    steps: ['bore_pri_haetz', 'bore_nefashot'],
    conditionKeys: ['after_blessing_if_required_amount'],
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
    key: 'haadama_bore_nefashot',
    steps: ['bore_pri_haadama', 'bore_nefashot'],
    conditionKeys: ['after_blessing_if_required_amount'],
  },
  {
    key: 'ground_fruit_regular',
    steps: ['bore_pri_haadama', 'bore_nefashot'],
    conditionKeys: ['after_blessing_if_required_amount'],
  },
  {
    key: 'shehakol_bore_nefashot',
    steps: ['shehakol', 'bore_nefashot'],
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
    conditionKeys: ['drink_for_thirst_or_pleasure', 'reviit_within_time'],
  },
  {
    key: 'hagafen_al_hagefen',
    steps: ['bore_pri_hagafen', 'mein_shalosh_al_hagefen'],
    conditionKeys: ['reviit_within_time'],
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
  {
    key: 'complex',
    steps: [],
    conditionKeys: ['complex_case_requires_review'],
  },
  {
    key: 'no_bracha',
    steps: [],
    conditionKeys: ['no_bracha_when_not_edible_or_not_enjoyed'],
  },
  {
    key: 'no_blessing',
    steps: [],
    conditionKeys: ['no_bracha_when_not_edible_or_not_enjoyed'],
  },
] as const satisfies readonly BlessingPattern[];
