import { Stack, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { colors } from '@/theme/colors';

export default function EventRegistration() {
  const router = useRouter();

  return (
    <>
      <Stack.Screen options={{ headerShown: false, presentation: 'modal' }} />
      <Screen contentContainerStyle={{ gap: 16 }}>
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>ЗАПИСЬ НА СОБЫТИЕ</Text>
            <Text style={styles.title}>Встреча с Игорем Маричем</Text>
            <Text style={styles.subtitle}>23 апреля, 19:00 · Среди Своих</Text>
          </View>
          <Pressable onPress={() => router.back()} style={styles.close}>
            <Text style={styles.closeText}>×</Text>
          </Pressable>
        </View>

        <GlassCard>
          <Text style={styles.cardTitle}>Вы почти записаны</Text>
          <Text style={styles.body}>Мы сохраним регистрацию в разделе «Мои записи» и напомним о встрече заранее.</Text>
        </GlassCard>

        <GlassCard>
          <Text style={styles.cardTitle}>Что будет на встрече</Text>
          <Text style={styles.body}>Разговор о еврейской идентичности, общине и личном пути. Формат — камерная беседа и вопросы.</Text>
        </GlassCard>

        <PrimaryButton title="Подтвердить запись →" onPress={() => router.back()} />
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  kicker: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginTop: 4,
  },
  subtitle: {
    color: colors.textDim,
    fontSize: 13,
    marginTop: 4,
  },
  close: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass.w10,
  },
  closeText: {
    color: colors.text,
    fontSize: 28,
    lineHeight: 30,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 6,
  },
  body: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
  },
});
