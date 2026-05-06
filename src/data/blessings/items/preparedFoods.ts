import type { BlessingItemTuple } from '@/types/blessing';

export const preparedFoodItems = [
  [
    'soup',
    'Суп',
    'conditional',
    ['суп', 'soup'],
    {
      category: 'prepared_foods',
      complexity: 'conditional',
      conditionKeys: ['ask_rav_mixed_food'],
      needsVerification: true,
    },
  ],
  [
    'salad',
    'Салат',
    'conditional',
    ['салат', 'salad'],
    {
      category: 'prepared_foods',
      complexity: 'conditional',
      conditionKeys: ['ask_rav_mixed_food'],
      needsVerification: true,
    },
  ],
  [
    'sandwich',
    'Сэндвич',
    'conditional',
    ['сэндвич', 'сандвич', 'бутерброд', 'sandwich'],
    {
      category: 'prepared_foods',
      complexity: 'conditional',
      conditionKeys: ['ask_rav_mixed_food'],
      needsVerification: true,
    },
  ],
] as const satisfies readonly BlessingItemTuple[];
