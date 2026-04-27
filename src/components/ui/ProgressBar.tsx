import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View, type DimensionValue } from 'react-native';

type ProgressBarProps = {
  value: number;
  color?: string;
  height?: number;
};

export function ProgressBar({ color = '#F07A2A', height = 6, value }: ProgressBarProps) {
  const width = `${Math.max(0, Math.min(100, Math.round(value * 100)))}%` as DimensionValue;

  return (
    <View style={[styles.track, { height, borderRadius: height / 2 }]}>
      <LinearGradient
        colors={[`${color}99`, color]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.fill, { width, borderRadius: height / 2 }]}
      />
      {[25, 50, 75].map((tick) => (
        <View key={tick} style={[styles.tick, { left: `${tick}%` }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  fill: {
    height: '100%',
  },
  tick: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
});
