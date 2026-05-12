import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';

type ToggleRowProps = {
  disabled?: boolean;
  icon?: string;
  isLast?: boolean;
  label: string;
  onValueChange: (value: boolean) => void;
  subtitle?: string;
  value: boolean;
};

export function ToggleRow({
  disabled,
  icon,
  isLast,
  label,
  onValueChange,
  subtitle,
  value,
}: ToggleRowProps) {
  return (
    <View style={[styles.row, !isLast && styles.divider, disabled && styles.disabled]}>
      {icon ? (
        <View style={styles.iconBox}>
          <Text style={styles.icon}>{icon}</Text>
        </View>
      ) : null}
      <View style={styles.textBlock}>
        <Text numberOfLines={2} style={styles.label}>
          {label}
        </Text>
        {subtitle ? (
          <Text numberOfLines={2} style={styles.subtitle}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked: value, disabled }}
        disabled={disabled}
        onPress={() => onValueChange(!value)}
        style={[styles.switchTrack, value && styles.switchTrackOn]}
      >
        <View style={[styles.switchThumb, value && styles.switchThumbOn]} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  disabled: {
    opacity: 0.5,
  },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.glass.w08,
    backgroundColor: colors.glass.w07,
  },
  icon: {
    fontSize: 16,
    includeFontPadding: false,
  },
  textBlock: {
    flex: 1,
    minWidth: 0,
  },
  label: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '500',
    includeFontPadding: false,
    lineHeight: 19,
  },
  subtitle: {
    color: colors.textGhost,
    fontSize: 12,
    marginTop: 3,
    lineHeight: 16,
  },
  switchTrack: {
    width: 48,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.glass.w16,
    backgroundColor: colors.glass.w12,
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  switchTrackOn: {
    borderColor: 'transparent',
    backgroundColor: colors.orange,
    shadowColor: colors.orange,
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  switchThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  switchThumbOn: {
    transform: [{ translateX: 20 }],
  },
});
