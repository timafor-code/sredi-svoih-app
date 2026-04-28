import { Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { IOSGroup } from '@/components/ui/IOSGroup';
import { ListRow } from '@/components/ui/ListRow';
import { Logo } from '@/components/ui/BrandHeader';
import { Screen } from '@/components/ui/Screen';
import { SubHeader } from '@/components/ui/SubHeader';
import { colors } from '@/theme/colors';

export default function AboutScreen() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen contentContainerStyle={{ gap: 16 }}>
        <SubHeader title="О приложении" subtitle="Версия, поддержка, политика конфиденциальности" />

        <View style={styles.appHero}>
          <Logo />
          <Text style={styles.appName}>Среди Своих</Text>
          <Text style={styles.version}>Версия 2.4.1 (build 241)</Text>
        </View>

        <IOSGroup>
          <ListRow icon="💬" title="Написать в поддержку" rightText="support@sredisvoyikh.com" onPress={() => undefined} />
          <ListRow icon="⭐" title="Оценить приложение" rightText="App Store" onPress={() => undefined} />
          <ListRow icon="📣" title="Telegram-канал общины" onPress={() => undefined} />
          <ListRow icon="🌐" title="Сайт общины" rightText="sredisvoyikh.com" onPress={() => undefined} isLast />
        </IOSGroup>

        <IOSGroup>
          <ListRow icon="📄" title="Политика конфиденциальности" onPress={() => undefined} />
          <ListRow icon="📋" title="Пользовательское соглашение" onPress={() => undefined} isLast />
        </IOSGroup>

        <Text style={styles.copy}>© 2026 Среди Своих · Сделано с ❤️ для общины</Text>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  appHero: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 18,
  },
  appName: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '800',
  },
  version: {
    color: colors.textGhost,
    fontSize: 13,
  },
  copy: {
    color: 'rgba(255,255,255,0.24)',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
});
