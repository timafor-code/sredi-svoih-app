import type { BlessingItemTuple } from '@/types/blessing';

export const bakedGoodItems = [
  ['cookies', 'Печенье', 'mezonot_al_hamichya', ['печенье', 'cookies', 'cookie'], { category: 'baked_goods' }],
  ['cake', 'Торт', 'mezonot_al_hamichya', ['торт', 'кекс', 'cake'], { category: 'baked_goods' }],
  ['cracker', 'Крекер', 'mezonot_al_hamichya', ['крекер', 'cracker'], { category: 'baked_goods' }],
  [
    'pizza',
    'Пицца',
    'conditional',
    ['пицца', 'pizza'],
    {
      category: 'baked_goods',
      complexity: 'conditional',
      conditionKeys: ['ask_rav_mixed_food'],
      disputeKeys: ['pizza_case'],
      needsVerification: true,
    },
  ],
] as const satisfies readonly BlessingItemTuple[];
