import { View, type ViewProps } from 'react-native';
import { BlurView } from 'expo-blur';
import { colors } from '@/theme/colors';

export function GlassCard({ style, children, ...props }: ViewProps) {
  return (
    <View style={[{ borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }, style]} {...props}>
      <BlurView intensity={25} tint="dark" style={{ padding: 14, backgroundColor: 'rgba(255,255,255,0.04)' }}>{children}</BlurView>
    </View>
  );
}
