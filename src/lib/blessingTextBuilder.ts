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
  const contentBlocksWithDynamicInserts = applyBlessingDynamicInserts({
    blessing: textResult.blessing,
    calendarFlags: textResult.calendarFlags,
    contentBlocks: textResult.contentBlocks,
    dynamicInsertRules: textResult.dynamicInsertRules,
  });
  const contentBlocks = resolveRuntimeContentBlocks(
    contentBlocksWithDynamicInserts,
    textResult.calendarFlags,
  );

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

function resolveRuntimeContentBlocks(
  contentBlocks: readonly BlessingContentBlock[],
  calendarFlags: readonly JewishCalendarFlag[],
): readonly BlessingContentBlock[] {
  const activeFlags = new Set(calendarFlags);
  let didChange = false;
  const resolvedBlocks: BlessingContentBlock[] = [];

  for (const block of contentBlocks) {
    if (!shouldShowRuntimeBlock(block, activeFlags)) {
      didChange = true;
      continue;
    }

    const resolvedBlock = resolveRuntimeBlockBody(block, calendarFlags, activeFlags);

    if (!resolvedBlock.bodyRu?.trim()) {
      didChange = true;
      continue;
    }

    if (resolvedBlock !== block) {
      didChange = true;
    }

    resolvedBlocks.push(resolvedBlock);
  }

  return didChange ? resolvedBlocks : contentBlocks;
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

function shouldShowRuntimeBlock(
  block: BlessingContentBlock,
  activeFlags: ReadonlySet<JewishCalendarFlag>,
): boolean {
  switch (block.triggerMode) {
    case 'future_not_runtime':
      return false;
    case 'hebcal':
      return getBlockCalendarFlags(block).some((flag) => activeFlags.has(flag));
    case 'manual':
    case 'always':
    case undefined:
      return true;
  }
}

function resolveRuntimeBlockBody(
  block: BlessingContentBlock,
  calendarFlags: readonly JewishCalendarFlag[],
  activeFlags: ReadonlySet<JewishCalendarFlag>,
): BlessingContentBlock {
  const selectedDayName = getSelectedDayName(block, calendarFlags);
  const selectedVariantKey = getSelectedBodyVariantKey(block, calendarFlags, activeFlags);
  const variantBody = selectedVariantKey ? selectLabeledBodyVariant(block.bodyRu, selectedVariantKey) : null;
  let bodyRu = variantBody ?? block.bodyRu;

  if (bodyRu && selectedDayName) {
    bodyRu = bodyRu.replace(/\{\{yaaleVeyavoDayName\}\}/g, selectedDayName);
  }

  return bodyRu === block.bodyRu ? block : { ...block, bodyRu };
}

function getBlockCalendarFlags(block: BlessingContentBlock): readonly JewishCalendarFlag[] {
  if (block.calendarFlags && block.calendarFlags.length > 0) {
    return block.calendarFlags;
  }

  return block.calendarFlag ? [block.calendarFlag] : [];
}

function getSelectedDayName(
  block: BlessingContentBlock,
  calendarFlags: readonly JewishCalendarFlag[],
): string | null {
  if (!block.dayNameByFlag) {
    return null;
  }

  for (const flag of calendarFlags) {
    const dayName = block.dayNameByFlag[flag];

    if (dayName) {
      return dayName;
    }
  }

  return null;
}

function getSelectedBodyVariantKey(
  block: BlessingContentBlock,
  calendarFlags: readonly JewishCalendarFlag[],
  activeFlags: ReadonlySet<JewishCalendarFlag>,
): string | null {
  if (block.key === 'migdol_magdal_he') {
    return hasMigdolCalendarFlag(activeFlags) ? 'rosh_chodesh_or_chol_hamoed' : 'weekday';
  }

  if (!hasLabeledBodyVariants(block.bodyRu)) {
    return null;
  }

  for (const flag of calendarFlags) {
    if (getBlockCalendarFlags(block).includes(flag)) {
      return flag;
    }
  }

  return null;
}

function hasMigdolCalendarFlag(activeFlags: ReadonlySet<JewishCalendarFlag>): boolean {
  return (
    activeFlags.has('rosh_chodesh') ||
    activeFlags.has('chol_hamoed_pesach') ||
    activeFlags.has('chol_hamoed_sukkot')
  );
}

function hasLabeledBodyVariants(bodyRu: string | undefined): boolean {
  if (!bodyRu) {
    return false;
  }

  const lines = bodyRu.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((line) => /^[a-z_]+:\s+/.test(line));
}

function selectLabeledBodyVariant(bodyRu: string | undefined, variantKey: string): string | null {
  if (!bodyRu) {
    return null;
  }

  const prefix = `${variantKey}:`;
  const line = bodyRu
    .split('\n')
    .map((value) => value.trim())
    .find((value) => value.startsWith(prefix));

  return line ? line.slice(prefix.length).trim() : null;
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
