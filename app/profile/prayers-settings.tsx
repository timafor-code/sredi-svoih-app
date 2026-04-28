import { Stack } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';

import { IOSGroup } from '@/components/ui/IOSGroup';
import { ListRow } from '@/components/ui/ListRow';
import { Screen } from '@/components/ui/Screen';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { SubHeader } from '@/components/ui/SubHeader';
import { ToggleRow } from '@/components/ui/ToggleRow';
import { colors } from '@/theme/colors';

const nusachOptions = ['Ашкеназ', 'Сефард', 'Хасид (Ари)'] as const;

export default function PrayersSettingsScreen() {
  const [city, setCity] = useState('Москва');
  const [nusach, setNusach] = useState<(typeof nusachOptions)[number]>('Ашкеназ');
  const [siddurLang, setSiddurLang] = useState('Русский');
  const [prayerReminder, setPrayerReminder] = useState(true);
  const [candleReminder, setCandleReminder] = useState(true);
  const [shabbatReminder, setShabbatReminder] = useState(true);
  const [holidayReminder, setHolidayReminder] = useState(false);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen contentContainerStyle={{ gap: 16 }}>
        <SubHeader title="Молитвы и календарь" subtitle="Город, нусах, язык сидура, напоминания" />

        <SectionTitle title="МЕСТОПОЛОЖЕНИЕ" />
        <IOSGroup>
          <ListRow icon="📍" title="Город" rightText={city} onPress={() => setCity(city === 'Москва' ? 'Санкт-Петербург' : 'Москва')} />
          <ListRow icon="🌍" title="Часовой пояс" rightText="Europe/Moscow" isLast />
        </IOSGroup>

        <SectionTitle title="НУСАХ И ЯЗЫК" />
        <IOSGroup>
          {nusachOptions.map((item, index) => (
            <ListRow
              key={item}
              title={item}
              rightText={nusach === item ? '✓' : undefined}
              onPress={() => setNusach(item)}
              isLast={index === nusachOptions.length - 1}
            />
          ))}
        </IOSGroup>
        <IOSGroup>
          <ListRow
            icon="🌐"
            title="Язык сидура"
            rightText={siddurLang}
            onPress={() => setSiddurLang(siddurLang === 'Русский' ? 'Иврит + русский' : 'Русский')}
            isLast
          />
        </IOSGroup>

        <SectionTitle title="НАПОМИНАНИЯ" />
        <IOSGroup>
          <ToggleRow icon="⏰" label="Напомнить о молитве" subtitle="За 15 минут до начала" value={prayerReminder} onValueChange={setPrayerReminder} />
          <ToggleRow icon="🕯️" label="Зажигание свечей" subtitle="Шаббат и праздники" value={candleReminder} onValueChange={setCandleReminder} />
          <ToggleRow icon="✡️" label="Начало Шаббата" value={shabbatReminder} onValueChange={setShabbatReminder} />
          <ToggleRow icon="🎉" label="Праздники" value={holidayReminder} onValueChange={setHolidayReminder} isLast />
        </IOSGroup>

        <Text style={{ color: colors.textDim, fontSize: 12, lineHeight: 18 }}>
          Зманим рассчитываются по выбранному городу, а не по GPS.
        </Text>
      </Screen>
    </>
  );
}
