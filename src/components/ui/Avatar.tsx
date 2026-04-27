import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

type AvatarProps = {
  bg?: string;
  initials: string;
  size?: number;
};

export function Avatar({ bg = '#1a3a5c', initials, size = 72 }: AvatarProps) {
  return (
    <View style={[styles.shell, { width: size, height: size, borderRadius: size / 2 }]}>
      <LinearGradient
        colors={[bg, 'rgba(0,0,0,0.28)']}
        style={[StyleSheet.absoluteFillObject, { borderRadius: size / 2 }]}
      />
      <Text style={[styles.initials, { fontSize: Math.round(size * 0.32) }]}>
        {initials}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
  },
  initials: {
    color: '#fff',
    fontWeight: '700',
    includeFontPadding: false,
  },
});
