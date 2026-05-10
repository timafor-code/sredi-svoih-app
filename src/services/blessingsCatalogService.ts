import { blessingsCatalog } from '@/data/blessings/catalog';
import { buildBlessingTextResult } from '@/lib/blessingTextBuilder';
import type {
  Blessing,
  BlessingCondition,
  BlessingDispute,
  BlessingHomeGroup,
  BlessingItem,
  BlessingItemDetails,
  BlessingItemResolvedAnnotations,
  BlessingItemTuple,
  BlessingNote,
  BlessingNusachVariant,
  BlessingPattern,
  BlessingResolvedStep,
  BlessingSearchResult,
  BlessingTransliterationStyle,
  BlessingTranslitNusach,
  BlessingTextOptions,
  BlessingTextResult,
  BlessingTextNusach,
} from '@/types/blessing';

type MatchField = {
  matchedOn: 'slug' | 'titleRu' | 'alias';
  value: string;
};

type MatchScore = {
  matchedOn: BlessingSearchResult['matchedOn'];
  matchedText: string;
  matchKind: NonNullable<BlessingSearchResult['matchKind']>;
  score: number;
};

type FieldMatch = Pick<MatchScore, 'matchKind' | 'score'>;

type ResolvedBlessingTextSource = {
  contentBlocks: BlessingTextResult['contentBlocks'];
  dynamicInsertRules: BlessingTextResult['dynamicInsertRules'];
  needsVerification: boolean;
  selectedTextNusach?: BlessingTextNusach;
};

const homeGroups: readonly BlessingHomeGroup[] = ['before_food', 'after_food', 'various'];
const MIN_FUZZY_LENGTH = 4;
const FUZZY_SCORE_BASE = 50;
const defaultChabadTransliterationStyle: BlessingTransliterationStyle = 'ashkenazi';

const catalogBlessings: readonly Blessing[] = blessingsCatalog.blessings;

const blessingsBySlug = new Map<string, Blessing>(
  catalogBlessings.map((blessing) => [blessing.slug, blessing]),
);

const patternsByKey = new Map<string, BlessingPattern>(
  blessingsCatalog.patterns.map((pattern) => [pattern.key, pattern]),
);

const conditionsByKey = new Map<string, BlessingCondition>(
  blessingsCatalog.conditions.map((condition) => [condition.key, condition]),
);

const notesByKey = new Map<string, BlessingNote>(
  blessingsCatalog.notes.map((note) => [note.key, note]),
);

const disputesByKey = new Map<string, BlessingDispute>(
  blessingsCatalog.disputes.map((dispute) => [dispute.key, dispute]),
);

const expandedItems: readonly BlessingItem[] = blessingsCatalog.items.map(expandBlessingItemTuple);

export function getBlessingTransliterationStyle(
  translitNusach: BlessingTranslitNusach,
): BlessingTransliterationStyle {
  return translitNusach === 'ashkenaz' ? 'ashkenazi' : 'sephardi';
}

