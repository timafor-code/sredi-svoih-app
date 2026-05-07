import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BlessingConditionBadge } from '@/components/blessings/BlessingConditionBadge';
import { BlessingItemNotesBlock } from '@/components/blessings/BlessingItemNotesBlock';
import { BlessingStepRow } from '@/components/blessings/BlessingStepRow';
import { GlassCard } from '@/components/glass/GlassCard';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import type { BlessingItemDetails, BlessingResolvedStep } from '@/types/blessing';

type BlessingItemSchemeCardProps = {
  details: BlessingItemDetails;
  onClose?: () => void;
  onStepPress: (step: BlessingResolvedStep) => void;
};

const categoryLabels: Record<string, string> = {
  baked_goods: 'Выпечка',
  drinks: 'Напитки',
  fruits: 'Фрукты',
  grains: 'Злаки',
  prepared_foods: 'Готовые блюда',
  seven_species: 'Семь видов',
  sweets: 'Сладости',
  vegetables: 'Овощи',
};

function getCategoryLabel(value: string): string {
  return categoryLabels[value] ?? value;
}

function formatStepCount(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return `${count} шаг`;
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} шага`;
  }

  return `${count} шагов`;
}

export function BlessingItemSchemeCard({
  details,
  onClose,
  onStepPress,
}: BlessingItemSchemeCardProps) {
  const { item, itemAnnotations, steps } = details;
  const { conditions, disputes, notes, sourceRefs } = itemAnnotations;
  const categoryText = item.category ? getCategoryLabel(item.category) : null;
  const hasComplexityBadge = item.complexity === 'complex';
  const hasConditionBadge =
    item.complexity === 'conditional' || (!hasComplexityBadge && conditions.length > 0);
  const hasDisputeBadge = disputes.length > 0;
  const hasHeaderBadges = hasComplexityBadge || hasConditionBadge || hasDisputeBadge;

  return (
    <GlassCard contentStyle={styles.content} style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.eyebrow}>Продукт / ситуация</Text>
          <Text numberOfLines={2} style={styles.title}>
            {item.titleRu}
          </Text>
          {hasHeaderBadges ? (
            <View style={styles.headerBadges}>
              {hasComplexityBadge ? (
                <BlessingConditionBadge label="Сложный случай" tone="complex" />
              ) : null}
              {hasConditionBadge ? (
                <BlessingConditionBadge label="Есть условия" tone="condition" />
              ) : null}
              {hasDisputeBadge ? (
                <BlessingConditionBadge label="Спорный случай" tone="dispute" />
              ) : null}
            </View>
          ) : null}
        </View>

        {onClose ? (
          <Pressable
            accessibilityLabel="Закрыть"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onClose}
            style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
          >
            <Ionicons name="close" size={20} color={colors.text} />
          </Pressable>
        ) : null}
      </View>

      {categoryText || item.subcategory ? (
        <View style={styles.metaRow}>
          {categoryText ? (
            <View style={styles.metaPill}>
              <Text numberOfLines={1} style={styles.metaText}>
                {categoryText}
              </Text>
            </View>
          ) : null}
          {item.subcategory ? (
            <View style={styles.metaPill}>
              <Text numberOfLines={1} style={styles.metaText}>
                {item.subcategory}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Схема</Text>
        {steps.length > 0 ? (
          <Text style={styles.sectionCount}>{formatStepCount(steps.length)}</Text>
        ) : null}
      </View>

      {steps.length > 0 ? (
        <View style={styles.stepsBox}>
          {steps.map((step, index) => (
            <BlessingStepRow
              key={`${step.patternKey}-${step.blessingSlug}`}
              isLast={index === steps.length - 1}
              onPress={onStepPress}
              step={step}
            />
          ))}
        </View>
      ) : (
        <View style={styles.emptySteps}>
          <Ionicons name="alert-circle-outline" size={18} color={colors.goldAccent} />
          <Text style={styles.emptyStepsText}>Схема зависит от условий этого случая.</Text>
        </View>
      )}

      <BlessingItemNotesBlock
        complexity={item.complexity}
        conditions={conditions}
        disputes={disputes}
        notes={notes}
        sourceRefs={sourceRefs}
      />
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: {
    borderColor: 'rgba(255,200,50,0.18)',
  },
  content: {
    gap: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0,
    marginBottom: 5,
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '900',
    lineHeight: 27,
  },
  headerBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 9,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.glass.w08,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metaPill: {
    maxWidth: '100%',
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.glass.w10,
    backgroundColor: colors.glass.w06,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  metaText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 2,
  },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '900',
  },
  sectionCount: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: '800',
  },
  stepsBox: {
    overflow: 'hidden',
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.glass.w04,
  },
  emptySteps: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: 'rgba(255,159,10,0.26)',
    backgroundColor: 'rgba(255,159,10,0.07)',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  emptyStepsText: {
    flex: 1,
    minWidth: 0,
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.78,
  },
});
