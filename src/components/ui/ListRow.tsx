import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';

type ListRowProps = {
  danger?: boolean;
  icon?: string;
  isLast?: boolean;
  onPress?: () => void;
  rightText?: string;
  subtitle?: string;
  title: string;
};

export function ListRow({
  danger,
  icon,
  isLast,
  onPress,
  rightText,
  subtitle,
  title,
}: ListRowProps) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed && onPress && styles.pressed]}>
      <View style={[styles.row, !isLast && styles.divider]}>
        {icon ? (
          <View style={styles.iconBox}>
            <Text style={styles.icon}>{icon}</Text>
          </View>
        ) : null}
        <View style={styles.textBlock}>
          <Text numberOfLines={1} style={[styles.title, danger && styles.danger]}>
            {title}
          </Text>
          {subtitle ? (
            <Text numberOfLines={2} style={styles.subtitle}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {rightText ? (
          <Text numberOfLines={1} style={[styles.rightText, danger && styles.danger]}>
            {rightText}
          </Text>
        ) : null}
        {onPress ? (
          <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.28)" />
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: {
    backgroundColor: colors.glass.w04,
  },
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
  title: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '500',
    includeFontPadding: false,
  },
  danger: {
    color: colors.danger,
  },
  subtitle: {
    color: colors.textGhost,
    fontSize: 12,
    marginTop: 3,
    lineHeight: 16,
  },
  rightText: {
    maxWidth: 124,
    color: colors.textFaint,
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'right',
  },
});
