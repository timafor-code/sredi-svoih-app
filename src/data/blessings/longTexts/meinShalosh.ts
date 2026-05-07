import { createAfterFoodDynamicInsertRules } from './afterFoodInsertRules';
import type { Blessing, BlessingNusachVariant } from '@/types/blessing';

const meinShaloshDynamicInsertRules = createAfterFoodDynamicInsertRules('al_haetz');
const meinShaloshVariantDynamicInsertRules = createAfterFoodDynamicInsertRules('placeholder');

type MeinShaloshVariantKey = 'al_hamichya' | 'al_hagefen' | 'al_haetz';

const meinShaloshVariantMeta: ReadonlyArray<{
  key: MeinShaloshVariantKey;
  titleRu: string;
  contextRu: string;
  blessingSlug: string;
}> = [
  {
    key: 'al_hamichya',
    titleRu: 'Аль hамихья',
    contextRu: 'После мезонот / мучных изделий.',
    blessingSlug: 'mein_shalosh_al_hamichya',
  },
  {
    key: 'al_hagefen',
    titleRu: 'Аль hагефен',
    contextRu: 'После вина / виноградного сока.',
    blessingSlug: 'mein_shalosh_al_hagefen',
  },
  {
    key: 'al_haetz',
    titleRu: 'Аль hаэц',
    contextRu: 'После плодов семи видов.',
    blessingSlug: 'mein_shalosh_al_haetz',
  },
];

function createMeinShaloshOverviewBlocks(titleRu: string): BlessingNusachVariant['contentBlocks'] {
  return meinShaloshVariantMeta.map((variant) => ({
    key: variant.key,
    kind: 'variant',
    titleRu: variant.titleRu,
    bodyRu: `${variant.contextRu} Placeholder для нусаха ${titleRu}; полный текст требует проверки.`,
    blessingSlug: variant.blessingSlug,
    needsVerification: true,
  }));
}

function createMeinShaloshPlaceholderBlocks(
  blessingTitleRu: string,
  nusachTitleRu: string,
): BlessingNusachVariant['contentBlocks'] {
  return [
    {
      key: 'placeholder',
      kind: 'placeholder',
      bodyRu: `Placeholder для ${blessingTitleRu} (${nusachTitleRu}). Требуется проверенный текст.`,
      needsVerification: true,
    },
  ];
}

function createMeinShaloshNusachVariants(
  blessingTitleRu: string,
  dynamicInsertRules = meinShaloshVariantDynamicInsertRules,
): readonly BlessingNusachVariant[] {
  return [
    {
      nusach: 'chabad',
      titleRu: 'Хабад',
      contentBlocks: createMeinShaloshPlaceholderBlocks(blessingTitleRu, 'Хабад'),
      dynamicInsertRules,
      needsVerification: true,
    },
    {
      nusach: 'beit_sefaradi',
      titleRu: 'Бейт Сфаради',
      contentBlocks: createMeinShaloshPlaceholderBlocks(blessingTitleRu, 'Бейт Сфаради'),
      dynamicInsertRules,
      needsVerification: true,
    },
  ];
}

const meinShaloshNusachVariants = [
  {
    nusach: 'chabad',
    titleRu: 'Хабад',
    contentBlocks: createMeinShaloshOverviewBlocks('Хабад'),
    dynamicInsertRules: meinShaloshDynamicInsertRules,
    needsVerification: true,
  },
  {
    nusach: 'beit_sefaradi',
    titleRu: 'Бейт Сфаради',
    contentBlocks: createMeinShaloshOverviewBlocks('Бейт Сфаради'),
    dynamicInsertRules: meinShaloshDynamicInsertRules,
    needsVerification: true,
  },
] as const satisfies readonly BlessingNusachVariant[];

const meinShaloshAlHamichyaNusachVariants =
  createMeinShaloshNusachVariants('Аль hамихья');

const meinShaloshAlHagefenNusachVariants =
  createMeinShaloshNusachVariants('Аль hагефен');

const meinShaloshAlHaetzNusachVariants = createMeinShaloshNusachVariants('Аль hаэц');

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
    nusachVariants: meinShaloshNusachVariants,
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
    nusachVariants: meinShaloshAlHamichyaNusachVariants,
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
    nusachVariants: meinShaloshAlHagefenNusachVariants,
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
    nusachVariants: meinShaloshAlHaetzNusachVariants,
    needsVerification: true,
  },
] as const satisfies readonly Blessing[];
