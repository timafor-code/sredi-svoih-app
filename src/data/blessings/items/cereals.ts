import type { BlessingItemTuple } from '@/types/blessing';

export const cerealItems = [
  [
    'cereal',
    'Сухой завтрак',
    'conditional',
    ['сухой завтрак', 'хлопья', 'cereal', 'breakfast cereal'],
    {
      category: 'cereals',
      complexity: 'conditional',
      conditionKeys: ['depends_on_grain_content', 'depends_on_preparation'],
      disputeKeys: ['cereal_case'],
      needsVerification: true,
    },
  ],
  [
    'cornflakes',
    'Кукурузные хлопья',
    'conditional',
    ['кукурузные хлопья', 'корнфлекс', 'cornflakes', 'corn flakes'],
    {
      category: 'cereals',
      complexity: 'conditional',
      conditionKeys: ['depends_on_grain_content', 'depends_on_preparation'],
      disputeKeys: ['corn_case', 'cereal_case'],
      needsVerification: true,
    },
  ],
  [
    'oatmeal_cereal',
    'Овсяные хлопья',
    'conditional',
    ['овсяные хлопья', 'овсянка хлопья', 'oatmeal cereal', 'oat cereal'],
    {
      category: 'cereals',
      complexity: 'conditional',
      conditionKeys: ['depends_on_grain_content', 'depends_on_preparation', 'cooked_grain_case'],
      disputeKeys: ['oatmeal_case', 'cereal_case'],
      needsVerification: true,
    },
  ],
  [
    'granola_cereal',
    'Гранола как сухой завтрак',
    'conditional',
    ['гранола сухой завтрак', 'granola cereal'],
    {
      category: 'cereals',
      complexity: 'conditional',
      conditionKeys: ['depends_on_grain_content', 'depends_on_preparation'],
      disputeKeys: ['granola_case', 'cereal_case'],
      needsVerification: true,
    },
  ],
  [
    'chocolate_cereal',
    'Шоколадные хлопья',
    'conditional',
    ['шоколадные хлопья', 'шоколадный сухой завтрак', 'chocolate cereal'],
    {
      category: 'cereals',
      complexity: 'conditional',
      conditionKeys: ['depends_on_grain_content', 'depends_on_preparation'],
      disputeKeys: ['cereal_case'],
      needsVerification: true,
    },
  ],
  [
    'rice_cereal',
    'Рисовые хлопья',
    'conditional',
    ['рисовые хлопья', 'рисовый сухой завтрак', 'rice cereal'],
    {
      category: 'cereals',
      complexity: 'conditional',
      conditionKeys: ['depends_on_grain_content', 'depends_on_preparation'],
      disputeKeys: ['rice_case', 'cereal_case'],
      needsVerification: true,
    },
  ],
] as const satisfies readonly BlessingItemTuple[];
