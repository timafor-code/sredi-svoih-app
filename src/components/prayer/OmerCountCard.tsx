import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { getOmerInfo } from '@/lib/hebcal';
import { getHebcalLocation } from '@/lib/zmanim';

type OmerCountCardProps = {
  city: string;
  now: Date;
  onPress: () => void;
};

export function OmerCountCard({ city, now, onPress }: OmerCountCardProps) {
  const location = getHebcalLocation(city);
  const omer = getOmerInfo(now, location);

  if (!omer || omer.day < 1 || omer.day > 49) {
    return null;
  }

  const progress = omer.day / 49;
  const details = [omer.sefirahRu, omer.sefirahHe].filter(Boolean).join(' · ') || omer.countingRu || '';
  const accessibilityDetails = details ? `, ${details}` : '';

  return (
    <Pressable
      accessibilityLabel={`Счёт Омера, день ${omer.day}${accessibilityDetails}. Открыть счёт Омера.`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <LinearGradient
        colors={['rgba(124, 77, 146, 0.34)', 'rgba(124, 77, 146, 0.22)']}
        pointerEvents="none"
        style={[
          styles.progressFill,
          {
            width: `${progress * 100}%`,
          },
          progress >= 0.999 && styles.progressFillComplete,
        ]}
      />

      <View style={styles.content}>
        <Text ellipsizeMode="tail" numberOfLines={1} style={styles.label}>
          Счет Омера:
        </Text>
        <Text numberOfLines={1} style={styles.day}>
          {omer.day}
        </Text>
        <Text ellipsizeMode="tail" numberOfLines={1} style={styles.details}>
          {details}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'relative',
    width: '100%',
    height: 56,
    overflow: 'hidden',
    borderRadius: 26,
    borderWidth: 1,
    borderColor: 'rgba(255, 184, 0, 0.75)',
    backgroundColor: '#050811',
  },
  pressed: {
    opacity: 0.88,
    transform: [{ scale: 0.995 }],
  },
  progressFill: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 4,
    borderTopLeftRadius: 22,
    borderBottomLeftRadius: 22,
  },
  progressFillComplete: {
    borderTopRightRadius: 22,
    borderBottomRightRadius: 22,
  },
  content: {
    position: 'relative',
    zIndex: 1,
    height: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
  },
  label: {
    minWidth: 0,
    flexShrink: 1,
    color: '#B3B3B3',
    fontSize: 13,
    fontWeight: '700',
    includeFontPadding: false,
  },
  day: {
    minWidth: 36,
    flexShrink: 0,
    color: '#F8F5F5',
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 32,
    textAlign: 'center',
    includeFontPadding: false,
  },
  details: {
    minWidth: 0,
    flex: 1,
    color: '#B3B3B3',
    fontSize: 13,
    fontWeight: '400',
    includeFontPadding: false,
  },
});