function expandBlessingItemTuple(tuple: BlessingItemTuple): BlessingItem {
  const [slug, titleRu, patternKey, aliases, options] = tuple;

  return {
    ...options,
    slug,
    titleRu,
    patternKey,
    aliases,
  };
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function uniqueKeys(...groups: Array<readonly string[] | undefined>): string[] {
  return Array.from(new Set(groups.flatMap((group) => group ?? [])));
}

function collectAnnotationSourceRefs(
  conditions: readonly BlessingCondition[],
  notes: readonly BlessingNote[],
  disputes: readonly BlessingDispute[],
  sourceRefs?: readonly string[],
): string[] {
  return uniqueKeys(
    sourceRefs,
    ...conditions.map((condition) => condition.sourceRefs),
    ...notes.map((note) => note.sourceRefs),
    ...disputes.map((dispute) => dispute.sourceRefs),
  );
}

function resolveBlessingItemAnnotations({
  conditionKeys,
  disputeKeys,
  noteKeys,
  sourceRefs,
}: {
  conditionKeys?: readonly string[];
  disputeKeys?: readonly string[];
  noteKeys?: readonly string[];
  sourceRefs?: readonly string[];
}): BlessingItemResolvedAnnotations {
  const conditions = uniqueKeys(conditionKeys)
    .map((key) => conditionsByKey.get(key))
    .filter(isDefined);
  const notes = uniqueKeys(noteKeys)
    .map((key) => notesByKey.get(key))
    .filter(isDefined);
  const disputes = uniqueKeys(disputeKeys)
    .map((key) => disputesByKey.get(key))
    .filter(isDefined);

  return {
    conditions,
    notes,
    disputes,
    sourceRefs:
      sourceRefs && sourceRefs.length > 0
        ? uniqueKeys(sourceRefs)
        : collectAnnotationSourceRefs(conditions, notes, disputes),
  };
}

function resolvePatternByKey(patternKey: string): BlessingPattern | null {
  return patternsByKey.get(patternKey) ?? null;
}

function getBestMatch(query: string, fields: readonly MatchField[]): MatchScore | null {
  let best: MatchScore | null = null;

  for (const field of fields) {
    const match = getFieldMatch(query, field.value);

    if (!match) {
      continue;
    }

    if (!best || match.score > best.score) {
      best = {
        matchedOn: field.matchedOn,
        matchedText: field.value,
        matchKind: match.matchKind,
        score: match.score,
      };
    }
  }

  return best;
}

function getFieldMatch(query: string, value: string): FieldMatch | null {
  const normalizedValue = normalizeBlessingQuery(value);

  if (!normalizedValue) {
    return null;
  }

  if (normalizedValue === query) {
    return { matchKind: 'exact', score: 100 };
  }

  if (normalizedValue.startsWith(query)) {
    return { matchKind: 'starts_with', score: 80 };
  }

  if (normalizedValue.includes(query)) {
    return { matchKind: 'includes', score: 60 };
  }

  const fuzzyScore = getFuzzyScore(query, normalizedValue);

  if (fuzzyScore !== null) {
    return { matchKind: 'fuzzy', score: fuzzyScore };
  }

  if (query.includes(normalizedValue) && normalizedValue.length >= 3) {
    return { matchKind: 'reverse_contains', score: 40 };
  }

  return null;
}

function getFuzzyScore(query: string, normalizedValue: string): number | null {
  if (query.length < MIN_FUZZY_LENGTH || normalizedValue.length < MIN_FUZZY_LENGTH) {
    return null;
  }

  const maxDistance = getMaxFuzzyDistance(query, normalizedValue);

  if (Math.abs(query.length - normalizedValue.length) > maxDistance) {
    return null;
  }

  const distance = getBoundedLevenshteinDistance(query, normalizedValue, maxDistance);

  return distance === null ? null : FUZZY_SCORE_BASE - distance;
}

function getMaxFuzzyDistance(left: string, right: string): number {
  return Math.max(left.length, right.length) <= 5 ? 1 : 2;
}

function getBoundedLevenshteinDistance(
  left: string,
  right: string,
  maxDistance: number,
): number | null {
  let previousRow = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const currentRow = [leftIndex];
    let rowMinimum = currentRow[0];

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      const distance = Math.min(
        previousRow[rightIndex] + 1,
        currentRow[rightIndex - 1] + 1,
        previousRow[rightIndex - 1] + substitutionCost,
      );

      currentRow[rightIndex] = distance;
      rowMinimum = Math.min(rowMinimum, distance);
    }

    if (rowMinimum > maxDistance) {
      return null;
    }

    previousRow = currentRow;
  }

  const distance = previousRow[right.length];

  return distance <= maxDistance ? distance : null;
}

function buildItemSearchResult(item: BlessingItem, query: string): BlessingSearchResult | null {
  const match = getBestMatch(query, [
    { matchedOn: 'slug', value: item.slug },
    { matchedOn: 'titleRu', value: item.titleRu },
    ...item.aliases.map((alias) => ({ matchedOn: 'alias' as const, value: alias })),
  ]);

  if (!match) {
    return null;
  }

  return {
    resultType: 'item',
    slug: item.slug,
    titleRu: item.titleRu,
    category: item.category,
    complexity: item.complexity,
    item,
    ...match,
  };
}

function buildBlessingSearchResult(blessing: Blessing, query: string): BlessingSearchResult | null {
  const match = getBestMatch(query, [
    { matchedOn: 'slug', value: blessing.slug },
    { matchedOn: 'titleRu', value: blessing.titleRu },
    ...blessing.aliases.map((alias) => ({ matchedOn: 'alias' as const, value: alias })),
  ]);

  if (!match) {
    return null;
  }

  return {
    resultType: 'blessing',
    slug: blessing.slug,
    titleRu: blessing.titleRu,
    category: blessing.category,
    blessing,
    ...match,
  };
}

export function getResultTypePriority(result: BlessingSearchResult): number {
  switch (result.resultType) {
    case 'item':
      return 0;
    case 'blessing':
      return 1;
    case 'category':
      return 2;
  }
}

