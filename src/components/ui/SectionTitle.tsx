import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';

type SectionTitleProps = {
  action?: string;
  title: string;
};

export function SectionTitle({ action, title }: SectionTitleProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.title}>{title}</Text>
      {action ? <Text style={styles.action}>{action}</Text> : null}
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
});
