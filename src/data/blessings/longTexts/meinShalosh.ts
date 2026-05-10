import type {
  Blessing,
  BlessingContentBlock,
  BlessingNusachVariant,
  BlessingTransliterationStyle,
  BlessingTranslitNusach,
} from '@/types/blessing';

type MeinShaloshVariantKey = 'al_hamichya' | 'al_hagefen' | 'al_haetz';

type MeinShaloshSourceBlock = BlessingContentBlock & {
  translitRuByStyle?: Partial<Record<BlessingTransliterationStyle, string>>;
};

const meinShaloshChabadSourceName = 'source image 1.png, page 96, "Blessing After Certain Foods"';

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

const meinShaloshSourceMetadataBlocks = [
  {
    "key": "source_notice",
    "kind": "note",
    "language": "ru",
    "titleRu": "Источник и статус",
    "bodyRu": "Источник сверки: изображение 1.png, стр. 96, Blessing After Certain Foods. Текст требует финальной сверки по сидуру/источнику перед публичным релизом.",
    "needsVerification": true,
    "renderVariant": "annotation",
    "triggerMode": "future_not_runtime",
  },
  {
    "key": "usage_note",
    "kind": "note",
    "language": "ru",
    "titleRu": "Когда читают Мейн Шалош",
    "annotationRu": "Из английского примечания на странице: это благословение читают после приготовленных или печёных продуктов из пяти видов злаков; после вина или виноградного сока; после винограда, инжира, граната, оливок или фиников. Если ели/пили сочетание этих категорий, варианты соединяют, добавляя буквы или слова в скобках.",
    "bodyRu": "five_grains: cooked_or_baked_foods_from_wheat_barley_rye_oats_spelt\nwine_or_grape_juice: wine_grape_juice\nseven_species_fruits: grapes_figs_pomegranates_olives_dates\ncombine_rule: add_letters_or_words_in_parentheses_when_combining_categories",
    "needsVerification": true,
    "renderVariant": "annotation",
    "triggerMode": "future_not_runtime",
  },
  {
    "key": "assembly_rules",
    "kind": "note",
    "language": "ru",
    "titleRu": "Правила сборки для приложения",
    "bodyRu": "direct_home_mein_shalosh: show_all_three_variants_with_labels\nitem_five_grains: use_variant_al_hamichya\nitem_wine_or_grape_juice: use_variant_al_hagefen\nitem_seven_species_fruit: use_variant_al_haetz\ncombination: combine_parenthesized_words_according_to_source\nruntime_hebcal: rosh_chodesh, chol_hamoed_pesach, chol_hamoed_sukkot\nfuture_not_runtime: shabbat, shavuot, shemini_atzeret, rosh_hashanah, yom_tov",
    "needsVerification": true,
    "renderVariant": "annotation",
    "triggerMode": "future_not_runtime",
  },
] as const satisfies readonly BlessingContentBlock[];

