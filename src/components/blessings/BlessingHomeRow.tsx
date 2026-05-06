import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import type { Blessing, BlessingHomeGroup } from '@/types/blessing';

type IoniconName = keyof typeof Ionicons.glyphMap;

type BlessingHomeRowProps = {
  blessing: Blessing;
  group: BlessingHomeGroup;
  isLast?: boolean;
  onPress: (blessing: Blessing) => void;
};

function getBlessingIcon(blessing: Blessing, group: BlessingHomeGroup): IoniconName {
  if (blessing.slug === 'lightning') {
    return 'flash-outline';
  }

  if (blessing.slug === 'thunder') {
    return 'cloud-outline';
  }

  if (blessing.slug === 'rainbow') {
    return 'color-palette-outline';
  }

  if (group === 'after_food') {
    return blessing.slug === 'birkat_hamazon' ? 'receipt-outline' : 'checkmark-circle-outline';
  }

  if (group === 'various') {
    return blessing.slug === 'asher_yatzar' ? 'leaf-outline' : 'sparkles-outline';
  }

  return 'restaurant-outline';
}

export function BlessingHomeRow({ blessing, group, isLast = false, onPress }: BlessingHomeRowProps) {
  return (
    <Pressable
      accessibilityLabel={blessing.titleRu}
      accessibilityRole="button"
      onPress={() => onPress(blessing)}
      style={({ pressed }) => [styles.row, !isLast && styles.rowDivider, pressed && styles.pressed]}
    >
      <View style={styles.iconBox}>
        <Ionicons name={getBlessingIcon(blessing, group)} size={20} color={colors.goldAccent} />
      </View>
      <View style={styles.textBlock}>
        <Text numberOfLines={1} style={styles.title}>
          {blessing.titleRu}
        </Text>
        {blessing.descriptionRu ? (
          <Text numberOfLines={2} style={styles.subtitle}>
            {blessing.descriptionRu}
          </Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={17} color="rgba(255,255,255,0.26)" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 15,
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
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,200,50,0.24)',
    backgroundColor: 'rgba(255,200,50,0.105)',
  },
  textBlock: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    includeFontPadding: false,
  },
  subtitle: {
    color: colors.textGhost,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
  },
});
