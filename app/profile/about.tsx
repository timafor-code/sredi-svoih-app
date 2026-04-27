import { Stack } from 'expo-router';
import { Text, View } from 'react-native';
import { IOSGroup } from '@/components/ui/IOSGroup';
import { ListRow } from '@/components/ui/ListRow';
import { Screen } from '@/components/ui/Screen';

export default function AboutScreen() {
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'О приложении', headerStyle: { backgroundColor: '#0D0D1A' }, headerTintColor: '#fff' }} />
      <Screen>
        <View style={{ alignItems: 'center', gap: 6, marginVertical: 8 }}>
          <Text style={{ color: '#fff', fontSize: 30, fontWeight: '700' }}>Среди Своих</Text>
          <Text style={{ color: 'rgba(255,255,255,0.45)' }}>Версия 2.4.1 (build 241)</Text>
        </View>

        <IOSGroup>
          <ListRow title="Написать в поддержку" rightText="support@sredisvoyikh.com" />
          <ListRow title="Сайт общины" rightText="sredisvoyikh.com" />
          <ListRow title="Telegram-канал" rightText="@sredisvoyikh" isLast />
        </IOSGroup>

        <IOSGroup>
          <ListRow title="Политика конфиденциальности" />
          <ListRow title="Пользовательское соглашение" isLast />
        </IOSGroup>

        <Text style={{ color: 'rgba(255,255,255,0.28)', textAlign: 'center', marginTop: 8 }}>© 2026 Среди Своих · Сделано с ❤️ для общины</Text>
      </Screen>
    </>
  );
}
