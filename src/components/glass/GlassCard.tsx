import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';

type GlassCardProps = ViewProps & {
  contentStyle?: StyleProp<ViewStyle>;
  padded?: boolean;
};

export function GlassCard({
  children,
  contentStyle,
  padded = true,
  style,
  ...props
}: GlassCardProps) {
  return (
    <View style={[styles.shell, style]} {...props}>
      <BlurView tint="dark" intensity={28} style={StyleSheet.absoluteFillObject} />
      <LinearGradient
        colors={['rgba(255,255,255,0.08)', 'rgba(255,255,255,0.025)']}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={[styles.content, !padded && styles.unpadded, contentStyle]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    borderRadius: radius.glassCard,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.glass.w05,
    overflow: 'hidden',
  },
  content: {
    padding: 16,
  },
  unpadded: {
    padding: 0,
  },
});
