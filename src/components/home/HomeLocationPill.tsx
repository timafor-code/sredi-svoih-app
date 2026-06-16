import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text } from 'react-native';

import { colors } from '@/theme/colors';

type HomeLocationPillProps = {
  city: string;
};

export function HomeLocationPill({ city }: HomeLocationPillProps) {
  return (
    <Pressable style={styles.locationPill}>
      <Ionicons name="location" size={13} color="rgba(255,255,255,0.62)" />
      <Text style={styles.locationText}>{city} · зманим</Text>
      <Ionicons name="chevron-forward" size={13} color="rgba(255,255,255,0.4)" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  locationPill: {
    alignSelf: 'flex-start',
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
  locationText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
});
