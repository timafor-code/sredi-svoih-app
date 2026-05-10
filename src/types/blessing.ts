export type BlessingLanguage = 'he' | 'translit' | 'ru';

export type BlessingTranslitNusach = 'sephard' | 'ashkenaz';

export type BlessingTextNusach = 'chabad' | 'beit_sefaradi';

export type Nusach = 'common' | 'chabad' | 'sephardi';

export type DefaultPsak = 'chabad_alter_rebbe' | 'common' | 'other';

export type BlessingSearchResultType = 'item' | 'blessing' | 'category';

export type BlessingComplexity = 'simple' | 'conditional' | 'complex';

export type DisputeSeverity = 'info' | 'ask_rav' | 'machloket';

export type BlessingHomeGroup = 'before_food' | 'after_food' | 'various';

export type BlessingDisplayMode = 'direct_text' | 'full_text' | 'placeholder' | 'variants';

export type BlessingContentBlockKind = 'placeholder' | 'variant' | 'note' | 'insert' | 'text';

export type BlessingInsertPlacement = 'before_block' | 'after_block' | 'replace_marker';

export type JewishCalendarFlag =
  | 'hanukkah'
  | 'purim'
  | 'rosh_chodesh'
  | 'chol_hamoed_pesach'
  | 'chol_hamoed_sukkot';

export interface BlessingContentSegment {
  annotationRu?: string;
  bodyRu: string;
}

export interface BlessingHomeConfig {
  enabled: boolean;
  group: BlessingHomeGroup;
  order: number;
}

export interface BlessingContentBlock {
  key: string;
  kind?: BlessingContentBlockKind;
  titleRu?: string;
  bodyRu?: string;
  annotationRu?: string;
  blessingSlug?: string;
  calendarFlag?: JewishCalendarFlag;
  calendarFlags?: readonly JewishCalendarFlag[];
  collapsibleGroupKey?: string;
  dayNameByFlag?: Partial<Record<JewishCalendarFlag, string>>;
  defaultCollapsed?: boolean;
  language?: BlessingLanguage;
  prefaceMode?: 'tachanun' | 'no_tachanun';
  renderVariant?: 'base' | 'insert' | 'annotation' | 'manual_collapsible';
  segments?: readonly BlessingContentSegment[];
  triggerMode?: 'always' | 'hebcal' | 'manual' | 'future_not_runtime';
  translitNusach?: BlessingTranslitNusach;
  needsVerification?: boolean;
}

export interface BlessingInsertOption {
  key: string;
  titleRu: string;
}

export interface BlessingInsert {
  key: string;
  titleRu: string;
  options?: readonly BlessingInsertOption[];
  needsVerification?: boolean;
}

export interface BlessingInsertRule {
  key: string;
  flag: JewishCalendarFlag;
  titleRu: string;
  placement: BlessingInsertPlacement;
  targetBlockKey?: string;
  marker?: string;
  contentBlocks: readonly BlessingContentBlock[];
  needsVerification: boolean;
}

export interface BlessingNusachVariant {
  nusach: BlessingTextNusach;
  titleRu: string;
  contentBlocks: readonly BlessingContentBlock[];
  dynamicInsertRules?: readonly BlessingInsertRule[];
  sourceName?: string;
  sourceUrl?: string;
  needsVerification: boolean;
}

export interface Blessing {
  slug: string;
  titleRu: string;
  titleHe?: string;
  titleTranslit?: string;
  descriptionRu?: string;
  category: string;
  displayMode: BlessingDisplayMode;
  aliases: readonly string[];
  home?: BlessingHomeConfig;
  contentBlocks?: readonly BlessingContentBlock[];
  inserts?: readonly BlessingInsert[];
  dynamicInsertRules?: readonly BlessingInsertRule[];
  nusachVariants?: readonly BlessingNusachVariant[];
  sourceName?: string;
  sourceUrl?: string;
  needsVerification: boolean;
}

