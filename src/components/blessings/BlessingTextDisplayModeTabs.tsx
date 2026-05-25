import { Pressable, StyleSheet, Text, View } from 'react-native';

import { getAvailableBlessingTextDisplayModes } from '@/lib/blessingTextDisplayMode';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import type { BlessingTextDisplayMode, BlessingTextNusach } from '@/types/blessing';

type BlessingTextDisplayModeTabsProps = {
  onValueChange: (value: BlessingTextDisplayMode) => void;
  selectedTextNusach: BlessingTextNusach;
  value: BlessingTextDisplayMode;
};

const displayModeLabels: Record<BlessingTextDisplayMode, string> = {
  he: 'Иврит',
  translit_ashkenaz: 'Транслит Ашк.',
  translit_sephard: 'Транслит Сеф.',
  ru: 'Русский',
};

export function BlessingTextDisplayModeTabs({
  onValueChange,
  selectedTextNusach,
  value,
}: BlessingTextDisplayModeTabsProps) {
  const tabs = getAvailableBlessingTextDisplayModes(selectedTextNusach);

  return (
    <View style={styles.segment}>
      {tabs.map((tab) => {
        const isActive = value === tab;
        const label = displayModeLabels[tab];

        return (
          <Pressable
            accessibilityLabel={label}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            key={tab}
            onPress={() => onValueChange(tab)}
            style={({ pressed }) => [
              styles.tab,
              isActive && styles.activeTab,
              pressed && styles.pressed,
            ]}
          >
            <Text
              adjustsFontSizeToFit
              minimumFontScale={0.86}
              numberOfLines={2}
              style={[styles.label, isActive && styles.activeLabel]}
            >
              {label}
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
    paddingHorizontal: 4,
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
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0,
    lineHeight: 13,
    textAlign: 'center',
  },
  activeLabel: {
    color: colors.goldAccent,
  },
});
