import { Stack } from 'expo-router';
import { useState } from 'react';
import { IOSGroup } from '@/components/ui/IOSGroup';
import { Screen } from '@/components/ui/Screen';
import { ToggleRow } from '@/components/ui/ToggleRow';

const initial = [
  { key: 'prayers', label: 'Молитвы', subtitle: 'Напоминания о начале молитв', value: true },
  { key: 'shabbat', label: 'Шаббат', subtitle: 'Начало и окончание Шаббата', value: true },
  { key: 'holidays', label: 'Праздники', subtitle: 'Еврейские праздники', value: true },
  { key: 'candles', label: 'Зажигание свечей', subtitle: 'Пятница и ערב праздников', value: true },
  { key: 'events', label: 'Мероприятия', subtitle: 'Ваши записи и напоминания', value: true },
  { key: 'birthdays', label: 'Дни рождения', subtitle: 'Дни рождения контактов', value: true },
  { key: 'weekly', label: 'Недельная глава', subtitle: 'Каждую пятницу утром', value: true },
  { key: 'news', label: 'Новости общины', subtitle: 'Объявления и новости', value: false },
];

export default function NotificationsScreen() {
  const [items, setItems] = useState(initial);
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Уведомления', headerStyle: { backgroundColor: '#0D0D1A' }, headerTintColor: '#fff' }} />
      <Screen>
        <IOSGroup>
          {items.map((item, idx) => (
            <ToggleRow
              key={item.key}
              label={item.label}
              subtitle={item.subtitle}
              value={item.value}
              onValueChange={(v) => setItems((prev) => prev.map((x) => (x.key === item.key ? { ...x, value: v } : x)))}
              isLast={idx === items.length - 1}
            />
          ))}
        </IOSGroup>
      </Screen>
    </>
  );
}
