import { Stack } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { IOSGroup } from '@/components/ui/IOSGroup';
import { ListRow } from '@/components/ui/ListRow';
import { Screen } from '@/components/ui/Screen';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { SubHeader } from '@/components/ui/SubHeader';
import { ToggleRow } from '@/components/ui/ToggleRow';
import { colors } from '@/theme/colors';

export default function ContactsSettingsScreen() {
  const [syncContacts, setSyncContacts] = useState(true);
  const [showHebrewBirthday, setShowHebrewBirthday] = useState(true);
  const [birthdaysReminder, setBirthdaysReminder] = useState(true);
  const [yahrzeitReminder, setYahrzeitReminder] = useState(false);
  const [advance, setAdvance] = useState('За 3 дня');

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen contentContainerStyle={{ gap: 16 }}>
        <SubHeader title="Контакты и дни рождения" subtitle="Синхронизация, еврейская дата, напоминания" />

        <IOSGroup>
          <ToggleRow icon="🔄" label="Синхронизация контактов" subtitle="Разрешено" value={syncContacts} onValueChange={setSyncContacts} />
          <ToggleRow icon="✡️" label="Еврейская дата рождения" subtitle="Отображать в профиле" value={showHebrewBirthday} onValueChange={setShowHebrewBirthday} isLast />
        </IOSGroup>

        <SectionTitle title="НАПОМИНАНИЯ" />
        <IOSGroup>
          <ToggleRow icon="🎂" label="Дни рождения" subtitle="Напоминать в день" value={birthdaysReminder} onValueChange={setBirthdaysReminder} />
          <ToggleRow icon="🕯️" label="Яарцайт" subtitle="Годовщина ухода" value={yahrzeitReminder} onValueChange={setYahrzeitReminder} />
          <ListRow icon="⏰" title="Заблаговременно" rightText={advance} onPress={() => setAdvance(advance === 'За 3 дня' ? 'За 1 день' : 'За 3 дня')} isLast />
        </IOSGroup>

        <GlassCard>
          <Text style={{ color: colors.textDim, fontSize: 13, lineHeight: 20 }}>
            Приложение использует доступ к контактам только для отображения дней рождения и расчёта еврейских дат. Данные не передаются третьим лицам.
          </Text>
        </GlassCard>
      </Screen>
    </>
  );
}
