import { createAfterFoodDynamicInsertRules } from './afterFoodInsertRules';
import type { Blessing } from '@/types/blessing';

const birkatHamazonDynamicInsertRules = createAfterFoodDynamicInsertRules('placeholder');

export const birkatHamazonBlessings = [
  {
    slug: 'birkat_hamazon',
    titleRu: 'Биркат hамазон',
    titleHe: 'ברכת המזון',
    titleTranslit: 'Birkat hamazon',
    descriptionRu: 'Благословение после хлебной трапезы.',
    category: 'after_food',
    displayMode: 'placeholder',
    aliases: ['биркат hамазон', 'биркат хамазон', 'бенчинг', 'после хлеба', 'birkat hamazon'],
    home: { enabled: true, group: 'after_food', order: 10 },
    contentBlocks: [
      {
        key: 'placeholder',
        kind: 'placeholder',
        bodyRu: 'Placeholder для Биркат hамазон. Полный текст требует отдельной проверки.',
        needsVerification: true,
      },
    ],
    dynamicInsertRules: birkatHamazonDynamicInsertRules,
    needsVerification: true,
  },
] as const satisfies readonly Blessing[];