export function normalizeBlessingQuery(query: string): string {
  return query
    .trim()
    .toLowerCase()
    .replace(/\u0451/g, '\u0435')
    .replace(/[-_\u2010-\u2015]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function listHomeBlessings(): Record<BlessingHomeGroup, Blessing[]> {
  const groups: Record<BlessingHomeGroup, Blessing[]> = {
    before_food: [],
    after_food: [],
    various: [],
  };

  for (const blessing of catalogBlessings) {
    const home = blessing.home;

    if (!home?.enabled) {
      continue;
    }

    groups[home.group].push(blessing);
  }

  for (const group of homeGroups) {
    groups[group].sort((left, right) => {
      const leftOrder = left.home?.order ?? 0;
      const rightOrder = right.home?.order ?? 0;
      return leftOrder - rightOrder;
    });
  }

  return groups;
}

export function searchBlessings(query: string): BlessingSearchResult[] {
  const normalizedQuery = normalizeBlessingQuery(query);

  if (!normalizedQuery) {
    return [];
  }

  return [
    ...expandedItems.map((item) => buildItemSearchResult(item, normalizedQuery)),
    ...catalogBlessings.map((blessing) => buildBlessingSearchResult(blessing, normalizedQuery)),
  ]
    .filter(isDefined)
    .sort(
      (left, right) =>
        right.score - left.score ||
        getResultTypePriority(left) - getResultTypePriority(right) ||
        left.titleRu.localeCompare(right.titleRu, 'ru'),
    );
}

export function getBlessingItemDetails(itemSlug: string): BlessingItemDetails | null {
  const item = resolveItemBySlug(itemSlug);

  if (!item) {
    return null;
  }

  const pattern = resolvePatternByKey(item.patternKey);

  if (!pattern) {
    return null;
  }

  const patternAnnotations = resolveBlessingItemAnnotations({
    conditionKeys: pattern.conditionKeys,
    noteKeys: pattern.noteKeys,
    disputeKeys: pattern.disputeKeys,
    sourceRefs: pattern.sourceRefs,
  });
  const itemAnnotations = resolveBlessingItemAnnotations({
    conditionKeys: item.conditionKeys,
    noteKeys: item.noteKeys,
    disputeKeys: item.disputeKeys,
    sourceRefs: item.sourceRefs,
  });
  const conditionKeys = uniqueKeys(pattern.conditionKeys, item.conditionKeys);
  const noteKeys = uniqueKeys(pattern.noteKeys, item.noteKeys);
  const disputeKeys = uniqueKeys(pattern.disputeKeys, item.disputeKeys);
  const conditions = conditionKeys.map((key) => conditionsByKey.get(key)).filter(isDefined);
  const notes = noteKeys.map((key) => notesByKey.get(key)).filter(isDefined);
  const disputes = disputeKeys.map((key) => disputesByKey.get(key)).filter(isDefined);

  return {
    item,
    pattern,
    steps: resolveItemSteps(item),
    conditions,
    notes,
    disputes,
    sourceRefs: collectAnnotationSourceRefs(
      conditions,
      notes,
      disputes,
      uniqueKeys(pattern.sourceRefs, item.sourceRefs),
    ),
    itemAnnotations,
    patternAnnotations,
  };
}

export function getBlessingText(
  blessingSlug: string,
  options: BlessingTextOptions = {},
): BlessingTextResult | null {
  const blessing = resolveBlessingBySlug(blessingSlug);

  if (!blessing) {
    return null;
  }

  const textSource = resolveBlessingTextSource(blessing, options.selectedTextNusach);
  const transliterationStyle = resolveTransliterationStyle(options, textSource.selectedTextNusach);
  const contentBlocks = applyTransliterationStyle(
    textSource.contentBlocks,
    transliterationStyle,
  );

  return buildBlessingTextResult({
    blessing,
    calendarFlags: options.calendarFlags ?? [],
    language: options.language ?? 'ru',
    nusach: options.nusach ?? 'common',
    selectedTextNusach: textSource.selectedTextNusach,
    transliterationStyle,
    contentBlocks,
    dynamicInsertRules: textSource.dynamicInsertRules,
    needsVerification:
      blessing.needsVerification ||
      textSource.needsVerification ||
      contentBlocks.some((block) => block.needsVerification === true),
  });
}

function resolveTransliterationStyle(
  options: BlessingTextOptions,
  selectedTextNusach?: BlessingTextNusach,
): BlessingTransliterationStyle | undefined {
  if (options.language !== 'translit') {
    return options.transliterationStyle;
  }

  if (options.transliterationStyle) {
    return options.transliterationStyle;
  }

  return selectedTextNusach === 'beit_sefaradi' ? 'sephardi' : defaultChabadTransliterationStyle;
}

function applyTransliterationStyle(
  contentBlocks: BlessingTextResult['contentBlocks'],
  transliterationStyle?: BlessingTransliterationStyle,
): BlessingTextResult['contentBlocks'] {
  if (!transliterationStyle) {
    return contentBlocks;
  }

  const translitBlocks = contentBlocks.filter((block) => block.language === 'translit');

  if (translitBlocks.length === 0) {
    return contentBlocks;
  }

  const preferredBlocks = translitBlocks.filter(
    (block) => getBlockTransliterationStyle(block.translitNusach) === transliterationStyle,
  );
  const fallbackBlocks = translitBlocks.filter((block) => !block.translitNusach);
  const allowedTranslitBlocks =
    preferredBlocks.length > 0 ? new Set(preferredBlocks) : new Set(fallbackBlocks);

  return contentBlocks.filter(
    (block) => block.language !== 'translit' || allowedTranslitBlocks.has(block),
  );
}

function getBlockTransliterationStyle(
  translitNusach: BlessingTranslitNusach | undefined,
): BlessingTransliterationStyle | null {
  switch (translitNusach) {
    case 'ashkenaz':
      return 'ashkenazi';
    case 'sephard':
      return 'sephardi';
    case undefined:
      return null;
  }
}

function resolveBlessingTextSource(
  blessing: Blessing,
  selectedTextNusach?: BlessingTextNusach,
): ResolvedBlessingTextSource {
  const variant = resolveBlessingNusachVariant(blessing.nusachVariants, selectedTextNusach);

  if (variant) {
    return {
      contentBlocks: variant.contentBlocks,
      dynamicInsertRules: variant.dynamicInsertRules,
      needsVerification: variant.needsVerification,
      selectedTextNusach: variant.nusach,
    };
  }

  return {
    contentBlocks: blessing.contentBlocks ?? [],
    dynamicInsertRules: blessing.dynamicInsertRules,
    needsVerification: false,
  };
}

function resolveBlessingNusachVariant(
  variants: readonly BlessingNusachVariant[] | undefined,
  selectedTextNusach?: BlessingTextNusach,
): BlessingNusachVariant | null {
  if (!variants || variants.length === 0) {
    return null;
  }

  return (
    variants.find((variant) => variant.nusach === selectedTextNusach) ??
    variants.find((variant) => variant.nusach === 'chabad') ??
    variants[0]
  );
}

export function listBlessingsByCategory(category: string): Blessing[] {
  return catalogBlessings.filter((blessing) => blessing.category === category);
}

export function listItemsByCategory(category: string): BlessingItem[] {
  return expandedItems.filter((item) => item.category === category);
}

export function resolveBlessingBySlug(slug: string): Blessing | null {
  const normalizedSlug = normalizeBlessingQuery(slug);
  return blessingsBySlug.get(slug) ?? blessingsBySlug.get(normalizedSlug) ?? null;
}

export function resolveItemBySlug(slug: string): BlessingItem | null {
  const normalizedSlug = normalizeBlessingQuery(slug);
  return expandedItems.find((item) => normalizeBlessingQuery(item.slug) === normalizedSlug) ?? null;
}

export function resolveItemSteps(item: BlessingItem): BlessingResolvedStep[] {
  return expandBlessingPattern(item.patternKey);
}

export function expandBlessingPattern(patternKey: string): BlessingResolvedStep[] {
  const pattern = resolvePatternByKey(patternKey);

  if (!pattern) {
    return [];
  }

  return pattern.steps
    .map((blessingSlug, index) => {
      const blessing = resolveBlessingBySlug(blessingSlug);

      if (!blessing) {
        return null;
      }

      return {
        order: index + 1,
        blessingSlug,
        blessing,
        patternKey: pattern.key,
      };
    })
    .filter(isDefined);
}

export const blessingsCatalogService = {
  listHomeBlessings,
  searchBlessings,
  getBlessingItemDetails,
  getBlessingText,
  getBlessingTransliterationStyle,
  listBlessingsByCategory,
  listItemsByCategory,
  normalizeBlessingQuery,
  resolveBlessingBySlug,
  resolveItemBySlug,
  resolveItemSteps,
  expandBlessingPattern,
};
