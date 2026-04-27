import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Link, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { Logo, OmerPill } from '@/components/ui/BrandHeader';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Screen } from '@/components/ui/Screen';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { Avatar } from '@/components/ui/Avatar';
import { colors } from '@/theme/colors';

const birthdays = [
  { initials: 'ДК', name: 'Давид Коэн', hebrew: 'דוד כהן', bg: '#c0392b', when: 'Сегодня 🎉', active: true },
  { initials: 'РЛ', name: 'Рахель Леви', hebrew: 'רחל לוי', bg: '#8e44ad', when: 'через 7д' },
  { initials: 'МБ', name: 'Моше Берг', hebrew: 'משה ברג', bg: '#2c7a4b', when: 'через 15д' },
];

function DeadlineCard() {
  return (
    <GlassCard style={styles.deadlineCard}>
      <View style={styles.progressTint} />
      <View style={styles.deadlineTop}>
        <View style={styles.deadlineLeft}>
          <View style={[styles.emojiBox, styles.greenBox]}>
            <Text style={styles.emoji}>🙏</Text>
          </View>
          <View>
            <Text style={styles.overline}>УТРЕННЕЕ ШМА ДО</Text>
            <Text style={styles.deadlineTime}>09:48</Text>
          </View>
        </View>
        <View style={styles.deadlineRight}>
          <Text style={styles.greenValue}>1 ч 33 мин</Text>
          <Text style={styles.tinyMuted}>осталось · 42%</Text>
        </View>
      </View>
      <ProgressBar value={0.42} color={colors.success} />
      <View style={styles.progressLegend}>
        <Text style={styles.tinyMuted}>06:05 восход</Text>
        <Text style={styles.tinyMuted}>09:48 дедлайн</Text>
      </View>
    </GlassCard>
  );
}

function EventCard() {
  return (
    <GlassCard padded={false}>
      <View style={styles.eventCard}>
        <LinearGradient colors={['#22233a', '#101119']} style={styles.eventImage}>
          <View style={styles.personLeft} />
          <View style={styles.personHeadLeft} />
          <View style={styles.personRight} />
          <View style={styles.personHeadRight} />
          <LinearGradient colors={['transparent', 'rgba(13,15,24,0.72)']} style={styles.eventImageShade} />
        </LinearGradient>
        <View style={styles.eventBody}>
          <View>
            <View style={styles.dateRow}>
              <Ionicons name="calendar-outline" size={11} color={colors.textDim} />
              <Text style={styles.eventMeta}>23 апреля, 19:00</Text>
            </View>
            <Text style={styles.eventTitle}>Встреча с Игорем Маричем</Text>
          </View>
          <PrimaryButton title="Записаться →" buttonStyle={styles.eventButton} />
        </View>
      </View>
    </GlassCard>
  );
}

function PrayerNowCard() {
  return (
    <GlassCard>
      <View style={styles.goldTint} />
      <View style={styles.deadlineTop}>
        <View style={styles.deadlineLeft}>
          <View style={[styles.emojiBox, styles.goldBox]}>
            <Text style={styles.emoji}>🌅</Text>
          </View>
          <View>
            <View style={styles.rowGap}>
              <Text style={styles.overline}>СЕЙЧАС · ШАХАРИТ</Text>
              <Text style={styles.statusBadge}>ИДЁТ</Text>
            </View>
            <Text style={styles.deadlineTime}>до 09:48</Text>
          </View>
        </View>
        <View style={styles.deadlineRight}>
          <Text style={styles.goldValue}>1 ч 33 мин</Text>
          <Text style={styles.tinyMuted}>осталось · 42%</Text>
        </View>
      </View>
      <ProgressBar value={0.42} color={colors.gold} />
      <View style={styles.progressLegend}>
        <Text style={styles.tinyMuted}>06:05 восход</Text>
        <Text style={styles.tinyMuted}>09:48 окончание</Text>
      </View>
    </GlassCard>
  );
}

function DayTimeline() {
  return (
    <GlassCard>
      <View style={styles.timelineHeader}>
        <Text style={styles.sectionInline}>МОЛИТВЫ СЕГОДНЯ</Text>
        <Text style={styles.timeBadge}>14:30</Text>
        <Link href="/prayers" asChild>
          <Pressable>
            <Text style={styles.linkText}>Все зманим →</Text>
          </Pressable>
        </Link>
      </View>
      <View style={styles.timelineTrack}>
        <View style={[styles.timelineSegment, { flex: 3.5, backgroundColor: 'rgba(255,200,50,0.5)' }]} />
        <View style={[styles.timelineSegment, { flex: 3.5, backgroundColor: 'rgba(240,100,42,0.7)' }]} />
        <View style={[styles.timelineSegment, { flex: 3, backgroundColor: 'rgba(80,100,200,0.4)' }]} />
        <View style={styles.timelineMarker} />
      </View>
      <View style={styles.progressLegend}>
        {['05:12', '06:05', '12:47', '19:52', '20:16'].map((time) => (
          <Text key={time} style={styles.tinyMuted}>
            {time}
          </Text>
        ))}
      </View>
    </GlassCard>
  );
}

