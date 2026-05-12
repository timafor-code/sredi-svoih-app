import { Ionicons } from '@expo/vector-icons';
import { Image, Pressable, StyleSheet } from 'react-native';

import { colors } from '@/theme/colors';

const logoSource = require('../../../assets/logo.png');

export function Logo() {
  return <Image source={logoSource} resizeMode="contain" style={styles.logo} />;
}

export function OmerPill() {
  return null;
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
