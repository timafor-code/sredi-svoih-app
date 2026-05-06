import type { BlessingItemTuple } from '@/types/blessing';

export const grainItems = [
  ['bread', 'Хлеб', 'bread_meal', ['хлеб', 'хала', 'challah', 'bread', 'לחם'], { category: 'grains' }],
  ['matzah', 'Маца', 'bread_meal', ['маца', 'матца', 'matzah', 'מצה'], { category: 'grains' }],
  [
    'pasta',
    'Паста',
    'conditional',
    ['паста', 'макароны', 'spaghetti', 'pasta'],
    {
      category: 'grains',
      complexity: 'conditional',
      conditionKeys: ['ask_rav_mixed_food'],
      disputeKeys: ['pasta_case'],
      needsVerification: true,
    },
  ],
  [
    'rice',
    'Рис',
    'conditional',
    ['рис', 'rice'],
    {
      category: 'grains',
      complexity: 'conditional',
      conditionKeys: ['ask_rav_mixed_food'],
      disputeKeys: ['rice_case'],
      needsVerification: true,
    },
  ],
] as const satisfies readonly BlessingItemTuple[];
