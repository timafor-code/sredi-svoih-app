import type {
  Blessing,
  BlessingContentBlock,
  BlessingInsertRule,
  BlessingTextResult,
  JewishCalendarFlag,
} from '@/types/blessing';

export type ApplyBlessingDynamicInsertsParams = {
  blessing: Blessing;
  calendarFlags: readonly JewishCalendarFlag[];
  contentBlocks: readonly BlessingContentBlock[];
  dynamicInsertRules?: readonly BlessingInsertRule[];
};

export function buildBlessingTextResult(textResult: BlessingTextResult): BlessingTextResult {
  const contentBlocks = applyBlessingDynamicInserts({
    blessing: textResult.blessing,
    calendarFlags: textResult.calendarFlags,
    contentBlocks: textResult.contentBlocks,
    dynamicInsertRules: textResult.dynamicInsertRules,
  });

  if (contentBlocks === textResult.contentBlocks) {
    return textResult;
  }

  return {
    ...textResult,
    contentBlocks,
    needsVerification:
      textResult.needsVerification ||
      contentBlocks.some((block) => block.needsVerification === true),
  };
}

export function applyBlessingDynamicInserts(
  params: ApplyBlessingDynamicInsertsParams,
): readonly BlessingContentBlock[] {
  const { blessing, calendarFlags, contentBlocks } = params;
  const rules = params.dynamicInsertRules ?? blessing.dynamicInsertRules ?? [];

  if (rules.length === 0 || calendarFlags.length === 0) {
    return contentBlocks;
  }

  const activeFlags = new Set(calendarFlags);

  return rules.reduce<readonly BlessingContentBlock[]>((blocks, rule) => {
    if (!activeFlags.has(rule.flag)) {
      return blocks;
    }

    return applyDynamicInsertRule(blocks, rule);
  }, contentBlocks);
}

function applyDynamicInsertRule(
  contentBlocks: readonly BlessingContentBlock[],
  rule: BlessingInsertRule,
): readonly BlessingContentBlock[] {
  switch (rule.placement) {
    case 'after_block':
      return insertAfterBlock(contentBlocks, rule);
    case 'before_block':
      return insertBeforeBlock(contentBlocks, rule);
    case 'replace_marker':
      return replaceMarker(contentBlocks, rule);
  }
}

function buildInsertBlocks(rule: BlessingInsertRule): BlessingContentBlock[] {
  return rule.contentBlocks.map((block) => ({
    ...block,
    key: `${rule.key}:${block.key}`,
    kind: 'insert',
    titleRu: rule.titleRu,
    needsVerification: true,
  }));
}

function insertAfterBlock(
  contentBlocks: readonly BlessingContentBlock[],
  rule: BlessingInsertRule,
): readonly BlessingContentBlock[] {
  const insertBlocks = buildInsertBlocks(rule);
  const targetIndex = findBlockIndex(contentBlocks, rule.targetBlockKey);

  if (targetIndex === -1) {
    return [...contentBlocks, ...insertBlocks];
  }

  const insertIndex = findAfterInsertIndex(contentBlocks, targetIndex);
  return [
    ...contentBlocks.slice(0, insertIndex + 1),
    ...insertBlocks,
    ...contentBlocks.slice(insertIndex + 1),
  ];
}

function insertBeforeBlock(
  contentBlocks: readonly BlessingContentBlock[],
  rule: BlessingInsertRule,
): readonly BlessingContentBlock[] {
  const insertBlocks = buildInsertBlocks(rule);
  const targetIndex = findBlockIndex(contentBlocks, rule.targetBlockKey);

  if (targetIndex === -1) {
    const insertIndex = findLeadingInsertIndex(contentBlocks);
    return [
      ...contentBlocks.slice(0, insertIndex),
      ...insertBlocks,
      ...contentBlocks.slice(insertIndex),
    ];
  }

  return [
    ...contentBlocks.slice(0, targetIndex),
    ...insertBlocks,
    ...contentBlocks.slice(targetIndex),
  ];
}

function replaceMarker(
  contentBlocks: readonly BlessingContentBlock[],
  rule: BlessingInsertRule,
): readonly BlessingContentBlock[] {
  if (!rule.marker) {
    return [...contentBlocks, ...buildInsertBlocks(rule)];
  }

  const marker = rule.marker;
  const markerIndex = contentBlocks.findIndex((block) => block.bodyRu?.includes(marker));

  if (markerIndex === -1) {
    return [...contentBlocks, ...buildInsertBlocks(rule)];
  }

  const replacementBody = buildInsertBlocks(rule)
    .map((block) => block.bodyRu?.trim())
    .filter((body): body is string => Boolean(body))
    .join('\n\n');
  const targetBlock = contentBlocks[markerIndex];

  return [
    ...contentBlocks.slice(0, markerIndex),
    {
      ...targetBlock,
      bodyRu: targetBlock.bodyRu?.replace(marker, replacementBody),
      needsVerification: targetBlock.needsVerification || rule.needsVerification,
    },
    ...contentBlocks.slice(markerIndex + 1),
  ];
}

function findBlockIndex(
  contentBlocks: readonly BlessingContentBlock[],
  targetBlockKey: string | undefined,
): number {
  if (!targetBlockKey) {
    return -1;
  }

  return contentBlocks.findIndex((block) => block.key === targetBlockKey);
}

function findAfterInsertIndex(
  contentBlocks: readonly BlessingContentBlock[],
  targetIndex: number,
): number {
  let insertIndex = targetIndex;

  while (contentBlocks[insertIndex + 1]?.kind === 'insert') {
    insertIndex += 1;
  }

  return insertIndex;
}

function findLeadingInsertIndex(contentBlocks: readonly BlessingContentBlock[]): number {
  let insertIndex = 0;

  while (contentBlocks[insertIndex]?.kind === 'insert') {
    insertIndex += 1;
  }

  return insertIndex;
}
