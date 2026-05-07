import type { Blessing, BlessingInsertRule } from '@/types/blessing';

function createAfterFoodDynamicInsertRules(targetBlockKey: string): readonly BlessingInsertRule[] {
  return [
    {
      key: 'al_hanisim_hanukkah',
      flag: 'hanukkah',
      titleRu: 'Аль hанисим для Хануки',
      placement: 'after_block',
      targetBlockKey,
      contentBlocks: [
        {
          key: 'placeholder',
          kind: 'insert',
          bodyRu: 'Placeholder вставки Аль hанисим для Хануки. Требуется проверенный текст.',
          needsVerification: true,
        },
      ],
      needsVerification: true,
    },
    {
      key: 'al_hanisim_purim',
      flag: 'purim',
      titleRu: 'Аль hанисим для Пурима',
      placement: 'after_block',
      targetBlockKey,
      contentBlocks: [
        {
          key: 'placeholder',
          kind: 'insert',
          bodyRu: 'Placeholder вставки Аль hанисим для Пурима. Требуется проверенный текст.',
          needsVerification: true,
        },
      ],
      needsVerification: true,
    },
    {
      key: 'yaale_veyavo_rosh_chodesh',
      flag: 'rosh_chodesh',
      titleRu: 'Яале ве-яво для Рош Ходеш',
      placement: 'after_block',
      targetBlockKey,
      contentBlocks: [
        {
          key: 'placeholder',
          kind: 'insert',
          bodyRu: 'Placeholder вставки Яале ве-яво для Рош Ходеш. Требуется проверенный текст.',
          needsVerification: true,
        },
      ],
      needsVerification: true,
    },
    {
      key: 'yaale_veyavo_chol_hamoed_pesach',
      flag: 'chol_hamoed_pesach',
      titleRu: 'Яале ве-яво для Холь hа-Моэд Песах',
      placement: 'after_block',
      targetBlockKey,
      contentBlocks: [
        {
          key: 'placeholder',
          kind: 'insert',
          bodyRu: 'Placeholder вставки Яале ве-яво для Холь hа-Моэд Песах. Требуется проверенный текст.',
          needsVerification: true,
        },
      ],
      needsVerification: true,
    },
    {
      key: 'yaale_veyavo_chol_hamoed_sukkot',
      flag: 'chol_hamoed_sukkot',
      titleRu: 'Яале ве-яво для Холь hа-Моэд Суккот',
      placement: 'after_block',
      targetBlockKey,
      contentBlocks: [
        {
          key: 'placeholder',
          kind: 'insert',
          bodyRu: 'Placeholder вставки Яале ве-яво для Холь hа-Моэд Суккот. Требуется проверенный текст.',
          needsVerification: true,
        },
      ],
      needsVerification: true,
    },
  ];
}

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
