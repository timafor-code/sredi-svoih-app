import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { SubHeader } from '@/components/ui/SubHeader';
import { colors } from '@/theme/colors';

const tiers = [
  { id: 'basic', title: 'Базовый', amount: '300 ₽/мес', desc: 'Поддержка деятельности общины', badge: undefined },
  { id: 'member', title: 'Участник', amount: '1 000 ₽/мес', desc: 'Участник общины со скидками на мероприятия', badge: 'Популярный' },
  { id: 'patron', title: 'Меценат', amount: '5 000 ₽/мес', desc: 'Значительный вклад в развитие общины', badge: undefined },
] as const;

export default function SupportScreen() {
  const [selected, setSelected] = useState<(typeof tiers)[number]['id']>('member');

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen contentContainerStyle={{ gap: 16 }}>
        <SubHeader title="Поддержать общину" subtitle="Ваш вклад в развитие общины" />

        <GlassCard style={styles.hero}>
          <Text style={styles.heroEmoji}>🤝</Text>
          <Text style={styles.heroTitle}>«Среди Своих» — для вас и с вами</Text>
          <Text style={styles.heroText}>Ваш вклад помогает нам проводить мероприятия, развивать приложение и укреплять общину</Text>
        </GlassCard>

        {tiers.map((tier) => {
          const active = tier.id === selected;
          return (
            <Pressable key={tier.id} onPress={() => setSelected(tier.id)} style={({ pressed }) => [pressed && styles.pressed]}>
              <GlassCard style={[styles.tier, active && styles.tierActive]}>
                {tier.badge ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{tier.badge}</Text>
                  </View>
                ) : null}
                <View style={styles.tierContent}>
                  <View style={styles.flex}>
                    <Text style={styles.tierTitle}>{tier.title}</Text>
                    <Text style={styles.tierDesc}>{tier.desc}</Text>
                  </View>
                  <View style={styles.amountBlock}>
                    <Text style={[styles.amount, active && styles.amountActive]}>{tier.amount}</Text>
                    {active ? <Ionicons name="checkmark-circle" size={20} color={colors.orange} /> : null}
                  </View>
                </View>
              </GlassCard>
            </Pressable>
          );
        })}

        <PrimaryButton title="Поддержать общину →" buttonStyle={styles.cta} />
        <Text style={styles.safeText}>Безопасная оплата · Отмена в любое время</Text>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  hero: {
    alignItems: 'center',
    borderColor: 'rgba(240,122,42,0.20)',
    backgroundColor: 'rgba(240,122,42,0.08)',
  },
  heroEmoji: {
    fontSize: 32,
    marginBottom: 8,
  },
  heroTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
  },
  heroText: {
    color: colors.textFaint,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 6,
  },
  tier: {
    position: 'relative',
  },
  tierActive: {
    borderColor: 'rgba(240,122,42,0.40)',
    backgroundColor: 'rgba(240,122,42,0.12)',
  },
  badge: {
    position: 'absolute',
    top: -10,
    right: 16,
    zIndex: 2,
    borderRadius: 8,
    backgroundColor: colors.orange,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badgeText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '800',
  },
  tierContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  flex: {
    flex: 1,
  },
  tierTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
  },
  tierDesc: {
    color: colors.textFaint,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  amountBlock: {
    alignItems: 'flex-end',
    gap: 5,
  },
  amount: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  amountActive: {
    color: colors.orange,
  },
  cta: {
    minHeight: 48,
    borderRadius: 14,
  },
  safeText: {
    color: colors.textGhost,
    fontSize: 12,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.82,
  },
});
