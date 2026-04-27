import { Text } from 'react-native';

export function SectionTitle({ title }: { title: string }) {
  return <Text style={{ color: 'rgba(255,255,255,0.45)', fontWeight: '700', fontSize: 12, letterSpacing: 0.5 }}>{title}</Text>;
}
