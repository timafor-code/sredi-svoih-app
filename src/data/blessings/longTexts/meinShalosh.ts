import { birkatHamazonChabadHebrewBlocks } from './birkatHamazon';
import type { Blessing, BlessingContentBlock, BlessingNusachVariant } from '@/types/blessing';

type MeinShaloshVariantKey = 'al_hamichya' | 'al_hagefen' | 'al_haetz';

const meinShaloshChabadSourceName = 'External Mein Shalosh Hebrew source map';

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
    bodyRu: `${variant.contextRu} Текст нусаха ${titleRu} пока недоступен.`,
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
      bodyRu: `Текст для ${blessingTitleRu} (${nusachTitleRu}) пока недоступен.`,
      needsVerification: true,
    },
  ];
}

function getBirkatHamazonHebrewBlock(key: string): BlessingContentBlock {
  const block = birkatHamazonChabadHebrewBlocks.find((item) => item.key === key);

  if (!block) {
    throw new Error(`Missing Birkat Hamazon Hebrew block: ${key}`);
  }

  return block;
}

function createMeinShaloshAlHanisimBlock({
  annotationRu,
  calendarFlag,
  calendarFlags,
  key,
  sourceKey,
  titleRu,
}: {
  annotationRu: string;
  calendarFlag?: BlessingContentBlock['calendarFlag'];
  calendarFlags?: BlessingContentBlock['calendarFlags'];
  key: string;
  sourceKey: string;
  titleRu: string;
}): BlessingContentBlock {
  const source = getBirkatHamazonHebrewBlock(sourceKey);

  return {
    ...source,
    annotationRu,
    calendarFlag,
    calendarFlags,
    key,
    kind: 'insert',
    language: 'he',
    renderVariant: 'insert',
    titleRu,
    triggerMode: 'hebcal',
    needsVerification: true,
  };
}

const meinShaloshAlHanisimBlocks = [
  createMeinShaloshAlHanisimBlock({
    annotationRu: 'В Хануку и Пурим добавляют этот блок.',
    calendarFlags: ['hanukkah', 'purim'],
    key: 'al_hanisim_opening_he',
    sourceKey: 'al_hanisim_opening_he',
    titleRu: 'Вставка: Аль hанисим',
  }),
  createMeinShaloshAlHanisimBlock({
    annotationRu: 'Показывается в Хануку.',
    calendarFlag: 'hanukkah',
    key: 'al_hanisim_hanukkah_he',
    sourceKey: 'al_hanisim_hanukkah_he',
    titleRu: 'Аль hанисим для Хануки',
  }),
  createMeinShaloshAlHanisimBlock({
    annotationRu: 'Показывается в Пурим.',
    calendarFlag: 'purim',
    key: 'al_hanisim_purim_he',
    sourceKey: 'al_hanisim_purim_he',
    titleRu: 'Аль hанисим для Пурима',
  }),
] satisfies readonly BlessingContentBlock[];

const meinShaloshOpeningVariantBlocks = [
  {
    key: 'variant_opening_al_hamichya_he',
    kind: 'variant',
    language: 'he',
    variantKey: 'al_hamichya',
    variantLabelRu: 'Аль hамихья — после пищи из пяти видов злаков',
    titleRu: 'Аль hамихья — начало',
    annotationRu: 'После пищи из пяти видов злаков.',
    bodyRu: `עַל הַמִּחְיָה
וְעַל הַכַּלְכָּלָה,`,
    needsVerification: true,
  },
  {
    key: 'variant_opening_al_hagefen_he',
    kind: 'variant',
    language: 'he',
    variantKey: 'al_hagefen',
    variantLabelRu: 'Аль hагефен — после вина или виноградного сока',
    titleRu: 'Аль hагефен — начало',
    annotationRu: 'После вина или виноградного сока.',
    bodyRu: `וְעַל הַגֶּפֶן
וְעַל פְּרִי הַגֶּפֶן`,
    needsVerification: true,
  },
  {
    key: 'variant_opening_al_haetz_he',
    kind: 'variant',
    language: 'he',
    variantKey: 'al_haetz',
    variantLabelRu: 'Аль hаэц — после винограда, инжира, граната, оливок или фиников',
    titleRu: 'Аль hаэц — начало',
    annotationRu: 'После винограда, инжира, граната, оливок или фиников.',
    bodyRu: `וְעַל הָעֵץ
וְעַל פְּרִי הָעֵץ`,
    needsVerification: true,
  },
] as const satisfies readonly BlessingContentBlock[];

