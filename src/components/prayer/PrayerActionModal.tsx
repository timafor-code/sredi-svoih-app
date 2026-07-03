import { useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { useAuthStore } from '@/store/useAuthStore';
import { usePrayerTrackerStore } from '@/store/usePrayerTrackerStore';
import { colors } from '@/theme/colors';
import type {
  HebrewDatePayload,
  PrayerActivityLog,
  PrayerActivityMetadata,
  PrayerActivityType,
} from '@/types/prayerTracker';

const WEB_MOBILE_FRAME_MAX_WIDTH = 430;

const AUTH_ALERT_TITLE = 'Нужен вход';
const AUTH_ALERT_MESSAGE = 'Чтобы вести молитвенный трекер, войдите в приложение.';

export type PrayerActionDetail = {
  label: string;
  value?: string | null;
};

type PrayerActionModalProps = {
  activityType: PrayerActivityType;
  alreadyRecorded?: boolean;
  alreadyRecordedLabel?: string;
  canRecord?: () => boolean;
  city?: string | null;
  closeOnSuccess?: boolean;
  completedAt?: Date | string | null;
  confirmButtonTitle?: string;
  description?: string;
  details?: PrayerActionDetail[];
  hebrewDate?: HebrewDatePayload;
  loading?: boolean;
  metadata?: PrayerActivityMetadata;
  onClose: () => void;
  onRecorded?: (activity: PrayerActivityLog) => void;
  startedAt?: Date | string | null;
  subtitle?: string;
  timezone?: string;
  title: string;
  unavailableMessage?: string;
  unavailableTitle?: string;
  visible: boolean;
};

function getSuccessMessage(activityType: PrayerActivityType): string {
  switch (activityType) {
    case 'shema_morning':
    case 'shema_evening':
      return 'Чтение Шма сохранено.';
    case 'omer_count':
      return 'Счёт Омера сохранён.';
    case 'shacharit':
    case 'mincha':
    case 'maariv':
    default:
      return 'Начало молитвы сохранено.';
  }
}

function getDefaultRecordedLabel(activityType: PrayerActivityType): string {
  switch (activityType) {
    case 'shema_morning':
    case 'shema_evening':
      return 'Прочитал';
    case 'omer_count':
      return 'Посчитал';
    case 'shacharit':
    case 'mincha':
    case 'maariv':
    default:
      return 'Помолился';
  }
}

function isPrayerTrackerAuthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const lowerMessage = message.toLowerCase();

  return (
    lowerMessage.includes('auth required')
    || lowerMessage.includes('auth session missing')
    || message.includes(AUTH_ALERT_TITLE)
    || message.includes(AUTH_ALERT_MESSAGE)
  );
}

function showAuthAlert() {
  Alert.alert(AUTH_ALERT_TITLE, AUTH_ALERT_MESSAGE);
}

function showRecordError(error: unknown) {
  if (isPrayerTrackerAuthError(error)) {
    showAuthAlert();
    return;
  }

  Alert.alert(
    'Не удалось записать',
    'Проверьте подключение и попробуйте ещё раз.',
  );
}

