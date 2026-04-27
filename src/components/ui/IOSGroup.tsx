import { type ViewProps } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';

export function IOSGroup({ children, style }: ViewProps) {
  return (
    <GlassCard padded={false} style={style}>
      {children}
    </GlassCard>
  );
}
