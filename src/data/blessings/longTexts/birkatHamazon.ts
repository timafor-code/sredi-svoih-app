import { createAfterFoodDynamicInsertRules } from './afterFoodInsertRules';
import type { Blessing, BlessingNusachVariant } from '@/types/blessing';

const birkatHamazonDynamicInsertRules = createAfterFoodDynamicInsertRules('placeholder');

function createBirkatHamazonPlaceholderBlocks(titleRu: string): BlessingNusachVariant['contentBlocks'] {
  return [
    {
      key: 'placeholder',
      kind: 'placeholder',
      titleRu,
      bodyRu: `Placeholder для Биркат hамазон (${titleRu}). Полный текст требует отдельной проверки.`,
      needsVerification: true,
    },
  ];
}

const birkatHamazonNusachVariants = [
  {
    nusach: 'chabad',
    titleRu: 'Хабад',
    contentBlocks: createBirkatHamazonPlaceholderBlocks('Хабад'),
    dynamicInsertRules: birkatHamazonDynamicInsertRules,
    needsVerification: true,
  },
  {
    nusach: 'beit_sefaradi',
    titleRu: 'Бейт Сфаради',
    contentBlocks: createBirkatHamazonPlaceholderBlocks('Бейт Сфаради'),
    dynamicInsertRules: birkatHamazonDynamicInsertRules,
    needsVerification: true,
  },
] as const satisfies readonly BlessingNusachVariant[];

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
    nusachVariants: birkatHamazonNusachVariants,
    needsVerification: true,
  },
] as const satisfies readonly Blessing[];
