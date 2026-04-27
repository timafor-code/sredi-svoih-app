import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, type ScrollViewProps } from 'react-native';
import { colors } from '@/theme/colors';

export function Screen({ children, ...props }: ScrollViewProps) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 120 }} {...props}>{children}</ScrollView>
    </SafeAreaView>
  );
}
