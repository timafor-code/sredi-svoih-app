import { Stack } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { IOSGroup } from '@/components/ui/IOSGroup';
import { ListRow } from '@/components/ui/ListRow';
import { Screen } from '@/components/ui/Screen';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { ToggleRow } from '@/components/ui/ToggleRow';

export default function ContactsSettingsScreen() {
  const [syncContacts, setSyncContacts] = useState(true);
  const [showHebrewBirthday, setShowHebrewBirthday] = useState(true);
  const [birthdaysReminder, setBirthdaysReminder] = useState(true);
  const [yahrzeitReminder, setYahrzeitReminder] = useState(false);
  const [advance, setAdvance] = useState('За 3 дня');

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Контакты и дни рождения', headerStyle: { backgroundColor: '#0D0D1A' }, headerTintColor: '#fff' }} />
      <Screen>
        <IOSGroup>
          <ToggleRow label="Синхронизация контактов" subtitle="Разрешено" value={syncContacts} onValueChange={setSyncContacts} />
          <ToggleRow label="Еврейская дата рождения" subtitle="Показывать в карточке" value={showHebrewBirthday} onValueChange={setShowHebrewBirthday} isLast />
        </IOSGroup>

        <SectionTitle title="НАПОМИНАНИЯ" />
        <IOSGroup>
          <ToggleRow label="Дни рождения" subtitle="Напоминать в день" value={birthdaysReminder} onValueChange={setBirthdaysReminder} />
          <ToggleRow label="Яарцайт" subtitle="Годовщина ухода" value={yahrzeitReminder} onValueChange={setYahrzeitReminder} />
          <ListRow title="Заблаговременно" rightText={advance} onPress={() => setAdvance(advance === 'За 3 дня' ? 'За 1 день' : 'За 3 дня')} isLast />
        </IOSGroup>

        <Text style={{ color: 'rgba(255,255,255,0.5)', lineHeight: 20 }}>
          Контакты используются локально для расчёта дней рождения и еврейских дат. Автоматическая отправка всех контактов на сервер не выполняется.
        </Text>
      </Screen>
    </>
  );
}