function BirthdayRow({ item, isLast }: { item: (typeof birthdays)[number]; isLast?: boolean }) {
  const router = useRouter();

  return (
    <Pressable
      onPress={() => router.push('/contacts/david-cohen')}
      style={({ pressed }) => [styles.birthdayRow, !isLast && styles.rowDivider, pressed && styles.rowPressed]}
    >
      <Avatar initials={item.initials} bg={item.bg} size={40} />
      <View style={styles.birthdayContent}>
        <View style={styles.flex}>
          <Text style={styles.birthdayName}>{item.name}</Text>
          <Text style={styles.birthdayHebrew}>{item.hebrew}</Text>
        </View>
        <Text style={[styles.birthdayWhen, item.active && styles.birthdayToday]}>{item.when}</Text>
      </View>
    </Pressable>
  );
}

export default function HomeScreen() {
  return (
    <Screen>
      <View style={styles.header}>
        <Logo />
        <OmerPill />
      </View>

      <View>
        <Text style={styles.dateTitle}>23 Нисана 5785</Text>
        <Text style={styles.dateSubtitle}>22 апреля 2026</Text>
      </View>

      <Pressable style={styles.locationPill}>
        <Ionicons name="location" size={13} color="rgba(255,255,255,0.62)" />
        <Text style={styles.locationText}>Москва · зманим</Text>
        <Ionicons name="chevron-forward" size={13} color="rgba(255,255,255,0.4)" />
      </Pressable>

      <DeadlineCard />
      <EventCard />
      <PrayerNowCard />
      <DayTimeline />

      <GlassCard>
        <View style={styles.rowBetween}>
          <View>
            <Text style={styles.overline}>НЕДЕЛЬНАЯ ГЛАВА</Text>
            <Text style={styles.cardTitle}>Ахарей Мот</Text>
            <Text style={styles.hebrew}>אחרי מות</Text>
            <View style={[styles.dateRow, styles.teacherRow]}>
              <Ionicons name="person-outline" size={11} color={colors.textDim} />
              <Text style={styles.mutedSmall}>Урок раввина Рувена Колина</Text>
            </View>
          </View>
          <View style={[styles.roundIcon, styles.blueBox]}>
            <Text style={styles.roundIconText}>📖</Text>
          </View>
        </View>
      </GlassCard>

      <GlassCard>
        <View style={styles.rowBetween}>
          <View style={styles.candleLeft}>
            <Text style={styles.largeEmoji}>🕯️</Text>
            <View>
              <Text style={styles.overline}>ЗАЖИГАНИЕ СВЕЧЕЙ</Text>
              <Text style={styles.bigTime}>19:52</Text>
              <Text style={styles.mutedSmall}>пятница, 24 апр</Text>
            </View>
          </View>
          <PrimaryButton
            title="Записаться на Шабат"
            buttonStyle={styles.candleButton}
            textStyle={styles.smallButtonText}
          />
        </View>
      </GlassCard>

      <GlassCard>
        <View style={styles.holidayTop}>
          <View style={styles.candleLeft}>
            <Text style={styles.largeEmoji}>📜</Text>
            <View style={styles.flex}>
              <Text style={styles.overline}>БЛИЖАЙШИЙ ПРАЗДНИК</Text>
              <Text style={styles.orangeTitle}>Шавуот</Text>
              <Text style={styles.mutedSmall}>11–13 июня · 6–7 Сивана 5785</Text>
            </View>
          </View>
          <View style={styles.daysBlock}>
            <Text style={styles.daysNumber}>15</Text>
            <Text style={styles.mutedSmall}>дней</Text>
          </View>
        </View>
        <PrimaryButton title="Записаться на Шавуот →" />
      </GlassCard>

      <View>
        <SectionTitle title="ДНИ РОЖДЕНИЯ · КОНТАКТЫ" action="Все контакты →" />
        <GlassCard padded={false}>
          {birthdays.map((item, index) => (
            <BirthdayRow key={item.name} item={item} isLast={index === birthdays.length - 1} />
          ))}
        </GlassCard>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  dateTitle: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  dateSubtitle: {
    color: colors.textDim,
    fontSize: 14,
    marginTop: 2,
  },
  locationPill: {
    alignSelf: 'flex-start',
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.glass.w10,
    backgroundColor: colors.glass.w07,
    paddingHorizontal: 14,
  },
  locationText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
  deadlineCard: {
    position: 'relative',
  },
  progressTint: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: '42%',
    backgroundColor: 'rgba(76,175,80,0.08)',
  },
  goldTint: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: '42%',
    backgroundColor: 'rgba(246,164,0,0.08)',
  },
  deadlineTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  deadlineLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  deadlineRight: {
    alignItems: 'flex-end',
  },
  emojiBox: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  greenBox: {
    borderColor: 'rgba(76,175,80,0.30)',
    backgroundColor: 'rgba(76,175,80,0.15)',
  },
  goldBox: {
    borderColor: 'rgba(246,164,0,0.30)',
    backgroundColor: 'rgba(246,164,0,0.15)',
  },
  emoji: {
    fontSize: 14,
  },
  overline: {
    color: colors.textDim,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    includeFontPadding: false,
  },
  deadlineTime: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginTop: 2,
  },
  greenValue: {
    color: colors.success,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  goldValue: {
    color: colors.gold,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  tinyMuted: {
    color: colors.textGhost,
    fontSize: 10,
    fontWeight: '500',
  },
  progressLegend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 5,
  },
  eventCard: {
    minHeight: 130,
    flexDirection: 'row',
  },
  eventImage: {
    width: 140,
    minHeight: 130,
    position: 'relative',
    overflow: 'hidden',
  },
  eventImageShade: {
    ...StyleSheet.absoluteFillObject,
  },
  personLeft: {
    position: 'absolute',
    bottom: 0,
    left: 10,
    width: 55,
    height: 90,
    borderTopLeftRadius: 40,
    borderTopRightRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  personHeadLeft: {
    position: 'absolute',
    bottom: 70,
    left: 22,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  personRight: {
    position: 'absolute',
    bottom: 0,
    right: 10,
    width: 60,
    height: 100,
    borderTopLeftRadius: 40,
    borderTopRightRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  personHeadRight: {
    position: 'absolute',
    bottom: 80,
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.09)',
  },
  eventBody: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  eventMeta: {
    color: colors.textDim,
    fontSize: 11,
  },
  eventTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
    marginTop: 6,
  },
  eventButton: {
    minHeight: 36,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  rowGap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusBadge: {
    overflow: 'hidden',
    borderRadius: 5,
    backgroundColor: 'rgba(246,164,0,0.20)',
    color: colors.gold,
    fontSize: 9,
    fontWeight: '700',
    paddingHorizontal: 6,
    paddingVertical: 2,
    includeFontPadding: false,
  },
  timelineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 12,
  },
  sectionInline: {
    color: colors.textFaint,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  timeBadge: {
    overflow: 'hidden',
    borderRadius: 8,
    backgroundColor: colors.glass.w12,
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  linkText: {
    color: colors.orange,
    fontSize: 12,
    fontWeight: '600',
  },
  timelineTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    flexDirection: 'row',
    position: 'relative',
    marginBottom: 11,
  },
  timelineSegment: {
    height: 8,
  },
  timelineMarker: {
    position: 'absolute',
    top: -4,
    left: '50%',
    width: 3,
    height: 16,
    borderRadius: 2,
    backgroundColor: '#ff4444',
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 14,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 6,
  },
  hebrew: {
    color: colors.textGhost,
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 2,
  },
  teacherRow: {
    marginTop: 6,
  },
  mutedSmall: {
    color: colors.textDim,
    fontSize: 12,
  },
  roundIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  blueBox: {
    borderColor: 'rgba(80,120,200,0.30)',
    backgroundColor: 'rgba(80,120,200,0.15)',
  },
  roundIconText: {
    fontSize: 26,
  },
  candleLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  largeEmoji: {
    fontSize: 30,
  },
  bigTime: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '700',
  },
  candleButton: {
    width: 104,
    minHeight: 48,
    paddingHorizontal: 10,
  },
  smallButtonText: {
    fontSize: 12,
    lineHeight: 16,
  },
  holidayTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  orangeTitle: {
    color: colors.orange,
    fontSize: 16,
    fontWeight: '700',
  },
  daysBlock: {
    alignItems: 'center',
  },
  daysNumber: {
    color: colors.orange,
    fontSize: 36,
    fontWeight: '800',
    lineHeight: 38,
  },
  birthdayRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  rowPressed: {
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  birthdayContent: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  birthdayName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  birthdayHebrew: {
    color: colors.textGhost,
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 2,
  },
  birthdayWhen: {
    color: colors.textDim,
    fontSize: 13,
    fontWeight: '600',
  },
  birthdayToday: {
    color: colors.orange,
  },
});
