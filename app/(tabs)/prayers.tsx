import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { HeaderButton, Logo } from '@/components/ui/BrandHeader';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Screen } from '@/components/ui/Screen';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { useNow } from '@/hooks/useNow';
import { formatRuDate, formatRuTime, progressBetween } from '@/lib/dates';
import { getHebrewDate, getHebrewDateLabel } from '@/lib/hebcal';
import { getDailyZmanim, getHebcalLocation, getPrayerWindows } from '@/lib/zmanim';
import { useSettingsStore } from '@/store/useSettingsStore';
import { colors } from '@/theme/colors';

function PrayerCard({
  accent,
  active,
  icon,
  progress = 0,
  state = 'done',
  status,
  subtitle,
  timeZone,
  title,
  windowEnd,
  windowStart,
}: {
  accent: string;
  active?: boolean;
  icon: string;
  progress?: number;
  state?: 'done' | 'upcoming';
  status?: string;
  subtitle: string;
  timeZone: string;
  title: string;
  windowEnd: Date;
  windowStart: Date;
}) {
  return (
    <GlassCard style={active && styles.activePrayer}>
      <View style={styles.prayerTop}>
        <View style={[styles.prayerIcon, { borderColor: `${accent}55`, backgroundColor: `${accent}1F` }]}>
          <Text style={styles.prayerEmoji}>{icon}</Text>
        </View>
        <View style={styles.flex}>
          <View style={styles.nameRow}>
            <Text style={styles.prayerName}>{title}</Text>
            {active ? <Text style={styles.nowBadge}>СЕЙЧАС</Text> : null}
            {status ? <Text style={styles.prayerHebrew}>{status}</Text> : null}
          </View>
          <Text style={[styles.prayerSubtitle, active && { color: accent }]}>{subtitle}</Text>
        </View>
        {!active ? (
          <View style={styles.doneRow}>
            <Text style={styles.doneText}>{state === 'done' ? 'завершена' : 'ожидает'}</Text>
            <Ionicons name={state === 'done' ? 'checkmark-circle-outline' : 'time-outline'} size={18} color="rgba(255,255,255,0.35)" />
          </View>
        ) : null}
      </View>
      {active ? (
        <View>
          <View style={styles.progressLabels}>
            <Text style={styles.tinyMuted}>{formatRuTime(windowStart, timeZone)}</Text>
            <Text style={styles.progressPercent}>{Math.round(progress * 100)}%</Text>
            <Text style={styles.tinyMuted}>{formatRuTime(windowEnd, timeZone)}</Text>
          </View>
          <ProgressBar value={progress} color={colors.orange} height={4} />
        </View>
      ) : null}
    </GlassCard>
  );
}