export const meinShaloshChabadHebrewBlocks = [
  {
    "key": "opening_he",
    "kind": "text",
    "language": "he",
    "titleRu": "Начало благословения",
    "bodyRu": "בָּרוּךְ אַתָּה יְיָ אֱלֹהֵינוּ מֶלֶךְ הָעוֹלָם,",
    "needsVerification": true,
    "translitRuByStyle": {
      "ashkenazi": "Борух Ато Адойной Элойhейну Мелех hоойлом,",
      "sephardi": "Барух Ата Адонай Элоhейну Мелех hаолам,",
    },
  },
  {
    "key": "variant_opening_al_haetz_he",
    "kind": "variant",
    "language": "he",
    "variantKey": "al_haetz",
    "variantLabelRu": "Аль hаэц — после винограда, инжира, граната, оливок или фиников",
    "titleRu": "Вариант начала: Аль hаэц",
    "annotationRu": "На странице: After grapes, figs, pomegranates, olives, or dates.",
    "bodyRu": "וְעַל הָעֵץ\nוְעַל פְּרִי הָעֵץ",
    "needsVerification": true,
    "translitRuByStyle": {
      "ashkenazi": "Ве-аль hоэйц\nВе-аль при hоэйц",
      "sephardi": "Ве-аль hаэц\nВе-аль пери hаэц",
    },
  },
  {
    "key": "variant_opening_al_hagefen_he",
    "kind": "variant",
    "language": "he",
    "variantKey": "al_hagefen",
    "variantLabelRu": "Аль hагефен — после вина или виноградного сока",
    "titleRu": "Вариант начала: Аль hагефен",
    "annotationRu": "На странице: After wine or grape juice.",
    "bodyRu": "וְעַל הַגֶּפֶן\nוְעַל פְּרִי הַגֶּפֶן",
    "needsVerification": true,
    "translitRuByStyle": {
      "ashkenazi": "Ве-аль hагефен\nВе-аль при hагефен",
      "sephardi": "Ве-аль hагефен\nВе-аль пери hагефен",
    },
  },
  {
    "key": "variant_opening_al_hamichya_he",
    "kind": "variant",
    "language": "he",
    "variantKey": "al_hamichya",
    "variantLabelRu": "Аль hамихья — после пищи из пяти видов злаков",
    "titleRu": "Вариант начала: Аль hамихья",
    "annotationRu": "На странице: After food prepared from the five grains.",
    "bodyRu": "עַל הַמִּחְיָה\nוְעַל הַכַּלְכָּלָה,",
    "needsVerification": true,
    "translitRuByStyle": {
      "ashkenazi": "Аль hамихьё\nВе-аль hакальколо,",
      "sephardi": "Аль hамихья\nВе-аль hакалькала,",
    },
  },
  {
    "key": "land_and_jerusalem_he",
    "kind": "text",
    "language": "he",
    "titleRu": "Основной текст — земля Израиля и Йерушалаим",
    "bodyRu": "וְעַל תְּנוּבַת הַשָּׂדֶה וְעַל אֶרֶץ חֶמְדָּה טוֹבָה וּרְחָבָה שֶׁרָצִיתָ וְהִנְחַלְתָּ לַאֲבוֹתֵינוּ לֶאֱכוֹל מִפִּרְיָהּ וְלִשְׂבֹּעַ מִטּוּבָהּ. רַחֵם נָא יְיָ אֱלֹהֵינוּ עַל יִשְׂרָאֵל עַמֶּךָ וְעַל יְרוּשָׁלַיִם עִירֶךָ וְעַל צִיּוֹן מִשְׁכַּן כְּבוֹדֶךָ וְעַל מִזְבְּחֶךָ וְעַל הֵיכָלֶךָ, וּבְנֵה יְרוּשָׁלַיִם עִיר הַקֹּדֶשׁ בִּמְהֵרָה בְיָמֵינוּ, וְהַעֲלֵנוּ לְתוֹכָהּ וְשַׂמְּחֵנוּ בָהּ וּנְבָרֶכְךָ בִּקְדֻשָּׁה וּבְטָהֳרָה.",
    "needsVerification": true,
    "translitRuByStyle": {
      "ashkenazi": "Ве-аль тнувáс hасодэ ве-аль эрец хемдо тойво урхово шероцисо ве-hинхальто лаавойсейну леэхойль мипирьё велисбойа митуво. Рахейм но Адойной Элойhейну аль Йисроэль амехо ве-аль Йерушолайим ирехо ве-аль Цийон мишкан квойдэхо ве-аль мизбехахо ве-аль hейхолехо, увней Йерушолайим ир hакойдеш бимhейро веёмейну, веhаалейну лесойхо весамхейну во унвореххо бикдушо увтоhоро.",
      "sephardi": "Ве-аль тенуват hасаде ве-аль эрец хемда това урхава шерацита веhинхальта лаавотейну леэхоль мипирья велисбоа митува. Рахем на Адонай Элоhейну аль Йисраэль амеха ве-аль Йерушалайим иреха ве-аль Цийон мишкан кеводеха ве-аль мизбехеха ве-аль hейхалеха, увне Йерушалайим ир hакодеш бимhера веямейну, веhаалейну летоха весамхейну ва уневарехеха бикдуша уветаhара.",
    },
  },
  {
    "key": "special_day_insert_shabbat_he",
    "kind": "insert",
    "language": "he",
    "titleRu": "Вставка на Шабат",
    "triggerMode": "future_not_runtime",
    "annotationRu": "На странице: On Shabbat. Не включать автоматически в MVP, потому что приложение не должно использоваться в Шабат. Блок сохранён как source-map для будущей поддержки.",
    "bodyRu": "וּרְצֵה וְהַחֲלִיצֵנוּ בְּיוֹם הַשַּׁבָּת הַזֶּה.",
    "needsVerification": true,
    "translitRuByStyle": {
      "ashkenazi": "Урцей веhахалицейну бёйм hаШабос hазэ.",
      "sephardi": "Урце веhахалицейну бейом hаШаббат hазе.",
    },
  },
  {
    "key": "special_day_insert_rosh_chodesh_he",
    "kind": "insert",
    "language": "he",
    "titleRu": "Вставка на Рош Ходеш",
    "triggerMode": "hebcal",
    "annotationRu": "На странице: On Rosh Chodesh. Можно показывать автоматически через Hebcal при флаге rosh_chodesh.",
    "bodyRu": "וְזָכְרֵנוּ לְטוֹבָה בְּיוֹם רֹאשׁ הַחֹדֶשׁ הַזֶּה:",
    "needsVerification": true,
    "calendarFlag": "rosh_chodesh",
    "translitRuByStyle": {
      "ashkenazi": "Везохрейну летойво бёйм Ройш hаХойдеш hазэ:",
      "sephardi": "Везохрену летова бейом Рош hаХодеш hазе:",
    },
  },
  {
    "key": "special_day_insert_pesach_he",
    "kind": "insert",
    "language": "he",
    "titleRu": "Вставка на Песах / Холь hа-Моэд Песах",
    "triggerMode": "hebcal",
    "annotationRu": "На странице: On Pesach. В MVP автоматически показывать только для Холь hа-Моэд Песах, не для Йом Това.",
    "bodyRu": "וְזָכְרֵנוּ לְטוֹבָה בְּיוֹם חַג הַמַּצּוֹת הַזֶּה:",
    "needsVerification": true,
    "calendarFlag": "chol_hamoed_pesach",
    "translitRuByStyle": {
      "ashkenazi": "Везохрейну летойво бёйм Хаг hаМацойс hазэ:",
      "sephardi": "Везохрену летова бейом Хаг hаМацот hазе:",
    },
  },
  {
    "key": "special_day_insert_shavuot_he",
    "kind": "insert",
    "language": "he",
    "titleRu": "Вставка на Шавуот",
    "triggerMode": "future_not_runtime",
    "annotationRu": "На странице: On Shavuot. Не включать автоматически в MVP, потому что это Йом Тов.",
    "bodyRu": "וְזָכְרֵנוּ לְטוֹבָה בְּיוֹם חַג הַשָּׁבוּעוֹת הַזֶּה:",
    "needsVerification": true,
    "translitRuByStyle": {
      "ashkenazi": "Везохрейну летойво бёйм Хаг hаШовуойс hазэ:",
      "sephardi": "Везохрену летова бейом Хаг hаШавуот hазе:",
    },
  },
  {
    "key": "special_day_insert_sukkot_he",
    "kind": "insert",
    "language": "he",
    "titleRu": "Вставка на Суккот / Холь hа-Моэд Суккот",
    "triggerMode": "hebcal",
    "annotationRu": "На странице: On Sukkot. В MVP автоматически показывать только для Холь hа-Моэд Суккот, не для Йом Това.",
    "bodyRu": "וְזָכְרֵנוּ לְטוֹבָה בְּיוֹם חַג הַסֻּכּוֹת הַזֶּה:",
    "needsVerification": true,
    "calendarFlag": "chol_hamoed_sukkot",
    "translitRuByStyle": {
      "ashkenazi": "Везохрейну летойво бёйм Хаг hаСуккойс hазэ:",
      "sephardi": "Везохрену летова бейом Хаг hаСуккот hазе:",
    },
  },
  {
    "key": "special_day_insert_shemini_atzeret_he",
    "kind": "insert",
    "language": "he",
    "titleRu": "Вставка на Шмини Ацерет",
    "triggerMode": "future_not_runtime",
    "annotationRu": "На странице: On Shemini Atzeret. Не включать автоматически в MVP, потому что это Йом Тов.",
    "bodyRu": "וְזָכְרֵנוּ לְטוֹבָה בְּיוֹם שְׁמִינִי עֲצֶרֶת הַחַג הַזֶּה:",
    "needsVerification": true,
    "translitRuByStyle": {
      "ashkenazi": "Везохрейну летойво бёйм Шмини Ацерес hаХаг hазэ:",
      "sephardi": "Везохрену летова бейом Шмини Ацерет hахаг hазе:",
    },
  },
  {
    "key": "special_day_insert_rosh_hashanah_he",
    "kind": "insert",
    "language": "he",
    "titleRu": "Вставка на Рош hа-Шана",
    "triggerMode": "future_not_runtime",
    "annotationRu": "На странице: On Rosh Hashanah. Не включать автоматически в MVP, потому что это Йом Тов.",
    "bodyRu": "וְזָכְרֵנוּ לְטוֹבָה בְּיוֹם הַזִּכָּרוֹן הַזֶּה:",
    "needsVerification": true,
    "translitRuByStyle": {
      "ashkenazi": "Везохрейну летойво бёйм hаЗикорон hазэ:",
      "sephardi": "Везохрену летова бейом hаЗикарон hазе:",
    },
  },
  {
    "key": "closing_before_final_variants_he",
    "kind": "text",
    "language": "he",
    "titleRu": "Перед завершающими вариантами",
    "bodyRu": "כִּי אַתָּה יְיָ טוֹב וּמֵטִיב לַכֹּל וְנוֹדֶה לְּךָ עַל הָאָרֶץ וְעַל",
    "needsVerification": true,
    "translitRuByStyle": {
      "ashkenazi": "Ки Ато Адойной тойв умейтив лакойль венойдэ лехо аль hоорец ве-аль",
      "sephardi": "Ки Ата Адонай тов уметив лаколь веноде леха аль hаарец ве-аль",
    },
  },
  {
    "key": "near_closing_variant_al_haetz_he",
    "kind": "variant",
    "language": "he",
    "variantKey": "al_haetz",
    "variantLabelRu": "Аль hаэц — перед заключительной формулой",
    "titleRu": "Вариант перед заключением: плоды",
    "bodyRu": "הַפֵּרוֹת.",
    "needsVerification": true,
    "translitRuByStyle": {
      "ashkenazi": "hапейройс.",
      "sephardi": "hаперот.",
    },
  },
  {
    "key": "near_closing_variant_al_hagefen_he",
    "kind": "variant",
    "language": "he",
    "variantKey": "al_hagefen",
    "variantLabelRu": "Аль hагефен — перед заключительной формулой",
    "titleRu": "Вариант перед заключением: вино",
    "bodyRu": "פְּרִי הַגֶּפֶן.",
    "needsVerification": true,
    "translitRuByStyle": {
      "ashkenazi": "при hагефен.",
      "sephardi": "пери hагефен.",
    },
  },
  {
    "key": "near_closing_variant_al_hamichya_he",
    "kind": "variant",
    "language": "he",
    "variantKey": "al_hamichya",
    "variantLabelRu": "Аль hамихья — перед заключительной формулой",
    "titleRu": "Вариант перед заключением: злаки",
    "bodyRu": "הַמִּחְיָה.",
    "needsVerification": true,
    "translitRuByStyle": {
      "ashkenazi": "hамихьё.",
      "sephardi": "hамихья.",
    },
  },
  {
    "key": "final_bracha_opening_he",
    "kind": "text",
    "language": "he",
    "titleRu": "Заключительная формула",
    "bodyRu": "בָּרוּךְ אַתָּה יְיָ עַל הָאָרֶץ וְעַל",
    "needsVerification": true,
    "translitRuByStyle": {
      "ashkenazi": "Борух Ато Адойной аль hоорец ве-аль",
      "sephardi": "Барух Ата Адонай аль hаарец ве-аль",
    },
  },
  {
    "key": "final_variant_al_haetz_he",
    "kind": "variant",
    "language": "he",
    "variantKey": "al_haetz",
    "variantLabelRu": "Заключение: Аль hаэц",
    "annotationRu": "В скобках на странице отмечена возможность добавления слова при соединении вариантов.",
    "bodyRu": "(וְעַל) הַפֵּרוֹת:",
    "needsVerification": true,
    "translitRuByStyle": {
      "ashkenazi": "(ве-аль) hапейройс:",
      "sephardi": "(ве-аль) hаперот:",
    },
  },
  {
    "key": "final_variant_al_hagefen_he",
    "kind": "variant",
    "language": "he",
    "variantKey": "al_hagefen",
    "variantLabelRu": "Заключение: Аль hагефен",
    "annotationRu": "В скобках на странице отмечена возможность добавления слова при соединении вариантов.",
    "bodyRu": "(וְעַל) פְּרִי הַגֶּפֶן:",
    "needsVerification": true,
    "translitRuByStyle": {
      "ashkenazi": "(ве-аль) при hагефен:",
      "sephardi": "(ве-аль) пери hагефен:",
    },
  },
  {
    "key": "final_variant_al_hamichya_he",
    "kind": "variant",
    "language": "he",
    "variantKey": "al_hamichya",
    "variantLabelRu": "Заключение: Аль hамихья",
    "bodyRu": "הַמִּחְיָה:",
    "needsVerification": true,
    "translitRuByStyle": {
      "ashkenazi": "hамихьё:",
      "sephardi": "hамихья:",
    },
  },
] as const satisfies readonly MeinShaloshSourceBlock[];

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

