import { Pressable, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

export function PrimaryButton({ title, onPress }: { title: string; onPress?: () => void }) {
  return <Pressable onPress={onPress}><LinearGradient colors={['#F07A2A','#E05A10']} style={{ padding: 12, borderRadius: 12 }}><Text style={{ color:'#fff', fontWeight:'700', textAlign:'center' }}>{title}</Text></LinearGradient></Pressable>;
}
