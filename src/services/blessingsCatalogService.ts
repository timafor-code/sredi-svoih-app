import { blessingsCatalog } from '@/data/blessings/catalog';
import type {
  Blessing,
  BlessingCondition,
  BlessingDispute,
  BlessingHomeGroup,
  BlessingItem,
  BlessingItemDetails,
  BlessingItemTuple,
  BlessingPattern,
  BlessingResolvedStep,
  BlessingSearchResult,
  BlessingTextOptions,
  BlessingTextResult,
} from '@/types/blessing';

type MatchField = {
  matchedOn: 'slug' | 'titleRu' | 'alias';
  value: string;
};

type MatchScore = Pick<BlessingSearchResult, 'matchedOn' | 'matchedText' | 'score'>;

const homeGroups: readonly BlessingHomeGroup[] = ['before_food', 'after_food', 'various'];

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

const disputesByKey = new Map<string, BlessingDispute>(
  blessingsCatalog.disputes.map((dispute) => [dispute.key, dispute]),
);

const expandedItems: readonly BlessingItem[] = blessingsCatalog.items.map(expandBlessingItemTuple);

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

function resolvePatternByKey(patternKey: string): BlessingPattern | null {
  return patternsByKey.get(patternKey) ?? null;
}

function getBestMatch(query: string, fields: readonly MatchField[]): MatchScore | null {
  let best: MatchScore | null = null;

  for (const field of fields) {
    const score = getFieldScore(query, field.value);

    if (score === null) {
      continue;
    }

    if (!best || score > best.score) {
      best = {
        matchedOn: field.matchedOn,
        matchedText: field.value,
        score,
      };
    }
  }

  return best;
}

function getFieldScore(query: string, value: string): number | null {
  const normalizedValue = normalizeBlessingQuery(value);

  if (!normalizedValue) {
    return null;
  }

  if (normalizedValue === query) {
    return 100;
  }

  if (normalizedValue.startsWith(query)) {
    return 80;
  }

  if (normalizedValue.includes(query)) {
    return 60;
  }

  if (query.includes(normalizedValue) && normalizedValue.length >= 3) {
    return 40;
  }

  return null;
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
  return query.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
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

  // TODO: Add optional fuzzy scoring when the UX needs typo tolerance.
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

  const conditionKeys = uniqueKeys(pattern.conditionKeys, item.conditionKeys);
  const disputeKeys = uniqueKeys(pattern.noteKeys, item.disputeKeys);

  return {
    item,
    pattern,
    steps: resolveItemSteps(item),
    conditions: conditionKeys.map((key) => conditionsByKey.get(key)).filter(isDefined),
    disputes: disputeKeys.map((key) => disputesByKey.get(key)).filter(isDefined),
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

  const contentBlocks = blessing.contentBlocks ?? [];

  return {
    blessing,
    calendarFlags: options.calendarFlags ?? [],
    language: options.language ?? 'ru',
    nusach: options.nusach ?? 'common',
    contentBlocks,
    needsVerification:
      blessing.needsVerification || contentBlocks.some((block) => block.needsVerification === true),
  };
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
  listBlessingsByCategory,
  listItemsByCategory,
  normalizeBlessingQuery,
  resolveBlessingBySlug,
  resolveItemBySlug,
  resolveItemSteps,
  expandBlessingPattern,
};
