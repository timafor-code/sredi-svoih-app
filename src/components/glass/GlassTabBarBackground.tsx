import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Platform, StyleSheet, View } from 'react-native';

type GlassTabBarBackgroundProps = {
  radius?: number;
  reduceTransparency?: boolean;
};

export function GlassTabBarBackground({
  radius = 32,
  reduceTransparency = false,
}: GlassTabBarBackgroundProps) {
  const shouldUseBlur = Platform.OS !== 'android' && !reduceTransparency;
  const gradientColors = reduceTransparency
    ? ([
        'rgba(255,255,255,0.12)',
        'rgba(31,31,46,0.82)',
        'rgba(10,10,20,0.96)',
      ] as const)
    : ([
        'rgba(255,255,255,0.18)',
        'rgba(255,255,255,0.04)',
        'rgba(13,13,26,0.55)',
      ] as const);

  return (
    <View
      style={[
        styles.container,
        Platform.OS === 'android' ? styles.androidFallback : null,
        reduceTransparency ? styles.reducedTransparencyFallback : null,
        { borderRadius: radius },
      ]}
    >
      {shouldUseBlur ? (
        <BlurView tint="dark" intensity={85} style={StyleSheet.absoluteFillObject} />
      ) : null}
      <LinearGradient
        colors={gradientColors}
        locations={[0, 0.46, 1]}
        style={StyleSheet.absoluteFillObject}
      />
      <View
        style={[
          styles.overlay,
          reduceTransparency ? styles.overlayReducedTransparency : null,
        ]}
      />
      <View pointerEvents="none" style={[styles.border, { borderRadius: radius }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  androidFallback: {
    backgroundColor: 'rgba(17,17,30,0.86)',
  },
  reducedTransparencyFallback: {
    backgroundColor: 'rgba(13,13,26,0.94)',
  },
  // Dark tint dialed back from 0.38 → 0.22 so the underlying blur
  // actually reads as glass instead of a near-opaque dark panel.
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(13,13,26,0.22)',
  },
  overlayReducedTransparency: {
    backgroundColor: 'rgba(13,13,26,0.48)',
  },
  border: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
});
