import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { Image, Pressable, StyleSheet, Text } from 'react-native';

import { useNow } from '@/hooks/useNow';
import { getOmerInfo } from '@/lib/hebcal';
import { getHebcalLocation } from '@/lib/zmanim';
import { colors } from '@/theme/colors';

const logoSource = require('../../../assets/logo.png');

export function Logo() {
  return <Image source={logoSource} resizeMode="contain" style={styles.logo} />;
}

export function OmerPill() {
  const now = useNow();
  const omer = getOmerInfo(now, getHebcalLocation());

  if (!omer) return null;

  return (
    <Link href="/modals/omer" asChild>
      <Pressable style={({ pressed }) => [styles.omerPill, pressed && styles.pressed]}>
        <Text style={styles.omerText}>{omer.day}-й день Омера</Text>
        <Ionicons name="chevron-forward" size={13} color="rgba(255,255,255,0.45)" />
      </Pressable>
    </Link>
  );
}

type HeaderButtonProps = {
  accessibilityLabel?: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
};

export function HeaderButton({ accessibilityLabel, icon, onPress }: HeaderButtonProps) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={18} color="rgba(255,255,255,0.62)" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  logo: {
    width: 131,
    height: 53,
  },
  omerPill: {
    minHeight: 34,
    maxWidth: 150,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.glass.w10,
    backgroundColor: colors.glass.w07,
    paddingHorizontal: 12,
  },
  omerText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    includeFontPadding: false,
  },
  headerButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.glass.w10,
    backgroundColor: colors.glass.w07,
  },
  pressed: {
    opacity: 0.72,
  },
});