const meinShaloshNearClosingVariantBlocks = [
  {
    key: 'near_closing_variant_al_hamichya_he',
    kind: 'variant',
    language: 'he',
    variantKey: 'al_hamichya',
    variantLabelRu: 'Аль hамихья — перед заключительной формулой',
    titleRu: 'Аль hамихья — перед заключением',
    bodyRu: `הַמִּחְיָה.`,
    needsVerification: true,
  },
  {
    key: 'near_closing_variant_al_hagefen_he',
    kind: 'variant',
    language: 'he',
    variantKey: 'al_hagefen',
    variantLabelRu: 'Аль hагефен — перед заключительной формулой',
    titleRu: 'Аль hагефен — перед заключением',
    bodyRu: `פְּרִי הַגֶּפֶן.`,
    needsVerification: true,
  },
  {
    key: 'near_closing_variant_al_haetz_he',
    kind: 'variant',
    language: 'he',
    variantKey: 'al_haetz',
    variantLabelRu: 'Аль hаэц — перед заключительной формулой',
    titleRu: 'Аль hаэц — перед заключением',
    bodyRu: `הַפֵּרוֹת.`,
    needsVerification: true,
  },
] as const satisfies readonly BlessingContentBlock[];

const meinShaloshFinalVariantBlocks = [
  {
    key: 'final_variant_al_hamichya_he',
    kind: 'variant',
    language: 'he',
    variantKey: 'al_hamichya',
    variantLabelRu: 'Заключение: Аль hамихья',
    titleRu: 'Аль hамихья — заключение',
    bodyRu: `הַמִּחְיָה:`,
    needsVerification: true,
  },
  {
    key: 'final_variant_al_hagefen_he',
    kind: 'variant',
    language: 'he',
    variantKey: 'al_hagefen',
    variantLabelRu: 'Заключение: Аль hагефен',
    titleRu: 'Аль hагефен — заключение',
    annotationRu: 'Слово в скобках добавляют, когда соединяют несколько вариантов.',
    bodyRu: `(וְעַל) פְּרִי הַגֶּפֶן:`,
    needsVerification: true,
  },
  {
    key: 'final_variant_al_haetz_he',
    kind: 'variant',
    language: 'he',
    variantKey: 'al_haetz',
    variantLabelRu: 'Заключение: Аль hаэц',
    titleRu: 'Аль hаэц — заключение',
    annotationRu: 'Слово в скобках добавляют, когда соединяют несколько вариантов.',
    bodyRu: `(וְעַל) הַפֵּרוֹת:`,
    needsVerification: true,
  },
] as const satisfies readonly BlessingContentBlock[];

