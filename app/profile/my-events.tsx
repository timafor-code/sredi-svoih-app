import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { SubHeader } from '@/components/ui/SubHeader';
import { colors } from '@/theme/colors';

const events = [
  { title: 'Встреча с Игорем Маричем', date: '23 апреля, 19:00', status: 'Вы записаны', color: '#4CAF50', active: true },
  { title: 'Курс по недельной главе', date: 'Каждый вторник, 20:00', status: 'Активный курс', color: '#4A90D9', active: true },
  { title: 'Шахматный клуб', date: '15 апреля, 18:00', status: 'Завершено', color: 'rgba(255,255,255,0.35)', active: false },
  { title: 'Воскресная школа', date: '7 апреля, 11:00', status: 'Завершено', color: 'rgba(255,255,255,0.35)', active: false },
];

function BookingRow({ item, isLast }: { item: (typeof events)[number]; isLast?: boolean }) {
  return (
    <View style={[styles.bookingRow, !isLast && styles.divider, !item.active && styles.inactive]}>
      <View style={styles.flex}>
        <Text style={styles.bookingTitle}>{item.title}</Text>
        <Text style={styles.bookingDate}>{item.date}</Text>
        <View style={styles.statusRow}>
          <Ionicons name="checkmark" size={12} color={item.color} />
          <Text style={[styles.statusText, { color: item.color }]}>{item.status}</Text>
        </View>
      </View>
      {item.active ? <PrimaryButton title="Открыть →" buttonStyle={styles.openButton} textStyle={styles.openButtonText} /> : null}
    </View>
  );
}

export default function MyEventsScreen() {
  const upcoming = events.filter((event) => event.active);
  const history = events.filter((event) => !event.active);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen contentContainerStyle={{ gap: 16 }}>
        <SubHeader title="Мои записи" subtitle="Ваши записи и билеты" />

        <SectionTitle title="ПРЕДСТОЯЩИЕ" />
        <GlassCard padded={false} style={styles.upcomingCard}>
          {upcoming.map((item, index) => (
            <BookingRow key={item.title} item={item} isLast={index === upcoming.length - 1} />
          ))}
        </GlassCard>

        <SectionTitle title="ИСТОРИЯ" />
        <GlassCard padded={false}>
          {history.map((item, index) => (
            <BookingRow key={item.title} item={item} isLast={index === history.length - 1} />
          ))}
        </GlassCard>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  upcomingCard: {
    borderColor: 'rgba(240,122,42,0.20)',
  },
  bookingRow: {
    minHeight: 84,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  inactive: {
    opacity: 0.62,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  bookingTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  bookingDate: {
    color: colors.textDim,
    fontSize: 12,
    marginTop: 5,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 5,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  openButton: {
    minHeight: 32,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  openButtonText: {
    fontSize: 12,
  },
});
