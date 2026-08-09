import { StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { colors } from '@/theme/colors';

type HomeParshaCardProps = {
  hebrew: string;
  kind: 'parsha' | 'holiday_reading';
  title: string;
};

export function HomeParshaCard({ hebrew, kind, title }: HomeParshaCardProps) {
  return (
    <GlassCard>
      <View style={styles.rowBetween}>
        <View style={styles.textBlock}>
          <Text style={styles.overline}>
            {kind === 'parsha' ? 'НЕДЕЛЬНАЯ ГЛАВА' : 'ПРАЗДНИЧНОЕ ЧТЕНИЕ'}
          </Text>
          <Text numberOfLines={2} style={styles.cardTitle}>{title}</Text>
          <Text numberOfLines={1} style={styles.hebrew}>{hebrew}</Text>
        </View>
        <View style={[styles.roundIcon, styles.blueBox]}>
          <Text style={styles.roundIconText}>📖</Text>
        </View>
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
  textBlock: {
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 20,
    marginTop: 6,
  },
  hebrew: {
    color: colors.textGhost,
    fontSize: 12,
    fontStyle: 'italic',
    lineHeight: 16,
    marginTop: 2,
  },
  roundIcon: {
    width: 52,
    height: 52,
    flexShrink: 0,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  blueBox: {
    borderColor: 'rgba(80,120,200,0.30)',
    backgroundColor: 'rgba(80,120,200,0.15)',
  },
  roundIconText: {
    fontSize: 26,
  },
});
