import { Platform, ScrollView, StyleSheet, type ScrollViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/theme/colors';

export function Screen({ children, contentContainerStyle, style, ...props }: ScrollViewProps) {
  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        style={[styles.scroll, style]}
        contentContainerStyle={[styles.content, contentContainerStyle]}
        {...props}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: {
    flex: 1,
  },
  content: {
    width: '100%',
    maxWidth: Platform.OS === 'web' ? 430 : undefined,
    alignSelf: Platform.OS === 'web' ? 'center' : undefined,
    paddingHorizontal: Platform.OS === 'web' ? 18 : 16,
    paddingTop: Platform.OS === 'web' ? 14 : 8,
    paddingBottom: Platform.OS === 'ios' ? 24 : Platform.OS === 'web' ? 132 : 132,
    gap: Platform.OS === 'web' ? 14 : 12,
  },
});
