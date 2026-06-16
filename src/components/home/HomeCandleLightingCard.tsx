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
    <GlassCard>
      <View style={styles.rowBetween}>
        <View style={styles.candleLeft}>
          <Text style={styles.largeEmoji}>🕯️</Text>
          <View>
            <Text style={styles.overline}>ЗАЖИГАНИЕ СВЕЧЕЙ</Text>
            <Text style={styles.bigTime}>{time}</Text>
            <Text style={styles.mutedSmall}>{subtitle}</Text>
          </View>
        </View>
        <PrimaryButton
          title="Записаться на Шабат"
          buttonStyle={styles.candleButton}
          onPress={onRegistrationPress}
          textStyle={styles.smallButtonText}
        />
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
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
    gap: 14,
  },
  candleLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  largeEmoji: {
    fontSize: 30,
  },
  bigTime: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '700',
  },
  mutedSmall: {
    color: colors.textDim,
    fontSize: 12,
  },
  candleButton: {
    width: 104,
    minHeight: 48,
    paddingHorizontal: 10,
  },
  smallButtonText: {
    fontSize: 12,
    lineHeight: 16,
  },
});
