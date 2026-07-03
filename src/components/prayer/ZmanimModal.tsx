import { Ionicons } from '@expo/vector-icons';
import {
  Modal,
  Platform,
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
import type { DailyZmanim } from '@/lib/zmanim';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';

const WEB_MOBILE_FRAME_MAX_WIDTH = 430;

type ZmanimModalProps = {
  city: string;
  daily: DailyZmanim;
  date: Date;
  nextZmanId?: string;
  onClose: () => void;
  visible: boolean;
};

export function ZmanimModal({
  city,
  daily,
  date,
  nextZmanId,
  onClose,
  visible,
}: ZmanimModalProps) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const panelMaxHeight = Math.max(
    320,
    Math.min(height - insets.top - insets.bottom - 36, 720),
  );
  const scrollMaxHeight = Math.max(260, panelMaxHeight);

  const formattedDate = formatRuDate(date, daily.timeZone);
  const items = daily.items;

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      transparent
      visible={visible}
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
          accessibilityLabel="Закрыть зманим"
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFillObject}
        />

        <View
          style={[
            styles.panel,
            Platform.OS === 'web' ? styles.webPanel : null,
            { maxHeight: panelMaxHeight },
          ]}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator
            style={[styles.scrollArea, { maxHeight: scrollMaxHeight }]}
          >
            <GlassCard contentStyle={styles.cardContent} style={styles.card}>
              <View style={styles.header}>
                <View style={styles.headerText}>
                  <Text style={styles.eyebrow}>Зманим</Text>
                  <Text numberOfLines={2} style={styles.title}>
                    Времена дня
                  </Text>
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
                  <Text numberOfLines={1} style={styles.metaText}>
                    {city}
                  </Text>
                </View>
                <View style={styles.metaPill}>
                  <Text numberOfLines={1} style={styles.metaText}>
                    {formattedDate}
                  </Text>
                </View>
              </View>

              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Все зманим</Text>
                <Text style={styles.sectionCount}>{items.length}</Text>
              </View>

              <View style={styles.listBox}>
                {items.map((zman, index) => {
                  const isLast = index === items.length - 1;
                  const isNext = zman.id === nextZmanId;
                  return (
                    <View
                      key={zman.id}
                      style={[
                        styles.row,
                        !isLast && styles.rowDivider,
                        isNext && styles.rowActive,
                      ]}
                    >
                      <View style={styles.rowText}>
                        <Text
                          numberOfLines={2}
                          style={[styles.rowName, isNext && styles.rowNameActive]}
                        >
                          {zman.name}
                        </Text>
                        {isNext ? (
                          <Text style={styles.rowBadge}>следующий</Text>
                        ) : null}
                      </View>
                      <Text
                        style={[styles.rowTime, isNext && styles.rowTimeActive]}
                      >
                        {zman.time}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </GlassCard>
          </ScrollView>
        </View>
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
  webPanel: {
    maxWidth: WEB_MOBILE_FRAME_MAX_WIDTH,
  },
  scrollArea: {
    borderRadius: radius.glassCard,
  },
  scrollContent: {
    paddingBottom: 2,
  },
  card: {
    borderColor: 'rgba(255,200,50,0.18)',
  },
  cardContent: {
    gap: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0,
    marginBottom: 5,
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '900',
    lineHeight: 27,
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
  pressed: {
    opacity: 0.78,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metaPill: {
    maxWidth: '100%',
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.glass.w10,
    backgroundColor: colors.glass.w06,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  metaText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 2,
  },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '900',
  },
  sectionCount: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: '800',
  },
  listBox: {
    overflow: 'hidden',
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.glass.w04,
  },
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  rowActive: {
    backgroundColor: 'rgba(255,200,50,0.07)',
    borderLeftWidth: 2,
    borderLeftColor: colors.goldAccent,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 18,
  },
  rowNameActive: {
    color: colors.text,
    fontWeight: '900',
  },
  rowBadge: {
    color: colors.goldAccent,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  rowTime: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  rowTimeActive: {
    color: colors.goldAccent,
  },
});
