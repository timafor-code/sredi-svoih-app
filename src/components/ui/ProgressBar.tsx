import { View } from 'react-native';
export function ProgressBar({ value }: { value: number }) { return <View style={{ height:6, borderRadius:3, backgroundColor:'rgba(255,255,255,0.1)' }}><View style={{ width:`${Math.round(value*100)}%`, height:6, borderRadius:3, backgroundColor:'#F07A2A' }} /></View>; }