export default function PrayersScreen() {
  const now = useNow();
  const city = useSettingsStore((state) => state.city);
  const location = useMemo(() => getHebcalLocation(city), [city]);
  const daily = useMemo(() => getDailyZmanim({ city, date: now }), [city, now]);
  const hdate = useMemo(() => getHebrewDate(now, location), [location, now]);
  const prayers = useMemo(() => getPrayerWindows(daily, now), [daily, now]);
  const dayProgress = progressBetween(daily.times.alot.at, daily.times.tzeit.at, now);
  const nextZmanId = daily.items.find((item) => now.getTime() < item.at.getTime())?.id;
  const overview = [
    { e: '🌅', l: 'Рассвет', t: daily.times.alot.time },
    { e: '⚡', l: 'Полдень', t: daily.times.chatzot.time },
    { e: '🌇', l: 'Закат', t: daily.times.sunset.time },
    { e: '🌃', l: 'Ночь', t: daily.times.tzeit.time },
  ];

  return (
    <Screen>
      <View style={styles.header}>
        <Logo />
        <View style={styles.cityPill}>
          <Ionicons name="location" size={13} color="rgba(255,255,255,0.62)" />
          <Text style={styles.cityText}>По выбранному городу{'\n'}не по GPS</Text>
        </View>
      </View>

      <View>
        <Text style={styles.title}>Молитвы и зманим</Text>
        <Text style={styles.subtitle}>
          {getHebrewDateLabel(hdate)} · {formatRuDate(now, daily.timeZone)} · {city} ▾
        </Text>
      </View>

      <View style={styles.filterRow}>
        <HeaderButton icon="filter" />
      </View>

      <GlassCard>
        <Text style={styles.overline}>ШКАЛА ДНЯ</Text>
        <View style={styles.scaleWrap}>
          <View style={styles.scaleBar}>
            <View style={[styles.scalePart, { flex: 2, backgroundColor: 'rgba(255,190,40,0.55)' }]}>
              <Text style={styles.scaleText}>Шахарит</Text>
            </View>
            <View style={[styles.scalePart, { flex: 2, backgroundColor: 'rgba(240,100,42,0.70)' }]}>
              <Text style={styles.scaleText}>Минха</Text>
            </View>
            <View style={[styles.scalePart, { flex: 1.2, backgroundColor: 'rgba(80,100,200,0.55)' }]}>
              <Text style={styles.scaleText}>Маарив</Text>
            </View>
          </View>
          <View style={[styles.nowMarkerLabel, { left: `${Math.round(dayProgress * 100)}%` }]}>
            <Text style={styles.nowMarkerText}>{formatRuTime(now, daily.timeZone)}</Text>
          </View>
          <View style={[styles.nowMarker, { left: `${Math.round(dayProgress * 100)}%` }]} />
        </View>
        <View style={styles.zmanOverview}>
          {overview.map((item) => (
            <View key={item.t} style={styles.zmanPoint}>
              <Text style={styles.zmanEmoji}>{item.e}</Text>
              <Text style={styles.zmanTime}>{item.t}</Text>
              <Text style={styles.zmanLabel}>{item.l}</Text>
            </View>
          ))}
        </View>
      </GlassCard>

      {prayers.map((prayer) => (
        <PrayerCard
          key={prayer.id}
          accent={prayer.accent}
          active={prayer.active}
          icon={prayer.icon}
          progress={prayer.progress}
          state={now.getTime() > prayer.end.getTime() ? 'done' : 'upcoming'}
          status={prayer.hebrew}
          subtitle={prayer.subtitle}
          timeZone={daily.timeZone}
          title={prayer.title}
          windowEnd={prayer.end}
          windowStart={prayer.start}
        />
      ))}

      <View>
        <SectionTitle title="ЗМАНИМ · ТАБЛИЦА" action="Подробнее о зманим" />
        <GlassCard padded={false}>
          {daily.items.map((zman, index) => {
            const highlight = zman.id === nextZmanId;
            return (
              <View key={zman.id} style={[styles.zmanRow, index > 0 && styles.rowDivider, highlight && styles.zmanRowHighlight]}>
                <Text style={styles.zmanRowIcon}>{zman.icon}</Text>
                <Text style={[styles.zmanRowName, highlight && styles.zmanRowAccent]}>{zman.name}</Text>
                <Text style={[styles.zmanRowTime, highlight && styles.zmanRowAccent]}>{zman.time}</Text>
              </View>
            );
          })}
        </GlassCard>
      </View>

      <Pressable style={styles.infoCard}>
        <LinearGradient colors={['rgba(74,144,217,0.10)', 'rgba(74,144,217,0.04)']} style={StyleSheet.absoluteFillObject} />
        <Ionicons name="information-circle-outline" size={18} color="#4A90D9" />
        <Text style={styles.infoText}>Зманим рассчитаны через Hebcal для города {city}, часовой пояс {daily.timeZone}.</Text>
      </Pressable>
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
  cityPill: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.glass.w10,
    backgroundColor: colors.glass.w07,
    paddingHorizontal: 12,
  },
  cityText: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 14,
    textAlign: 'center',
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: colors.textDim,
    fontSize: 13,
    marginTop: 3,
  },
  filterRow: {
    alignItems: 'flex-end',
  },
  overline: {
    color: colors.textDim,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 22,
  },
  scaleWrap: {
    position: 'relative',
    marginBottom: 12,
  },
  scaleBar: {
    height: 24,
    flexDirection: 'row',
    overflow: 'hidden',
    borderRadius: 4,
    gap: 1,
  },
  scalePart: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  scaleText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 10,
    fontWeight: '700',
  },
  nowMarkerLabel: {
    position: 'absolute',
    top: -26,
    left: '50%',
    transform: [{ translateX: -22 }],
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.glass.w20,
    backgroundColor: colors.glass.w12,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  nowMarkerText: {
    color: colors.text,
    fontSize: 10,
    fontWeight: '700',
  },
  nowMarker: {
    position: 'absolute',
    top: -6,
    left: '50%',
    width: 2,
    height: 36,
    borderRadius: 1,
    backgroundColor: colors.text,
    opacity: 0.6,
  },
  zmanOverview: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  zmanPoint: {
    alignItems: 'center',
  },
  zmanEmoji: {
    fontSize: 16,
  },
  zmanTime: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  zmanLabel: {
    color: colors.textGhost,
    fontSize: 9,
  },
  prayerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  prayerIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  prayerEmoji: {
    fontSize: 22,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    flexWrap: 'wrap',
  },
  prayerName: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  prayerHebrew: {
    color: colors.textGhost,
    fontSize: 12,
    fontStyle: 'italic',
  },
  prayerSubtitle: {
    color: colors.textDim,
    fontSize: 13,
    marginTop: 2,
  },
  doneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  doneText: {
    color: colors.textDim,
    fontSize: 13,
  },
  activePrayer: {
    borderColor: 'rgba(240,100,42,0.30)',
    backgroundColor: 'rgba(240,100,42,0.08)',
  },
  nowBadge: {
    overflow: 'hidden',
    borderRadius: 5,
    backgroundColor: 'rgba(240,100,42,0.25)',
    color: colors.orange,
    fontSize: 10,
    fontWeight: '700',
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  progressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    marginBottom: 6,
  },
  tinyMuted: {
    color: colors.textGhost,
    fontSize: 11,
  },
  progressPercent: {
    color: colors.orange,
    fontSize: 11,
    fontWeight: '700',
  },
  zmanRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  rowDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.separator,
  },
  zmanRowHighlight: {
    backgroundColor: 'rgba(240,120,42,0.05)',
  },
  zmanRowIcon: {
    width: 20,
    textAlign: 'center',
    fontSize: 15,
  },
  zmanRowName: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 13,
  },
  zmanRowTime: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  zmanRowAccent: {
    color: colors.orange,
  },
  infoCard: {
    minHeight: 48,
    overflow: 'hidden',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(74,144,217,0.20)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
  },
  infoText: {
    flex: 1,
    color: colors.textDim,
    fontSize: 12,
  },
});