const meinShaloshStaticHebrewBlocks = [
  {
    key: 'opening_he',
    kind: 'text',
    language: 'he',
    titleRu: 'Начало благословения',
    bodyRu: `בָּרוּךְ אַתָּה יְיָ אֱלֹהֵינוּ מֶלֶךְ הָעוֹלָם,`,
    needsVerification: true,
  },
  {
    key: 'land_and_jerusalem_he',
    kind: 'text',
    language: 'he',
    titleRu: 'Основной текст',
    bodyRu: `וְעַל תְּנוּבַת הַשָּׂדֶה וְעַל אֶרֶץ חֶמְדָּה טוֹבָה וּרְחָבָה שֶׁרָצִיתָ וְהִנְחַלְתָּ לַאֲבוֹתֵינוּ לֶאֱכוֹל מִפִּרְיָהּ וְלִשְׂבֹּעַ מִטּוּבָהּ. רַחֵם נָא יְיָ אֱלֹהֵינוּ עַל יִשְׂרָאֵל עַמֶּךָ וְעַל יְרוּשָׁלַיִם עִירֶךָ וְעַל צִיּוֹן מִשְׁכַּן כְּבוֹדֶךָ וְעַל מִזְבְּחֶךָ וְעַל הֵיכָלֶךָ, וּבְנֵה יְרוּשָׁלַיִם עִיר הַקֹּדֶשׁ בִּמְהֵרָה בְיָמֵינוּ, וְהַעֲלֵנוּ לְתוֹכָהּ וְשַׂמְּחֵנוּ בָהּ וּנְבָרֶכְךָ בִּקְדֻשָּׁה וּבְטָהֳרָה.`,
    needsVerification: true,
  },
  {
    key: 'special_day_insert_shabbat_he',
    kind: 'insert',
    language: 'he',
    renderVariant: 'insert',
    titleRu: 'Вставка на Шабат',
    triggerMode: 'future_not_runtime',
    bodyRu: `וּרְצֵה וְהַחֲלִיצֵנוּ בְּיוֹם הַשַּׁבָּת הַזֶּה.`,
    needsVerification: true,
  },
  {
    key: 'special_day_insert_rosh_chodesh_he',
    kind: 'insert',
    language: 'he',
    calendarFlag: 'rosh_chodesh',
    renderVariant: 'insert',
    titleRu: 'Вставка на Рош Ходеш',
    triggerMode: 'hebcal',
    bodyRu: `וְזָכְרֵנוּ לְטוֹבָה בְּיוֹם רֹאשׁ הַחֹדֶשׁ הַזֶּה:`,
    needsVerification: true,
  },
  {
    key: 'special_day_insert_pesach_he',
    kind: 'insert',
    language: 'he',
    calendarFlag: 'chol_hamoed_pesach',
    renderVariant: 'insert',
    titleRu: 'Вставка на Песах',
    triggerMode: 'hebcal',
    bodyRu: `וְזָכְרֵנוּ לְטוֹבָה בְּיוֹם חַג הַמַּצּוֹת הַזֶּה:`,
    needsVerification: true,
  },
  {
    key: 'special_day_insert_shavuot_he',
    kind: 'insert',
    language: 'he',
    renderVariant: 'insert',
    titleRu: 'Вставка на Шавуот',
    triggerMode: 'future_not_runtime',
    bodyRu: `וְזָכְרֵנוּ לְטוֹבָה בְּיוֹם חַג הַשָּׁבוּעוֹת הַזֶּה:`,
    needsVerification: true,
  },
  {
    key: 'special_day_insert_sukkot_he',
    kind: 'insert',
    language: 'he',
    calendarFlag: 'chol_hamoed_sukkot',
    renderVariant: 'insert',
    titleRu: 'Вставка на Суккот',
    triggerMode: 'hebcal',
    bodyRu: `וְזָכְרֵנוּ לְטוֹבָה בְּיוֹם חַג הַסֻּכּוֹת הַזֶּה:`,
    needsVerification: true,
  },
  {
    key: 'special_day_insert_shemini_atzeret_he',
    kind: 'insert',
    language: 'he',
    renderVariant: 'insert',
    titleRu: 'Вставка на Шмини Ацерет',
    triggerMode: 'future_not_runtime',
    bodyRu: `וְזָכְרֵנוּ לְטוֹבָה בְּיוֹם שְׁמִינִי עֲצֶרֶת הַחַג הַזֶּה:`,
    needsVerification: true,
  },
  {
    key: 'special_day_insert_rosh_hashanah_he',
    kind: 'insert',
    language: 'he',
    renderVariant: 'insert',
    titleRu: 'Вставка на Рош hа-Шана',
    triggerMode: 'future_not_runtime',
    bodyRu: `וְזָכְרֵנוּ לְטוֹבָה בְּיוֹם הַזִּכָּרוֹן הַזֶּה:`,
    needsVerification: true,
  },
  {
    key: 'closing_before_final_variants_he',
    kind: 'text',
    language: 'he',
    titleRu: 'Перед заключением',
    bodyRu: `כִּי אַתָּה יְיָ טוֹב וּמֵטִיב לַכֹּל וְנוֹדֶה לְּךָ עַל הָאָרֶץ וְעַל`,
    needsVerification: true,
  },
  {
    key: 'final_bracha_opening_he',
    kind: 'text',
    language: 'he',
    titleRu: 'Заключительная формула',
    bodyRu: `בָּרוּךְ אַתָּה יְיָ עַל הָאָרֶץ וְעַל`,
    needsVerification: true,
  },
] as const satisfies readonly BlessingContentBlock[];

