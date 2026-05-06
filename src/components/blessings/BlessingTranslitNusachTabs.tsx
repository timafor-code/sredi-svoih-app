import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import type { BlessingTranslitNusach } from '@/types/blessing';

type BlessingTranslitNusachTabsProps = {
  onValueChange: (value: BlessingTranslitNusach) => void;
  value: BlessingTranslitNusach;
};

const nusachTabs: ReadonlyArray<{
  label: string;
  value: BlessingTranslitNusach;
}> = [
  { label: 'Сефард', value: 'sephard' },
  { label: 'Ашкеназ', value: 'ashkenaz' },
];

export function BlessingTranslitNusachTabs({
  onValueChange,
  value,
}: BlessingTranslitNusachTabsProps) {
  return (
    <View style={styles.segment}>
      {nusachTabs.map((tab) => {
        const isActive = value === tab.value;

        return (
          <Pressable
            accessibilityLabel={tab.label}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            key={tab.value}
            onPress={() => onValueChange(tab.value)}
            style={({ pressed }) => [
              styles.tab,
              isActive && styles.activeTab,
              pressed && styles.pressed,
            ]}
          >
            <Text numberOfLines={1} style={[styles.label, isActive && styles.activeLabel]}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  segment: {
    minHeight: 38,
    maxWidth: '100%',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: 4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.glass.w04,
    padding: 4,
  },
  tab: {
    minHeight: 30,
    minWidth: 78,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    paddingHorizontal: 10,
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
