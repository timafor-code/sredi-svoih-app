import { Pressable, Text, View } from 'react-native';

type ListRowProps = {
  title: string;
  subtitle?: string;
  rightText?: string;
  onPress?: () => void;
  danger?: boolean;
  isLast?: boolean;
};

export function ListRow({ title, subtitle, rightText, onPress, danger, isLast }: ListRowProps) {
  return (
    <Pressable onPress={onPress} style={{ paddingVertical: 12, borderBottomWidth: isLast ? 0 : 1, borderBottomColor: 'rgba(255,255,255,0.08)' }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: danger ? '#ff6161' : '#fff', fontSize: 16 }}>{title}</Text>
          {subtitle ? <Text style={{ color: 'rgba(255,255,255,0.5)' }}>{subtitle}</Text> : null}
        </View>
        {rightText ? <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13 }}>{rightText}</Text> : null}
      </View>
    </Pressable>
  );
}
