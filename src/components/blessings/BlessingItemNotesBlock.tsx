import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { formatBlessingSourceRefs } from '@/lib/blessingSourceRefs';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import type {
  BlessingComplexity,
  BlessingCondition,
  BlessingDispute,
  BlessingNote,
} from '@/types/blessing';

type IoniconName = keyof typeof Ionicons.glyphMap;

type AnnotationKind = 'condition' | 'dispute' | 'note';

type BlessingInfoEntry = BlessingCondition | BlessingDispute | BlessingNote;

type BlessingItemNotesBlockProps = {
  complexity?: BlessingComplexity;
  conditions: readonly BlessingCondition[];
  disputes: readonly BlessingDispute[];
  notes: readonly BlessingNote[];
  sourceRefs?: readonly string[];
};

type AnnotationSectionProps = {
  emphasized?: boolean;
  items: readonly BlessingInfoEntry[];
  kind: AnnotationKind;
  showAskRav?: boolean;
  title: string;
};

const severityLabels: Record<BlessingDispute['severity'], string> = {
  ask_rav: 'Уточнить',
  info: 'Инфо',
  machloket: 'Махлокет',
};

function uniqueStrings(...groups: Array<readonly string[] | undefined>): string[] {
  return Array.from(new Set(groups.flatMap((group) => group ?? [])));
}

function getSectionIcon(kind: AnnotationKind): IoniconName {
  switch (kind) {
    case 'condition':
      return 'information-circle-outline';
    case 'dispute':
      return 'help-circle-outline';
    case 'note':
      return 'document-text-outline';
  }
}

function getSectionColor(kind: AnnotationKind): string {
  return kind === 'dispute' ? colors.orange : colors.goldAccent;
}

function collectSourceRefs(
  conditions: readonly BlessingCondition[],
  notes: readonly BlessingNote[],
  disputes: readonly BlessingDispute[],
  sourceRefs?: readonly string[],
): string[] {
  return uniqueStrings(
    sourceRefs,
    ...conditions.map((condition) => condition.sourceRefs),
    ...notes.map((note) => note.sourceRefs),
    ...disputes.map((dispute) => dispute.sourceRefs),
  );
}

function isDispute(kind: AnnotationKind, item: BlessingInfoEntry): item is BlessingDispute {
  return kind === 'dispute' && 'severity' in item;
}

function AnnotationSection({
  emphasized = false,
  items,
  kind,
  showAskRav = false,
  title,
}: AnnotationSectionProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <View
      style={[
        styles.section,
        kind === 'condition' && styles.conditionSection,
        kind === 'dispute' && styles.disputeSection,
        emphasized && styles.emphasizedSection,
      ]}
    >
      <View style={styles.sectionHeader}>
        <Ionicons name={getSectionIcon(kind)} size={15} color={getSectionColor(kind)} />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>

      <View style={styles.list}>
        {items.map((item) => (
          <View key={item.key} style={styles.row}>
            <View
              style={[
                styles.dot,
                kind === 'condition' && styles.conditionDot,
                kind === 'dispute' && styles.disputeDot,
              ]}
            />
            <View style={styles.rowText}>
              <View style={styles.itemTitleRow}>
                <Text style={styles.itemTitle}>{item.titleRu}</Text>
                {isDispute(kind, item) ? (
                  <View style={styles.severityPill}>
                    <Text numberOfLines={1} style={styles.severityText}>
                      {severityLabels[item.severity]}
                    </Text>
                  </View>
                ) : null}
              </View>
              {item.descriptionRu ? (
                <Text style={styles.itemDescription}>{item.descriptionRu}</Text>
              ) : null}
            </View>
          </View>
        ))}
      </View>

      {showAskRav ? (
        <View style={styles.askRavRow}>
          <Ionicons name="chatbubble-ellipses-outline" size={13} color={colors.goldAccent} />
          <Text style={styles.askRavText}>При сомнении уточните у раввина.</Text>
        </View>
      ) : null}
    </View>
  );
}

export function BlessingItemNotesBlock({
  complexity,
  conditions,
  disputes,
  notes,
  sourceRefs,
}: BlessingItemNotesBlockProps) {
  const hasContent = notes.length > 0 || conditions.length > 0 || disputes.length > 0;

  if (!hasContent) {
    return null;
  }

  const resolvedSourceRefs =
    sourceRefs && sourceRefs.length > 0
      ? uniqueStrings(sourceRefs)
      : collectSourceRefs(conditions, notes, disputes);
  const sourceText = formatBlessingSourceRefs(resolvedSourceRefs);
  const isComplex = complexity === 'complex';
  const hasAskRavDispute = disputes.some((dispute) => dispute.severity === 'ask_rav');

  return (
    <View style={[styles.container, isComplex && styles.complexContainer]}>
      <AnnotationSection items={notes} kind="note" title="Примечание" />
      <AnnotationSection
        emphasized={isComplex}
        items={conditions}
        kind="condition"
        title="Условия"
      />
      <AnnotationSection
        emphasized={isComplex}
        items={disputes}
        kind="dispute"
        showAskRav={hasAskRavDispute}
        title={hasAskRavDispute ? 'Требует уточнения' : 'Спорный случай'}
      />
      {sourceText ? <Text style={styles.sourceText}>{sourceText}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  complexContainer: {
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: 'rgba(255,200,50,0.20)',
    backgroundColor: 'rgba(255,200,50,0.045)',
    padding: 8,
  },
  section: {
    gap: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.glass.w04,
    paddingHorizontal: 11,
    paddingVertical: 10,
  },
  conditionSection: {
    borderColor: 'rgba(255,200,50,0.24)',
    backgroundColor: 'rgba(255,200,50,0.055)',
  },
  disputeSection: {
    borderColor: 'rgba(240,122,42,0.30)',
    backgroundColor: 'rgba(240,122,42,0.075)',
  },
  emphasizedSection: {
    borderColor: 'rgba(255,200,50,0.34)',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 16,
  },
  list: {
    gap: 7,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: radius.full,
    backgroundColor: colors.textDim,
    marginTop: 6,
  },
  conditionDot: {
    backgroundColor: colors.goldAccent,
  },
  disputeDot: {
    backgroundColor: colors.orange,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  itemTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  itemTitle: {
    flex: 1,
    minWidth: 0,
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 16,
  },
  itemDescription: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  severityPill: {
    maxWidth: 82,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(240,122,42,0.34)',
    backgroundColor: colors.accent.orangeBg,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  severityText: {
    color: colors.orange,
    fontSize: 9,
    fontWeight: '900',
    lineHeight: 12,
  },
  askRavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: colors.separator,
    paddingTop: 8,
  },
  askRavText: {
    flex: 1,
    minWidth: 0,
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 15,
  },
  sourceText: {
    color: colors.textGhost,
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 14,
    paddingHorizontal: 3,
  },
});
