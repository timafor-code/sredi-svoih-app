import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';

type SectionTitleProps = {
  action?: string;
  onActionPress?: () => void;
  title: string;
};

export function SectionTitle({ action, onActionPress, title }: SectionTitleProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.title}>{title}</Text>
      {action ? (
        onActionPress ? (
          <Pressable
            accessibilityLabel={action}
            accessibilityRole="button"
            hitSlop={6}
            onPress={onActionPress}
            style={({ pressed }) => pressed && styles.actionPressed}
          >
            <Text style={styles.action}>{action}</Text>
          </Pressable>
        ) : (
          <Text style={styles.action}>{action}</Text>
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    marginTop: 4,
  },
  title: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    includeFontPadding: false,
  },
  action: {
    color: colors.orange,
    fontSize: 12,
    fontWeight: '600',
    includeFontPadding: false,
  },
  actionPressed: {
    opacity: 0.7,
  },
});
