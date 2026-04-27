import { Stack } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { GlassCard } from '@/components/glass/GlassCard';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';

const tiers = [
  { id: 'basic', title: 'Базовый', amount: '300 ₽/мес', desc: 'Поддержка деятельности общины' },
  { id: 'member', title: 'Участник', amount: '1 000 ₽/мес', desc: 'Скидки на мероприятия', badge: 'Популярный' },
  { id: 'patron', title: 'Меценат', amount: '5 000 ₽/мес', desc: 'Значительный вклад в развитие общины' },
];

export default function SupportScreen() {
  const [selected, setSelected] = useState('member');

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Поддержать общину', headerStyle: { backgroundColor: '#0D0D1A' }, headerTintColor: '#fff' }} />
      <Screen>
        <GlassCard>
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>«Среди Своих» — для вас и с вами</Text>
          <Text style={{ color: 'rgba(255,255,255,0.55)', marginTop: 6 }}>Ваш вклад помогает проводить мероприятия и развивать приложение.</Text>
        </GlassCard>

        {tiers.map((tier) => {
          const active = tier.id === selected;
          return (
            <GlassCard key={tier.id}>
              <View style={{ borderWidth: active ? 1 : 0, borderColor: '#F07A2A', borderRadius: 14, padding: 8 }}>
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>{tier.title} {tier.badge ? `· ${tier.badge}` : ''}</Text>
                <Text style={{ color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>{tier.desc}</Text>
                <Text style={{ color: active ? '#F07A2A' : '#fff', marginVertical: 8, fontWeight: '700' }}>{tier.amount}</Text>
                <PrimaryButton title={active ? 'Выбрано' : 'Выбрать'} onPress={() => setSelected(tier.id)} />
              </View>
            </GlassCard>
          );
        })}

        <PrimaryButton title="Поддержать общину" />
        <Text style={{ color: 'rgba(255,255,255,0.4)', textAlign: 'center' }}>Безопасная оплата · Отмена в любое время</Text>
      </Screen>
    </>
  );
}
