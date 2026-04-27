import { Text, View } from 'react-native';

export function Avatar({ initials, size = 72 }: { initials: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#E52C36', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#fff', fontSize: Math.round(size * 0.28), fontWeight: '700' }}>{initials}</Text>
    </View>
  );
}