function filterVariantBlocks(
  blocks: readonly BlessingContentBlock[],
  variantKey?: MeinShaloshVariantKey,
): BlessingContentBlock[] {
  return blocks.filter((block) => !variantKey || !block.variantKey || block.variantKey === variantKey);
}

function createMeinShaloshTranslitBlocks({
  style,
  suffix,
  translitNusach,
}: {
  style: BlessingTransliterationStyle;
  suffix: 'translit_ashkenaz' | 'translit_sephard';
  translitNusach: BlessingTranslitNusach;
}): BlessingContentBlock[] {
  return meinShaloshChabadHebrewBlocks.map((block) => {
    const { translitRuByStyle, ...contentBlock } = block;
    const bodyRu = translitRuByStyle?.[style];

    if (!bodyRu) {
      throw new Error(`Missing Mein Shalosh ${style} transliteration for ${block.key}`);
    }

    return {
      ...contentBlock,
      key: contentBlock.key.replace(/_he$/, `_${suffix}`),
      language: 'translit',
      translitNusach,
      bodyRu,
    };
  });
}

const meinShaloshChabadContentBlocks = [
  ...meinShaloshSourceMetadataBlocks,
  ...meinShaloshChabadHebrewBlocks,
  ...createMeinShaloshTranslitBlocks({
    style: 'ashkenazi',
    suffix: 'translit_ashkenaz',
    translitNusach: 'ashkenaz',
  }),
  ...createMeinShaloshTranslitBlocks({
    style: 'sephardi',
    suffix: 'translit_sephard',
    translitNusach: 'sephard',
  }),
] satisfies readonly BlessingContentBlock[];

function createMeinShaloshChabadContentBlocks(
  variantKey?: MeinShaloshVariantKey,
): readonly BlessingContentBlock[] {
  return filterVariantBlocks(meinShaloshChabadContentBlocks, variantKey);
}

function createMeinShaloshNusachVariants(
  blessingTitleRu: string,
  variantKey: MeinShaloshVariantKey,
): readonly BlessingNusachVariant[] {
  return [
    {
      nusach: 'chabad',
      titleRu: 'Хабад',
      contentBlocks: createMeinShaloshChabadContentBlocks(variantKey),
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
    contentBlocks: createMeinShaloshChabadContentBlocks(),
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
    sourceName: meinShaloshChabadSourceName,
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
    sourceName: meinShaloshChabadSourceName,
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
    sourceName: meinShaloshChabadSourceName,
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
    sourceName: meinShaloshChabadSourceName,
    needsVerification: true,
  },
] as const satisfies readonly Blessing[];
