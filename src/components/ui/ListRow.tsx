import { Pressable, Text, View } from 'react-native';
export function ListRow({ title, subtitle, onPress }: { title: string; subtitle?: string; onPress?: () => void }) {
  return <Pressable onPress={onPress} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' }}><Text style={{ color:'#fff', fontSize:16 }}>{title}</Text>{subtitle ? <Text style={{ color:'rgba(255,255,255,0.5)' }}>{subtitle}</Text> : null}</Pressable>;
}
