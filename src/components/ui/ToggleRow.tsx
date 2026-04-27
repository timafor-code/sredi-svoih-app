import { Switch, Text, View } from 'react-native';

type ToggleRowProps = {
  label: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  isLast?: boolean;
};

export function ToggleRow({ label, subtitle, value, onValueChange, isLast }: ToggleRowProps) {
  return (
    <View style={{ paddingVertical: 12, borderBottomWidth: isLast ? 0 : 1, borderBottomColor: 'rgba(255,255,255,0.08)' }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#fff', fontSize: 16 }}>{label}</Text>
          {subtitle ? <Text style={{ color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>{subtitle}</Text> : null}
        </View>
        <Switch value={value} onValueChange={onValueChange} trackColor={{ false: '#4B4B5A', true: '#F07A2A' }} thumbColor="#fff" />
      </View>
    </View>
  );
}
