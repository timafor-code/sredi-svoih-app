import { StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { colors } from '@/theme/colors';

type HomeJewishCalendarCardProps = {
  accessibilityLabel: string;
  buttonTitle: string;
  daysLabel: string;
  daysValue: number | string;
  disabled: boolean;
  onPress: () => void;
  overline: string;
  subtitle: string;
  title: string;
};

export function HomeJewishCalendarCard({
  accessibilityLabel,
  buttonTitle,
  daysLabel,
  daysValue,
  disabled,
  onPress,
  overline,
  subtitle,
  title,
}: HomeJewishCalendarCardProps) {
  return (
    <GlassCard>
      <View style={styles.holidayTop}>
        <View style={styles.candleLeft}>
          <Text style={styles.largeEmoji}>📜</Text>
          <View style={styles.flex}>
            <Text style={styles.overline}>{overline}</Text>
            <Text style={styles.orangeTitle}>{title}</Text>
            <Text style={styles.mutedSmall}>{subtitle}</Text>
          </View>
        </View>
        <View style={styles.daysBlock}>
          <Text style={styles.daysNumber}>{daysValue}</Text>
          <Text style={styles.mutedSmall}>{daysLabel}</Text>
        </View>
      </View>
      <PrimaryButton
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        disabled={disabled}
        onPress={onPress}
        textNumberOfLines={2}
        title={buttonTitle}
      />
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
  candleLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  largeEmoji: {
    fontSize: 30,
  },
  mutedSmall: {
    color: colors.textDim,
    fontSize: 12,
  },
  holidayTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  orangeTitle: {
    color: colors.orange,
    fontSize: 16,
    fontWeight: '700',
  },
  daysBlock: {
    alignItems: 'center',
  },
  daysNumber: {
    color: colors.orange,
    fontSize: 36,
    fontWeight: '800',
    lineHeight: 38,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
});