export interface BlessingPattern {
  key: string;
  steps: readonly string[];
  conditionKeys?: readonly string[];
  noteKeys?: readonly string[];
  disputeKeys?: readonly string[];
  sourceRefs?: readonly string[];
}

export interface BlessingCondition {
  key: string;
  titleRu: string;
  descriptionRu?: string;
  sourceRefs?: readonly string[];
  needsVerification: boolean;
}

export interface BlessingNote {
  key: string;
  titleRu: string;
  descriptionRu?: string;
  sourceRefs?: readonly string[];
  needsVerification: boolean;
}

export interface BlessingDispute {
  key: string;
  titleRu: string;
  descriptionRu?: string;
  severity: DisputeSeverity;
  sourceName?: string;
  sourceUrl?: string;
  sourceRefs?: readonly string[];
  needsVerification: boolean;
}

export interface BlessingItem {
  slug: string;
  titleRu: string;
  patternKey: string;
  aliases: readonly string[];
  category?: string;
  subcategory?: string;
  tags?: readonly string[];
  complexity?: BlessingComplexity;
  conditionKeys?: readonly string[];
  noteKeys?: readonly string[];
  disputeKeys?: readonly string[];
  alternativeScenarioKeys?: readonly string[];
  sourceRefs?: readonly string[];
  needsVerification?: boolean;
}

export type BlessingItemTupleOptions = Omit<
  BlessingItem,
  'slug' | 'titleRu' | 'patternKey' | 'aliases'
>;

export type BlessingItemTuple = readonly [
  slug: string,
  titleRu: string,
  patternKey: string,
  aliases: readonly string[],
  options?: BlessingItemTupleOptions,
];

export interface BlessingCatalogMeta {
  defaultPsak: DefaultPsak;
}

export interface BlessingCatalog {
  meta: BlessingCatalogMeta;
  blessings: readonly Blessing[];
  patterns: readonly BlessingPattern[];
  conditions: readonly BlessingCondition[];
  notes: readonly BlessingNote[];
  disputes: readonly BlessingDispute[];
  items: readonly BlessingItemTuple[];
}

export interface BlessingResolvedStep {
  order: number;
  blessingSlug: string;
  blessing: Blessing;
  patternKey: string;
}

export interface BlessingItemResolvedAnnotations {
  conditions: readonly BlessingCondition[];
  notes: readonly BlessingNote[];
  disputes: readonly BlessingDispute[];
  sourceRefs: readonly string[];
}

export interface BlessingItemDetails {
  item: BlessingItem;
  pattern: BlessingPattern;
  steps: readonly BlessingResolvedStep[];
  conditions: readonly BlessingCondition[];
  notes: readonly BlessingNote[];
  disputes: readonly BlessingDispute[];
  sourceRefs: readonly string[];
  itemAnnotations: BlessingItemResolvedAnnotations;
  patternAnnotations: BlessingItemResolvedAnnotations;
}

export type BlessingSearchMatchKind =
  | 'exact'
  | 'starts_with'
  | 'includes'
  | 'reverse_contains'
  | 'fuzzy';

export interface BlessingSearchResult {
  resultType: BlessingSearchResultType;
  slug: string;
  titleRu: string;
  score: number;
  matchedOn: 'slug' | 'titleRu' | 'alias' | 'category';
  matchKind?: BlessingSearchMatchKind;
  matchedText?: string;
  category?: string;
  complexity?: BlessingComplexity;
  item?: BlessingItem;
  blessing?: Blessing;
}

export interface BlessingTextOptions {
  calendarFlags?: readonly JewishCalendarFlag[];
  language?: BlessingLanguage;
  nusach?: Nusach;
  selectedTextNusach?: BlessingTextNusach;
}

export interface BlessingTextResult {
  blessing: Blessing;
  calendarFlags: readonly JewishCalendarFlag[];
  language: BlessingLanguage;
  nusach: Nusach;
  selectedTextNusach?: BlessingTextNusach;
  contentBlocks: readonly BlessingContentBlock[];
  dynamicInsertRules?: readonly BlessingInsertRule[];
  needsVerification: boolean;
}
