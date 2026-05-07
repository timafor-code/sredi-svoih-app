import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BlessingConditionBadge } from '@/components/blessings/BlessingConditionBadge';
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

function isConditional(complexity: BlessingItemDetails['item']['complexity']) {
  return complexity === 'conditional' || complexity === 'complex';
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
  const { conditions, disputes, item, steps } = details;
  const categoryText = item.category ? getCategoryLabel(item.category) : null;
  const hasComplexityBadge = isConditional(item.complexity);
  const hasNotes = conditions.length > 0 || disputes.length > 0;

  return (
    <GlassCard contentStyle={styles.content} style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.eyebrow}>Продукт / ситуация</Text>
          <Text numberOfLines={2} style={styles.title}>
            {item.titleRu}
          </Text>
        </View>

        {hasComplexityBadge ? (
          <View style={styles.conditionPill}>
            <Ionicons name="alert-circle-outline" size={14} color={colors.goldAccent} />
            <Text numberOfLines={1} style={styles.conditionPillText}>
              Есть условия
            </Text>
          </View>
        ) : null}

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

      {hasNotes ? (
        <View style={styles.notes}>
          <Text style={styles.notesTitle}>Условия и спорные случаи</Text>
          {conditions.map((condition) => (
            <BlessingConditionBadge
              key={condition.key}
              condition={condition}
              kind="condition"
            />
          ))}
          {disputes.map((dispute) => (
            <BlessingConditionBadge
              key={dispute.key}
              dispute={dispute}
              kind="dispute"
            />
          ))}
        </View>
      ) : null}
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
  conditionPill: {
    maxWidth: 118,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(255,159,10,0.34)',
    backgroundColor: colors.accent.orangeBg,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  conditionPillText: {
    flexShrink: 1,
    color: colors.goldAccent,
    fontSize: 11,
    fontWeight: '900',
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
  notes: {
    gap: 10,
  },
  notesTitle: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '900',
    paddingHorizontal: 2,
  },
  pressed: {
    opacity: 0.78,
  },
});
