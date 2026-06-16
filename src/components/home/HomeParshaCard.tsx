import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { colors } from '@/theme/colors';

type HomeParshaCardProps = {
  hebrew: string;
  title: string;
};

export function HomeParshaCard({ hebrew, title }: HomeParshaCardProps) {
  return (
    <GlassCard>
      <View style={styles.rowBetween}>
        <View>
          <Text style={styles.overline}>НЕДЕЛЬНАЯ ГЛАВА</Text>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.hebrew}>{hebrew}</Text>
          <View style={[styles.dateRow, styles.teacherRow]}>
            <Ionicons name="person-outline" size={11} color={colors.textDim} />
            <Text style={styles.mutedSmall}>Урок раввина Рувена Колина</Text>
          </View>
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
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 14,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 6,
  },
  hebrew: {
    color: colors.textGhost,
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 2,
  },
  teacherRow: {
    marginTop: 6,
  },
  mutedSmall: {
    color: colors.textDim,
    fontSize: 12,
  },
  roundIcon: {
    width: 52,
    height: 52,
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
