import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text } from 'react-native';

import { colors } from '@/theme/colors';

type HomeLocationPillProps = {
  city: string;
  onPress: () => void;
};

export function HomeLocationPill({ city, onPress }: HomeLocationPillProps) {
  return (
    <Pressable
      accessibilityLabel={`Выбрать город для зманим. Текущий город: ${city}`}
      accessibilityRole="button"
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [styles.locationPill, pressed && styles.pressed]}
    >
      <Ionicons name="location" size={13} color="rgba(255,255,255,0.62)" />
      <Text numberOfLines={1} style={styles.locationText}>{city} · зманим</Text>
      <Ionicons name="chevron-forward" size={13} color="rgba(255,255,255,0.4)" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  locationPill: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.glass.w10,
    backgroundColor: colors.glass.w07,
    paddingHorizontal: 14,
  },
  pressed: {
    opacity: 0.85,
  },
  locationText: {
    flexShrink: 1,
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 17,
  },
});
