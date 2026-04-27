import { View, type ViewProps } from 'react-native';
import { GlassCard } from '@/components/glass/GlassCard';

export function IOSGroup({ children, style }: ViewProps) {
  return (
    <GlassCard style={style}>
      <View style={{ paddingHorizontal: 2 }}>{children}</View>
    </GlassCard>
  );
}
