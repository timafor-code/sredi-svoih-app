import { Pressable, Text, View } from 'react-native';
export function SegmentControl({ items, value, onChange }: { items: string[]; value: string; onChange: (v: string) => void }) {
  return <View style={{ flexDirection:'row', backgroundColor:'rgba(255,255,255,0.08)', borderRadius:12, padding:3 }}>{items.map((x)=><Pressable key={x} onPress={()=>onChange(x)} style={{ flex:1, padding:8, borderRadius:9, backgroundColor:value===x?'rgba(255,255,255,0.15)':'transparent' }}><Text style={{ color:'#fff', textAlign:'center', opacity:value===x?1:0.6 }}>{x}</Text></Pressable>)}</View>;
}
