import { StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { colors } from '@/theme/colors';

type HomeCandleLightingCardProps = {
  onRegistrationPress: () => void;
  subtitle: string;
  time: string;
};

export function HomeCandleLightingCard({
  onRegistrationPress,
  subtitle,
  time,
}: HomeCandleLightingCardProps) {
  return (
    <GlassCard contentStyle={styles.cardContent}>
      <View style={styles.rowBetween}>
        <View style={styles.candleLeft}>
          <Text style={styles.largeEmoji}>🕯️</Text>
          <View style={styles.textBlock}>
            <Text style={styles.overline}>ЗАЖИГАНИЕ СВЕЧЕЙ</Text>
            <Text numberOfLines={1} style={styles.bigTime}>{time}</Text>
            <Text numberOfLines={1} style={styles.mutedSmall}>{subtitle}</Text>
          </View>
        </View>
        <PrimaryButton
          accessibilityRole="button"
          title="Записаться на Шабат"
          buttonStyle={styles.candleButton}
          onPress={onRegistrationPress}
          textNumberOfLines={2}
          textStyle={styles.smallButtonText}
        />
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  cardContent: {
    paddingVertical: 14,
  },
  overline: {
    color: colors.textDim,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    includeFontPadding: false,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  candleLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  textBlock: {
    flex: 1,
    minWidth: 0,
  },
  largeEmoji: {
    fontSize: 30,
    lineHeight: 34,
  },
  bigTime: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '700',
    lineHeight: 31,
  },
  mutedSmall: {
    color: colors.textDim,
    fontSize: 12,
    lineHeight: 16,
  },
  candleButton: {
    width: 110,
    minHeight: 44,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  smallButtonText: {
    fontSize: 12,
    lineHeight: 16,
  },
});
