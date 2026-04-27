import { Stack, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { mockOmer } from '@/data/mockOmer';
import { colors } from '@/theme/colors';

export default function OmerModal() {
  const router = useRouter();

  return (
    <>
      <Stack.Screen options={{ headerShown: false, presentation: 'modal' }} />
      <Screen contentContainerStyle={{ gap: 16 }}>
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>ОМЕР · ДЕНЬ {mockOmer.day}</Text>
            <Text style={styles.title}>{mockOmer.fullName}</Text>
          </View>
          <Pressable onPress={() => router.back()} style={styles.close}>
            <Text style={styles.closeText}>×</Text>
          </Pressable>
        </View>

        <GlassCard style={styles.hero}>
          <Text style={styles.day}>{mockOmer.day}</Text>
          <Text style={styles.hebrew}>{mockOmer.fullNameHeb}</Text>
          <Text style={styles.meaning}>{mockOmer.meaning}</Text>
        </GlassCard>

        <GlassCard>
          <Text style={styles.body}>{mockOmer.description}</Text>
        </GlassCard>

        <GlassCard style={styles.countingCard}>
          <Text style={styles.countingHeb}>{mockOmer.countingHeb}</Text>
          <Text style={styles.body}>{mockOmer.countingRu}</Text>
        </GlassCard>

        <PrimaryButton title="Я посчитал(а) сегодня" onPress={() => router.back()} />
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  kicker: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.9,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
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
  hero: {
    alignItems: 'center',
    borderColor: colors.accent.goldBorder,
    backgroundColor: colors.accent.goldBg,
  },
  day: {
    color: colors.gold,
    fontSize: 64,
    fontWeight: '800',
    lineHeight: 70,
  },
  hebrew: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
    marginTop: 4,
  },
  meaning: {
    color: colors.accent.goldText,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 8,
  },
  body: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 23,
  },
  countingCard: {
    borderColor: 'rgba(255,255,255,0.12)',
  },
  countingHeb: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 10,
  },
});