function filterVariantBlocks(
  blocks: readonly BlessingContentBlock[],
  variantKey?: MeinShaloshVariantKey,
): BlessingContentBlock[] {
  return blocks.filter((block) => !variantKey || block.variantKey === variantKey);
}

function createMeinShaloshChabadHebrewContentBlocks(
  variantKey?: MeinShaloshVariantKey,
): readonly BlessingContentBlock[] {
  return [
    meinShaloshStaticHebrewBlocks[0],
    ...filterVariantBlocks(meinShaloshOpeningVariantBlocks, variantKey),
    meinShaloshStaticHebrewBlocks[1],
    ...meinShaloshAlHanisimBlocks,
    ...meinShaloshStaticHebrewBlocks.slice(2, 9),
    meinShaloshStaticHebrewBlocks[9],
    ...filterVariantBlocks(meinShaloshNearClosingVariantBlocks, variantKey),
    meinShaloshStaticHebrewBlocks[10],
    ...filterVariantBlocks(meinShaloshFinalVariantBlocks, variantKey),
  ];
}

function createMeinShaloshNusachVariants(
  blessingTitleRu: string,
  variantKey: MeinShaloshVariantKey,
): readonly BlessingNusachVariant[] {
  return [
    {
      nusach: 'chabad',
      titleRu: 'Хабад',
      contentBlocks: createMeinShaloshChabadHebrewContentBlocks(variantKey),
      sourceName: meinShaloshChabadSourceName,
      needsVerification: true,
    },
    {
      nusach: 'beit_sefaradi',
      titleRu: 'Бейт Сфаради',
      contentBlocks: createMeinShaloshPlaceholderBlocks(blessingTitleRu, 'Бейт Сфаради'),
      needsVerification: true,
    },
  ];
}

const meinShaloshNusachVariants = [
  {
    nusach: 'chabad',
    titleRu: 'Хабад',
    contentBlocks: createMeinShaloshChabadHebrewContentBlocks(),
    sourceName: meinShaloshChabadSourceName,
    needsVerification: true,
  },
  {
    nusach: 'beit_sefaradi',
    titleRu: 'Бейт Сфаради',
    contentBlocks: createMeinShaloshOverviewBlocks('Бейт Сфаради'),
    needsVerification: true,
  },
] as const satisfies readonly BlessingNusachVariant[];

const meinShaloshAlHamichyaNusachVariants = createMeinShaloshNusachVariants(
  'Аль hамихья',
  'al_hamichya',
);

const meinShaloshAlHagefenNusachVariants = createMeinShaloshNusachVariants(
  'Аль hагефен',
  'al_hagefen',
);

const meinShaloshAlHaetzNusachVariants = createMeinShaloshNusachVariants(
  'Аль hаэц',
  'al_haetz',
);

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
      'аль хамихья',
      'аль hамихья',
      'ал hамихья',
      'аль гефен',
      'ал гефен',
      'аль hагефен',
      'ал hагефен',
      'аль аэц',
      'ал аэц',
      'аль hаэц',
      'ал hаэц',
      'mein shalosh',
    ],
    home: { enabled: true, group: 'after_food', order: 20 },
    contentBlocks: createMeinShaloshOverviewBlocks('Мейн Шалош'),
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
    displayMode: 'full_text',
    aliases: [
      'аль hамихья',
      'ал hамихья',
      'аль хамихья',
      'ал хамихья',
      'мезонот после',
      'al hamichya',
    ],
    contentBlocks: createMeinShaloshPlaceholderBlocks('Аль hамихья', 'общий'),
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
    displayMode: 'full_text',
    aliases: [
      'аль hагефен',
      'ал hагефен',
      'аль гефен',
      'ал гефен',
      'после вина',
      'al hagefen',
    ],
    contentBlocks: createMeinShaloshPlaceholderBlocks('Аль hагефен', 'общий'),
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
    displayMode: 'full_text',
    aliases: [
      'аль hаэц',
      'ал hаэц',
      'аль аэц',
      'ал аэц',
      'ал хаэц',
      'после семи видов',
      'al haetz',
    ],
    contentBlocks: createMeinShaloshPlaceholderBlocks('Аль hаэц', 'общий'),
    nusachVariants: meinShaloshAlHaetzNusachVariants,
    needsVerification: true,
  },
] as const satisfies readonly Blessing[];
