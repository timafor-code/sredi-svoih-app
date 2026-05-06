import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { BlessingHomeRow } from '@/components/blessings/BlessingHomeRow';
import { GlassCard } from '@/components/glass/GlassCard';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import type { Blessing, BlessingHomeGroup as BlessingHomeGroupKey } from '@/types/blessing';

type IoniconName = keyof typeof Ionicons.glyphMap;

type BlessingHomeGroupProps = {
  blessings: readonly Blessing[];
  group: BlessingHomeGroupKey;
  onBlessingPress: (blessing: Blessing) => void;
  title: string;
};

const groupIcons: Record<BlessingHomeGroupKey, IoniconName> = {
  before_food: 'restaurant-outline',
  after_food: 'receipt-outline',
  various: 'sparkles-outline',
};

export function BlessingHomeGroup({
  blessings,
  group,
  onBlessingPress,
  title,
}: BlessingHomeGroupProps) {
  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <Ionicons name={groupIcons[group]} size={15} color={colors.goldAccent} />
        </View>
        <Text style={styles.title}>{title}</Text>
      </View>

      <GlassCard padded={false} style={styles.card}>
        {blessings.map((blessing, index) => (
          <BlessingHomeRow
            key={blessing.slug}
            blessing={blessing}
            group={group}
            isLast={index === blessings.length - 1}
            onPress={onBlessingPress}
          />
        ))}
      </GlassCard>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 2,
  },
  headerIcon: {
    width: 24,
    height: 24,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,200,50,0.20)',
    backgroundColor: colors.accent.goldBg,
  },
  title: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0,
  },
  card: {
    borderColor: colors.borderStrong,
  },
});
