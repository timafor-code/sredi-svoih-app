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

const meinShaloshDynamicInsertRules = createAfterFoodDynamicInsertRules('al_haetz');
const meinShaloshVariantDynamicInsertRules = createAfterFoodDynamicInsertRules('placeholder');

export const meinShaloshBlessings = [
  {
    slug: 'mein_shalosh',
    titleRu: 'Мейн Шалош',
    titleHe: 'מעין שלוש',
    titleTranslit: 'Mein shalosh',
    descriptionRu: 'Общий пункт быстрого доступа, когда контекст продукта неизвестен.',
    category: 'after_food',
    displayMode: 'variants',
    aliases: [
      'мейн шалош',
      'меин шалош',
      'мэйн шалош',
      'ал хамихья',
      'аль hамихья',
      'ал hамихья',
      'аль hагефен',
      'ал hагефен',
      'аль hаэц',
      'ал hаэц',
      'mein shalosh',
    ],
    home: { enabled: true, group: 'after_food', order: 20 },
    contentBlocks: [
      {
        key: 'al_hamichya',
        kind: 'variant',
        titleRu: 'Аль hамихья',
        bodyRu: 'После мезонот / мучных изделий. Placeholder для будущего проверенного текста.',
        blessingSlug: 'mein_shalosh_al_hamichya',
        needsVerification: true,
      },
      {
        key: 'al_hagefen',
        kind: 'variant',
        titleRu: 'Аль hагефен',
        bodyRu: 'После вина / виноградного сока. Placeholder для будущего проверенного текста.',
        blessingSlug: 'mein_shalosh_al_hagefen',
        needsVerification: true,
      },
      {
        key: 'al_haetz',
        kind: 'variant',
        titleRu: 'Аль hаэц',
        bodyRu: 'После плодов семи видов. Placeholder для будущего проверенного текста.',
        blessingSlug: 'mein_shalosh_al_haetz',
        needsVerification: true,
      },
    ],
    dynamicInsertRules: meinShaloshDynamicInsertRules,
    needsVerification: true,
  },
  {
    slug: 'mein_shalosh_al_hamichya',
    titleRu: 'Мейн Шалош - Аль hамихья',
    titleHe: 'על המחיה',
    titleTranslit: 'Mein shalosh - Al hamichya',
    descriptionRu: 'Контекстный вариант после мезонот / мучных изделий.',
    category: 'after_food',
    displayMode: 'placeholder',
    aliases: ['аль hамихья', 'ал hамихья', 'ал хамихья', 'мезонот после', 'al hamichya'],
    contentBlocks: [
      {
        key: 'placeholder',
        kind: 'placeholder',
        bodyRu: 'Placeholder для варианта Аль hамихья. Требуется проверенный текст.',
        needsVerification: true,
      },
    ],
    dynamicInsertRules: meinShaloshVariantDynamicInsertRules,
    needsVerification: true,
  },
  {
    slug: 'mein_shalosh_al_hagefen',
    titleRu: 'Мейн Шалош - Аль hагефен',
    titleHe: 'על הגפן',
    titleTranslit: 'Mein shalosh - Al hagefen',
    descriptionRu: 'Контекстный вариант после вина / виноградного сока.',
    category: 'after_food',
    displayMode: 'placeholder',
    aliases: ['аль hагефен', 'ал hагефен', 'ал гефен', 'после вина', 'al hagefen'],
    contentBlocks: [
      {
        key: 'placeholder',
        kind: 'placeholder',
        bodyRu: 'Placeholder для варианта Аль hагефен. Требуется проверенный текст.',
        needsVerification: true,
      },
    ],
    dynamicInsertRules: meinShaloshVariantDynamicInsertRules,
    needsVerification: true,
  },
  {
    slug: 'mein_shalosh_al_haetz',
    titleRu: 'Мейн Шалош - Аль hаэц',
    titleHe: 'על העץ',
    titleTranslit: 'Mein shalosh - Al haetz',
    descriptionRu: 'Контекстный вариант после плодов семи видов.',
    category: 'after_food',
    displayMode: 'placeholder',
    aliases: ['аль hаэц', 'ал hаэц', 'ал хаэц', 'после семи видов', 'al haetz'],
    contentBlocks: [
      {
        key: 'placeholder',
        kind: 'placeholder',
        bodyRu: 'Placeholder для варианта Аль hаэц. Требуется проверенный текст.',
        needsVerification: true,
      },
    ],
    dynamicInsertRules: meinShaloshVariantDynamicInsertRules,
    needsVerification: true,
  },
] as const satisfies readonly Blessing[];
