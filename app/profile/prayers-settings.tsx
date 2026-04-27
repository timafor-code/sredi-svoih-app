import { Stack } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { IOSGroup } from '@/components/ui/IOSGroup';
import { ListRow } from '@/components/ui/ListRow';
import { Screen } from '@/components/ui/Screen';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { ToggleRow } from '@/components/ui/ToggleRow';

const nusachOptions = ['Ашкеназ', 'Сефард', 'Хасид (Ари)'] as const;

export default function PrayersSettingsScreen() {
  const [city, setCity] = useState('Москва');
  const [timezone] = useState('Europe/Moscow');
  const [nusach, setNusach] = useState<(typeof nusachOptions)[number]>('Ашкеназ');
  const [siddurLang, setSiddurLang] = useState('Русский');
  const [prayerReminder, setPrayerReminder] = useState(true);
  const [candleReminder, setCandleReminder] = useState(true);
  const [shabbatReminder, setShabbatReminder] = useState(true);
  const [holidayReminder, setHolidayReminder] = useState(false);

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Молитвы и календарь', headerStyle: { backgroundColor: '#0D0D1A' }, headerTintColor: '#fff' }} />
      <Screen>
        <SectionTitle title="МЕСТОПОЛОЖЕНИЕ" />
        <IOSGroup>
          <ListRow title="Город" rightText={city} onPress={() => setCity(city === 'Москва' ? 'Санкт-Петербург' : 'Москва')} />
          <ListRow title="Часовой пояс" rightText={timezone} isLast />
        </IOSGroup>

        <SectionTitle title="НУСАХ И ЯЗЫК" />
        <IOSGroup>
          {nusachOptions.map((item, i) => <ListRow key={item} title={item} rightText={nusach === item ? '✓' : undefined} onPress={() => setNusach(item)} isLast={i === nusachOptions.length - 1} />)}
        </IOSGroup>
        <IOSGroup>
          <ListRow title="Язык сидура" rightText={siddurLang} onPress={() => setSiddurLang(siddurLang === 'Русский' ? 'Иврит + русский' : 'Русский')} isLast />
        </IOSGroup>

        <SectionTitle title="НАПОМИНАНИЯ" />
        <IOSGroup>
          <ToggleRow label="Напоминания о молитвах" subtitle="За 15 минут до начала" value={prayerReminder} onValueChange={setPrayerReminder} />
          <ToggleRow label="Зажигание свечей" subtitle="Шаббат и праздники" value={candleReminder} onValueChange={setCandleReminder} />
          <ToggleRow label="Шаббат" subtitle="Начало и окончание" value={shabbatReminder} onValueChange={setShabbatReminder} />
          <ToggleRow label="Праздники" subtitle="Основные даты календаря" value={holidayReminder} onValueChange={setHolidayReminder} isLast />
        </IOSGroup>

        <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>Зманим рассчитываются по выбранному городу, а не по GPS.</Text>
      </Screen>
    </>
  );
}
