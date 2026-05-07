import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import type { BlessingNusachVariant, BlessingTextNusach } from '@/types/blessing';

type BlessingTextNusachTabsProps = {
  onValueChange: (value: BlessingTextNusach) => void;
  value: BlessingTextNusach;
  variants: readonly BlessingNusachVariant[];
};

export function BlessingTextNusachTabs({
  onValueChange,
  value,
  variants,
}: BlessingTextNusachTabsProps) {
  return (
    <View style={styles.segment}>
      {variants.map((variant) => {
        const isActive = value === variant.nusach;

        return (
          <Pressable
            accessibilityLabel={`Нусах ${variant.titleRu}`}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            key={variant.nusach}
            onPress={() => onValueChange(variant.nusach)}
            style={({ pressed }) => [
              styles.tab,
              isActive && styles.activeTab,
              pressed && styles.pressed,
            ]}
          >
            <Text numberOfLines={1} style={[styles.label, isActive && styles.activeLabel]}>
              {variant.titleRu}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  segment: {
    minHeight: 42,
    flexDirection: 'row',
    gap: 4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.glass.w04,
    padding: 4,
  },
  tab: {
    minHeight: 32,
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    paddingHorizontal: 8,
  },
  activeTab: {
    borderWidth: 1,
    borderColor: 'rgba(255,200,50,0.30)',
    backgroundColor: colors.accent.goldBgStrong,
  },
  pressed: {
    opacity: 0.76,
  },
  label: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0,
  },
  activeLabel: {
    color: colors.goldAccent,
  },
});