export function PrayerActionModal({
  activityType,
  alreadyRecorded = false,
  alreadyRecordedLabel,
  canRecord,
  city,
  closeOnSuccess = true,
  completedAt,
  confirmButtonTitle = 'Записать',
  description,
  details,
  hebrewDate,
  loading = false,
  metadata,
  onClose,
  onRecorded,
  startedAt,
  subtitle,
  timezone,
  title,
  unavailableMessage = 'Это действие сейчас недоступно.',
  unavailableTitle = 'Сейчас недоступно',
  visible,
}: PrayerActionModalProps) {
  const authUser = useAuthStore((state) => state.user);
  const recordActivity = usePrayerTrackerStore((state) => state.recordActivity);
  const recording = usePrayerTrackerStore((state) => state.recording);
  const busy = loading || recording;
  const recordedLabel = alreadyRecordedLabel ?? getDefaultRecordedLabel(activityType);
  const visibleDetails = useMemo(
    () =>
      (details ?? []).filter(
        (detail) =>
          typeof detail.value === 'string'
          && detail.value.trim().length > 0,
      ),
    [details],
  );

  const handleConfirm = async () => {
    if (busy || alreadyRecorded) {
      return;
    }

    if (canRecord && !canRecord()) {
      Alert.alert(unavailableTitle, unavailableMessage);
      return;
    }

    if (!authUser) {
      showAuthAlert();
      return;
    }

    try {
      const activity = await recordActivity({
        activityType,
        city,
        completedAt,
        hebrewDate,
        metadata,
        startedAt: startedAt ?? new Date(),
        timezone,
      });

      Alert.alert('Записано', getSuccessMessage(activityType), [
        {
          text: 'OK',
          onPress: () => {
            onRecorded?.(activity);
            if (closeOnSuccess) {
              onClose();
            }
          },
        },
      ]);
    } catch (error) {
      showRecordError(error);
    }
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      transparent
      visible={visible}
    >
      <View style={styles.overlay}>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onClose}
          style={StyleSheet.absoluteFillObject}
        />
        <GlassCard
          style={[
            styles.card,
            Platform.OS === 'web' ? styles.webCard : null,
          ]}
        >
          <View style={styles.header}>
            <View style={styles.titleBlock}>
              <Text style={styles.title}>{title}</Text>
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={onClose}
              style={({ pressed }) => [
                styles.closeButton,
                pressed && !busy && styles.pressed,
                busy && styles.disabled,
              ]}
            >
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>

          {description ? <Text style={styles.description}>{description}</Text> : null}

          {visibleDetails.length > 0 ? (
            <View style={styles.details}>
              {visibleDetails.map((detail) => (
                <View key={`${detail.label}-${detail.value}`} style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{detail.label}</Text>
                  <Text style={styles.detailValue}>{detail.value}</Text>
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={onClose}
              style={({ pressed }) => [
                styles.cancelButton,
                pressed && !busy && styles.pressed,
                busy && styles.disabled,
              ]}
            >
              <Text style={styles.cancelText}>Отмена</Text>
            </Pressable>
            {alreadyRecorded ? (
              <View style={[styles.recordedButton, styles.confirmPressable]}>
                <Text style={styles.recordedText}>{recordedLabel}</Text>
              </View>
            ) : (
              <PrimaryButton
                disabled={busy}
                onPress={handleConfirm}
                title={busy ? 'Записываем...' : confirmButtonTitle}
                buttonStyle={styles.confirmButton}
                style={styles.confirmPressable}
              />
            )}
          </View>

          {busy ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={colors.orange} size="small" />
              <Text style={styles.loadingText}>Сохраняем в трекер...</Text>
            </View>
          ) : null}
        </GlassCard>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    padding: 18,
    backgroundColor: 'rgba(0,0,0,0.62)',
  },
  card: {
    borderColor: colors.borderStrong,
    backgroundColor: 'rgba(18,20,31,0.92)',
  },
  webCard: {
    width: '100%',
    maxWidth: WEB_MOBILE_FRAME_MAX_WIDTH,
    alignSelf: 'center',
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
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0,
  },
  subtitle: {
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass.w10,
  },
  closeText: {
    color: colors.text,
    fontSize: 25,
    lineHeight: 28,
  },
  description: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 14,
  },
  details: {
    gap: 10,
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.separator,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  detailLabel: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  detailValue: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'right',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 18,
  },
  cancelButton: {
    minHeight: 40,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.glass.w12,
    backgroundColor: colors.glass.w06,
    paddingHorizontal: 12,
  },
  cancelText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '700',
  },
  confirmPressable: {
    flex: 1.35,
  },
  confirmButton: {
    minHeight: 40,
    paddingHorizontal: 12,
  },
  recordedButton: {
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(76,175,80,0.24)',
    backgroundColor: 'rgba(76,175,80,0.10)',
    paddingHorizontal: 12,
  },
  recordedText: {
    color: colors.success,
    fontSize: 14,
    fontWeight: '800',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
  },
  loadingText: {
    color: colors.textDim,
    fontSize: 12,
  },
  pressed: {
    opacity: 0.82,
  },
  disabled: {
    opacity: 0.55,
  },
});
