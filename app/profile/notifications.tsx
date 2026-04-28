import { Stack } from 'expo-router';
import { useState } from 'react';

import { IOSGroup } from '@/components/ui/IOSGroup';
import { Screen } from '@/components/ui/Screen';
import { SubHeader } from '@/components/ui/SubHeader';
import { ToggleRow } from '@/components/ui/ToggleRow';

const initial = [
  { key: 'prayers', icon: '🕌', label: 'Молитвы', subtitle: 'Напоминания о начале молитв', value: true },
  { key: 'shabbat', icon: '✡️', label: 'Шаббат', subtitle: 'Начало и окончание Шаббата', value: true },
  { key: 'holidays', icon: '🎉', label: 'Праздники', subtitle: 'Еврейские праздники и даты', value: true },
  { key: 'candles', icon: '🕯️', label: 'Зажигание свечей', subtitle: 'Пятница и ערב праздников', value: true },
  { key: 'events', icon: '📅', label: 'Мероприятия', subtitle: 'Ваши записи и напоминания', value: true },
  { key: 'birthdays', icon: '🎂', label: 'Дни рождения', subtitle: 'Дни рождения контактов', value: true },
  { key: 'weekly', icon: '📖', label: 'Недельная глава', subtitle: 'Каждую пятницу утром', value: true },
  { key: 'news', icon: '📰', label: 'Новости общины', subtitle: 'Объявления и новости', value: false },
];

export default function NotificationsScreen() {
  const [items, setItems] = useState(initial);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen contentContainerStyle={{ gap: 16 }}>
        <SubHeader title="Уведомления" subtitle="Настройте, что и когда вам напоминать" />
        <IOSGroup>
          {items.map((item, index) => (
            <ToggleRow
              key={item.key}
              icon={item.icon}
              label={item.label}
              subtitle={item.subtitle}
              value={item.value}
              onValueChange={(value) => setItems((prev) => prev.map((x) => (x.key === item.key ? { ...x, value } : x)))}
              isLast={index === items.length - 1}
            />
          ))}
        </IOSGroup>
      </Screen>
    </>
  );
}
