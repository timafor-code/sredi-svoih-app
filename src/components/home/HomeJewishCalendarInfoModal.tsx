import { Ionicons } from '@expo/vector-icons';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassCard } from '@/components/glass/GlassCard';
import { formatRuDate } from '@/lib/dates';
import type { UpcomingHoliday } from '@/lib/hebcal';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';

type HomeJewishCalendarInfoModalProps = {
  daysUntilText?: string;
  event: UpcomingHoliday | null;
  onClose: () => void;
  timeZone: string;
  visible: boolean;
};

export function HomeJewishCalendarInfoModal({
  daysUntilText,
  event,
  onClose,
  timeZone,
  visible,
}: HomeJewishCalendarInfoModalProps) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const panelMaxHeight = Math.max(
    320,
    Math.min(height - insets.top - insets.bottom - 36, 720),
  );
  const scrollMaxHeight = Math.max(260, panelMaxHeight);
  const isVisible = visible && event !== null;
  const infoNote =
    event?.kind === 'fast'
      ? 'Информационное описание. Подробные правила уточняйте у раввина.'
      : null;

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      transparent
      visible={isVisible}
    >
      <View
        style={[
          styles.overlay,
          {
            paddingBottom: Math.max(insets.bottom + 14, 22),
            paddingTop: Math.max(insets.top + 12, 20),
          },
        ]}
      >
        <Pressable
          accessibilityLabel="Закрыть описание календарной даты"
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFillObject}
        />

        {event ? (
          <View style={[styles.panel, { maxHeight: panelMaxHeight }]}>
            <ScrollView
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator
              style={[styles.scrollArea, { maxHeight: scrollMaxHeight }]}
            >
              <GlassCard contentStyle={styles.cardContent} style={styles.card}>
                <View style={styles.header}>
                  <View style={styles.titleBlock}>
                    <Text style={styles.eyebrow}>{event.typeLabelRu}</Text>
                    <Text numberOfLines={3} style={styles.title}>
                      {event.nameRu}
                    </Text>
                    {event.nameHe ? (
                      <Text numberOfLines={2} style={styles.hebrewName}>
                        {event.nameHe}
                      </Text>
                    ) : null}
                  </View>

                  <Pressable
                    accessibilityLabel="Закрыть"
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={onClose}
                    style={({ pressed }) => [
                      styles.closeButton,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Ionicons name="close" size={20} color={colors.text} />
                  </Pressable>
                </View>

                <View style={styles.metaRow}>
                  <View style={styles.metaPill}>
                    <Ionicons name="calendar-outline" size={13} color={colors.goldAccent} />
                    <Text numberOfLines={1} style={styles.metaText}>
                      {formatRuDate(event.date, timeZone)}
                    </Text>
                  </View>
                  <View style={styles.metaPill}>
                    <Ionicons name="moon-outline" size={13} color={colors.goldAccent} />
                    <Text numberOfLines={1} style={styles.metaText}>
                      {event.hebrewDateRu}
                    </Text>
                  </View>
                  {daysUntilText ? (
                    <View style={styles.metaPill}>
                      <Ionicons name="time-outline" size={13} color={colors.goldAccent} />
                      <Text numberOfLines={1} style={styles.metaText}>
                        {daysUntilText}
                      </Text>
                    </View>
                  ) : null}
                </View>

                <View style={styles.descriptionBox}>
                  <Text style={styles.description}>{event.descriptionRu}</Text>
                </View>

                {event.observanceNoteRu ? (
                  <View style={styles.noteBox}>
                    <Ionicons name="information-circle-outline" size={16} color={colors.goldAccent} />
                    <Text style={styles.noteText}>{event.observanceNoteRu}</Text>
                  </View>
                ) : null}

                {infoNote ? <Text style={styles.footerNote}>{infoNote}</Text> : null}
              </GlassCard>
            </ScrollView>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-start',
    paddingHorizontal: 14,
    backgroundColor: 'rgba(0,0,0,0.68)',
  },
  panel: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  scrollArea: {
    borderRadius: radius.glassCard,
  },
  scrollContent: {
    paddingBottom: 2,
  },
  card: {
    borderColor: 'rgba(255,200,50,0.18)',
    backgroundColor: 'rgba(13,15,24,0.94)',
  },
  cardContent: {
    gap: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    color: colors.goldAccent,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0,
    marginBottom: 5,
  },
  title: {
    color: colors.text,
    fontSize: 23,
    fontWeight: '900',
    lineHeight: 28,
  },
  hebrewName: {
    color: colors.textGhost,
    fontSize: 15,
    fontStyle: 'italic',
    fontWeight: '700',
    lineHeight: 21,
    marginTop: 4,
    textAlign: 'left',
    writingDirection: 'rtl',
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.glass.w08,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metaPill: {
    maxWidth: '100%',
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(255,200,50,0.16)',
    backgroundColor: 'rgba(255,200,50,0.06)',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  metaText: {
    flexShrink: 1,
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 16,
  },
  descriptionBox: {
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.glass.w04,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  description: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 23,
  },
  noteBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,200,50,0.14)',
    backgroundColor: 'rgba(255,200,50,0.06)',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  noteText: {
    flex: 1,
    minWidth: 0,
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 18,
  },
  footerNote: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 16,
  },
  pressed: {
    opacity: 0.78,
  },
});
