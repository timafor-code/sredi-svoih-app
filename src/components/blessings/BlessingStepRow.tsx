import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import type { BlessingResolvedStep } from '@/types/blessing';

type BlessingStepRowProps = {
  isLast?: boolean;
  onPress: (step: BlessingResolvedStep) => void;
  step: BlessingResolvedStep;
};

export function BlessingStepRow({ isLast = false, onPress, step }: BlessingStepRowProps) {
  return (
    <Pressable
      accessibilityLabel={step.blessing.titleRu}
      accessibilityRole="button"
      onPress={() => onPress(step)}
      style={({ pressed }) => [styles.row, !isLast && styles.rowDivider, pressed && styles.pressed]}
    >
      <View style={styles.orderBox}>
        <Text style={styles.order}>{step.order}</Text>
      </View>

      <View style={styles.textBlock}>
        <Text numberOfLines={1} style={styles.title}>
          {step.blessing.titleRu}
        </Text>
        {step.blessing.descriptionRu ? (
          <Text numberOfLines={2} style={styles.description}>
            {step.blessing.descriptionRu}
          </Text>
        ) : null}
      </View>

      <View style={styles.action}>
        <Text numberOfLines={1} style={styles.actionText}>
          Открыть
        </Text>
        <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.28)" />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  pressed: {
    opacity: 0.78,
    backgroundColor: colors.glass.w04,
  },
  orderBox: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,200,50,0.26)',
    backgroundColor: colors.accent.goldBg,
  },
  order: {
    color: colors.goldAccent,
    fontSize: 13,
    fontWeight: '900',
  },
  textBlock: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
    includeFontPadding: false,
  },
  description: {
    color: colors.textGhost,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
  },
  action: {
    maxWidth: 82,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 2,
  },
  actionText: {
    flexShrink: 1,
    color: colors.textDim,
    fontSize: 10,
    fontWeight: '800',
  },
});
