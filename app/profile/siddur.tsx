import { Stack } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { IOSGroup } from '@/components/ui/IOSGroup';
import { ListRow } from '@/components/ui/ListRow';
import { Screen } from '@/components/ui/Screen';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { ToggleRow } from '@/components/ui/ToggleRow';

const nusachOptions = ['Ашкеназ', 'Сефард', 'Хасид (Ари)', 'Йемени'] as const;

export default function SiddurScreen() {
  const [nusach, setNusach] = useState<(typeof nusachOptions)[number]>('Ашкеназ');
  const [lang, setLang] = useState('Иврит + русский');
  const [fontSize, setFontSize] = useState(16);
  const [nikud, setNikud] = useState(true);
  const [translit, setTranslit] = useState(false);
  const [darkMode, setDarkMode] = useState(true);

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Сидур', headerStyle: { backgroundColor: '#0D0D1A' }, headerTintColor: '#fff' }} />
      <Screen>
        <SectionTitle title="НУСАХ" />
        <IOSGroup>
          {nusachOptions.map((item, i) => <ListRow key={item} title={item} rightText={nusach === item ? '✓' : undefined} onPress={() => setNusach(item)} isLast={i === nusachOptions.length - 1} />)}
        </IOSGroup>

        <SectionTitle title="ОТОБРАЖЕНИЕ" />
        <IOSGroup>
          <ListRow title="Язык" rightText={lang} onPress={() => setLang(lang === 'Иврит + русский' ? 'Русский' : 'Иврит + русский')} />
          <ToggleRow label="Транслитерация" value={translit} onValueChange={setTranslit} />
          <ToggleRow label="Огласовки (никуд)" value={nikud} onValueChange={setNikud} />
          <ToggleRow label="Тёмный режим" value={darkMode} onValueChange={setDarkMode} isLast />
        </IOSGroup>

        <SectionTitle title="РАЗМЕР ШРИФТА" />
        <IOSGroup>
          <View style={{ paddingVertical: 8, gap: 8 }}>
            <Text style={{ color: '#fff' }}>בָּרוּךְ · Пример текста</Text>
            <ListRow title="Текущий размер" rightText={`${fontSize}px`} onPress={() => setFontSize((v) => (v >= 24 ? 12 : v + 2))} isLast />
          </View>
        </IOSGroup>
      </Screen>
    </>
  );
}
