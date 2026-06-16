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
    <GlassCard contentStyle={styles.cardContent}>
      <View style={styles.holidayTop}>
        <View style={styles.candleLeft}>
          <Text style={styles.largeEmoji}>📜</Text>
          <View style={styles.flex}>
            <Text style={styles.overline}>{overline}</Text>
            <Text numberOfLines={2} style={styles.orangeTitle}>{title}</Text>
            <Text numberOfLines={1} style={styles.mutedSmall}>{subtitle}</Text>
          </View>
        </View>
        <View style={styles.daysBlock}>
          <Text numberOfLines={1} style={styles.daysNumber}>{daysValue}</Text>
          <Text numberOfLines={1} style={styles.daysLabel}>{daysLabel}</Text>
        </View>
      </View>
      <PrimaryButton
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        textNumberOfLines={2}
        title={buttonTitle}
      />
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  cardContent: {
    gap: 12,
    paddingVertical: 14,
  },
  overline: {
    color: colors.textDim,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    includeFontPadding: false,
  },
  candleLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  largeEmoji: {
    fontSize: 30,
    lineHeight: 34,
  },
  mutedSmall: {
    color: colors.textDim,
    fontSize: 12,
    lineHeight: 16,
  },
  holidayTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  orangeTitle: {
    color: colors.orange,
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 20,
    marginTop: 2,
  },
  daysBlock: {
    minWidth: 46,
    alignItems: 'center',
    flexShrink: 0,
  },
  daysNumber: {
    color: colors.orange,
    fontSize: 36,
    fontWeight: '800',
    lineHeight: 38,
  },
  daysLabel: {
    color: colors.textDim,
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
});
