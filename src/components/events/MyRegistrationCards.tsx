import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import {
  formatGroupStatusSummary,
  formatRegistrationCount,
  getRegistrationEndsAt,
  getRegistrationSessionTitle,
  getRegistrationStartsAt,
  getRegistrationTimezone,
  hasRegistrationPassed,
  INACTIVE_EVENT_REGISTRATION_STATUSES,
  isActiveRegistrationStatus,
  type MyRegistrationGroup,
} from '@/lib/registrationGroups';
import { colors } from '@/theme/colors';
import type { Event, EventRegistration, EventRegistrationStatus } from '@/types/event';

export const registrationStatusTitles: Record<EventRegistrationStatus, string> = {
  confirmed: 'Подтверждено',
  pending: 'Ожидает подтверждения',
  waitlisted: 'В листе ожидания',
  cancelled: 'Запись отменена',
  rejected: 'Заявка отклонена',
  attended: 'Посещение отмечено',
  no_show: 'Не посетили',
};

const statusTones: Record<EventRegistrationStatus, {
  backgroundColor: string;
  borderColor: string;
  color: string;
}> = {
  confirmed: {
    backgroundColor: colors.accent.greenBg,
    borderColor: colors.accent.greenBorder,
    color: colors.success,
  },
  pending: {
    backgroundColor: colors.accent.goldBg,
    borderColor: colors.accent.goldBorder,
    color: colors.warning,
  },
  waitlisted: {
    backgroundColor: colors.accent.blueBg,
    borderColor: colors.accent.blueBorder,
    color: colors.blueSoft,
  },
  cancelled: {
    backgroundColor: colors.glass.w06,
    borderColor: colors.glass.w12,
    color: colors.textDim,
  },
  rejected: {
    backgroundColor: colors.accent.redBg,
    borderColor: colors.accent.redBorder,
    color: colors.danger,
  },
  attended: {
    backgroundColor: colors.accent.greenBg,
    borderColor: colors.accent.greenBorder,
    color: colors.success,
  },
  no_show: {
    backgroundColor: colors.glass.w06,
    borderColor: colors.glass.w12,
    color: colors.textDim,
  },
};

type Tone = 'default' | 'danger' | 'success' | 'warning';

function formatDate(
  value: string,
  timeZone?: string | null,
  includeYear = false,
): string {
  const options: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  };

  if (includeYear) {
    options.year = 'numeric';
  }

  if (timeZone) {
    options.timeZone = timeZone;
  }

  try {
    return new Intl.DateTimeFormat('ru-RU', options).format(new Date(value));
  } catch {
    delete options.timeZone;
    return new Intl.DateTimeFormat('ru-RU', options).format(new Date(value));
  }
}

function formatTime(value: string, timeZone?: string | null): string {
  const options: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
  };

  if (timeZone) {
    options.timeZone = timeZone;
  }

  try {
    return new Intl.DateTimeFormat('ru-RU', options).format(new Date(value));
  } catch {
    delete options.timeZone;
    return new Intl.DateTimeFormat('ru-RU', options).format(new Date(value));
  }
}

function formatShortDateTime(value: string, timeZone?: string | null): string {
  const options: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  };

  if (timeZone) {
    options.timeZone = timeZone;
  }

  try {
    return new Intl.DateTimeFormat('ru-RU', options).format(new Date(value));
  } catch {
    delete options.timeZone;
    return new Intl.DateTimeFormat('ru-RU', options).format(new Date(value));
  }
}

function isSameCalendarDay(first: string, second: string, timeZone?: string | null): boolean {
  const options: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  };

  if (timeZone) {
    options.timeZone = timeZone;
  }

  try {
    const formatter = new Intl.DateTimeFormat('ru-RU', options);

    return formatter.format(new Date(first)) === formatter.format(new Date(second));
  } catch {
    delete options.timeZone;
    const formatter = new Intl.DateTimeFormat('ru-RU', options);

    return formatter.format(new Date(first)) === formatter.format(new Date(second));
  }
}

export function formatMoney(amount: number | null | undefined, currency: string | null | undefined): string | null {
  if (amount === null || amount === undefined) {
    return null;
  }

  const rounded = Math.max(0, Math.round(amount));
  const formatted = rounded.toLocaleString('ru-RU').replace(/\u00A0/g, ' ');
  const normalizedCurrency = (currency ?? 'RUB').toUpperCase();

  return normalizedCurrency === 'RUB'
    ? `${formatted} ₽`
    : `${formatted} ${normalizedCurrency}`;
}

export function formatRegistrationSession(registration: EventRegistration): string {
  const startsAt = getRegistrationStartsAt(registration);
  const timezone = getRegistrationTimezone(registration);

  if (!startsAt) {
    return formatDate(registration.registeredAt, timezone, true);
  }

  const start = formatDate(startsAt, timezone);
  const endsAt = getRegistrationEndsAt(registration);

  if (!endsAt) {
    return start;
  }

  const end = isSameCalendarDay(startsAt, endsAt, timezone)
    ? formatTime(endsAt, timezone)
    : formatDate(endsAt, timezone);

  return `${start} - ${end}`;
}

export function formatNearestRegistrationDate(registration: EventRegistration | null): string | null {
  if (!registration) {
    return null;
  }

  const startsAt = getRegistrationStartsAt(registration);

  return startsAt ? formatShortDateTime(startsAt, getRegistrationTimezone(registration)) : null;
}

function getPlace(event: Event | undefined): string | null {
  if (event?.locationName && event.address) {
    return `${event.locationName}, ${event.address}`;
  }

  return event?.locationName ?? event?.address ?? null;
}

function getEventMeta(event: Event | undefined): string | null {
  return event?.subtitle ?? event?.category ?? null;
}

function isSimulatedPayment(registration: EventRegistration): boolean {
  return registration.paymentId?.startsWith('simulated:') ?? false;
}

function getPaymentStatusTone(registration: EventRegistration): Tone {
  if (isSimulatedPayment(registration)) {
    return 'warning';
  }

  switch (registration.paymentStatus?.toLowerCase()) {
    case 'paid':
    case 'succeeded':
      return 'success';
    case 'failed':
    case 'cancelled':
      return 'danger';
    case 'pending':
    case 'requires_payment_method':
    case 'requires_confirmation':
      return 'warning';
    default:
      return 'default';
  }
}

export function getPaymentStatusTitle(registration: EventRegistration): string | null {
  if (isSimulatedPayment(registration)) {
    return 'Тестовая оплата';
  }

  switch (registration.paymentStatus?.toLowerCase()) {
    case 'paid':
    case 'succeeded':
      return 'Оплачено';
    case 'pending':
    case 'requires_payment_method':
    case 'requires_confirmation':
      return 'Ожидает оплаты';
    case 'failed':
      return 'Ошибка оплаты';
    case 'cancelled':
      return 'Оплата отменена';
    default:
      return registration.paymentStatus ? registration.paymentStatus : null;
  }
}

function formatGuestNames(guestNames: unknown[]): string | null {
  const guests = guestNames
    .map((guestName) => String(guestName).trim())
    .filter(Boolean);

  return guests.length > 0 ? guests.join(', ') : null;
}

function formatSelectedOptionsSummary(registration: EventRegistration): string | null {
  const firstOption = registration.selectedOptions[0];

  if (!firstOption) {
    return null;
  }

  const extraCount = registration.selectedOptions.length - 1;
  const firstOptionText = `${firstOption.title} × ${firstOption.quantity}`;

  return extraCount > 0 ? `${firstOptionText} · еще ${extraCount}` : firstOptionText;
}

function Chip({ children, tone = 'default' }: { children: string; tone?: Tone }) {
  const toneStyle = {
    default: styles.chipDefault,
    danger: styles.chipDanger,
    success: styles.chipSuccess,
    warning: styles.chipWarning,
  }[tone];

  return (
    <View style={[styles.chip, toneStyle]}>
      <Text style={styles.chipText}>{children}</Text>
    </View>
  );
}

export function RegistrationStatusBadge({ status }: { status: EventRegistrationStatus }) {
  const tone = statusTones[status];

  return (
    <View
      style={[
        styles.statusPill,
        {
          backgroundColor: tone.backgroundColor,
          borderColor: tone.borderColor,
        },
      ]}
    >
      <Text style={[styles.statusText, { color: tone.color }]}>
        {registrationStatusTitles[status]}
      </Text>
    </View>
  );
}

function PaymentBadge({ registration }: { registration: EventRegistration }) {
  const paymentTitle = getPaymentStatusTitle(registration);

  if (!paymentTitle) {
    return null;
  }

  return <Chip tone={getPaymentStatusTone(registration)}>{paymentTitle}</Chip>;
}

function RegistrationThumbnail({ event }: { event: Event | undefined }) {
  const [imageFailed, setImageFailed] = useState(false);
  const showThumbnail = Boolean(event?.imageUrl && !imageFailed);

  useEffect(() => {
    setImageFailed(false);
  }, [event?.imageUrl]);

  if (!showThumbnail) {
    return (
      <View style={styles.thumbnailPlaceholder}>
        <Ionicons name="calendar-outline" size={22} color={colors.textDim} />
      </View>
    );
  }

  return (
    <Image
      source={{ uri: event?.imageUrl ?? '' }}
      resizeMode="cover"
      style={styles.thumbnail}
      onError={() => setImageFailed(true)}
    />
  );
}

type RegistrationGroupCardProps = {
  cancellingRegistrationId: string | null;
  group: MyRegistrationGroup;
  muted?: boolean;
  onCancel: (registration: EventRegistration) => void;
  onOpen: (group: MyRegistrationGroup) => void;
  showCancelAction?: boolean;
};

export function RegistrationGroupCard({
  cancellingRegistrationId,
  group,
  muted = false,
  onCancel,
  onOpen,
  showCancelAction = true,
}: RegistrationGroupCardProps) {
  const event = group.event;
  const isSingle = group.totalRegistrationsCount === 1;
  const registration = group.registrations[0] ?? null;
  const canCancel = Boolean(
    showCancelAction
      && isSingle
      && registration
      && isActiveRegistrationStatus(registration.status)
      && !hasRegistrationPassed(registration),
  );
  const statusSummary = formatGroupStatusSummary(group.statusesSummary);
  const nearestDate = formatNearestRegistrationDate(group.nextRegistration);
  const amount = formatMoney(group.totalAmount, group.totalCurrency);

  if (!registration) {
    return null;
  }

  return (
    <GlassCard style={muted || group.activeRegistrationsCount === 0 ? styles.inactiveCard : undefined}>
      <Pressable
        onPress={() => onOpen(group)}
        style={({ pressed }) => [pressed && styles.pressed]}
      >
        <View style={styles.cardTopRow}>
          <RegistrationThumbnail event={event} />
          <View style={styles.cardTitleBlock}>
            <View style={styles.cardTitleRow}>
              <Text style={styles.cardTitle}>{event?.title ?? 'Событие'}</Text>
              <Ionicons name="chevron-forward" size={17} color="rgba(255,255,255,0.32)" />
            </View>
            {isSingle ? (
              <View style={styles.badgeRow}>
                <RegistrationStatusBadge status={registration.status} />
                <PaymentBadge registration={registration} />
              </View>
            ) : (
              <View style={styles.badgeRow}>
                <Chip tone="success">{formatRegistrationCount(group.totalRegistrationsCount)}</Chip>
                {statusSummary ? <Chip>{statusSummary}</Chip> : null}
              </View>
            )}
          </View>
        </View>

        <View style={styles.metaBlock}>
          {getEventMeta(event) ? (
            <View style={styles.metaRow}>
              <Ionicons name="bookmark-outline" size={15} color={colors.textDim} />
              <Text style={styles.metaText}>{getEventMeta(event)}</Text>
            </View>
          ) : null}
          <View style={styles.metaRow}>
            <Ionicons name="calendar-outline" size={15} color={colors.textDim} />
            <Text style={styles.metaText}>
              {isSingle
                ? formatRegistrationSession(registration)
                : nearestDate
                  ? `Ближайшая: ${nearestDate}`
                  : 'Дата уточняется'}
            </Text>
          </View>
          {isSingle && formatSelectedOptionsSummary(registration) ? (
            <View style={styles.metaRow}>
              <Ionicons name="ticket-outline" size={15} color={colors.textDim} />
              <Text style={styles.metaText}>
                Вариант: {formatSelectedOptionsSummary(registration)}
              </Text>
            </View>
          ) : null}
          {amount ? (
            <View style={styles.metaRow}>
              <Ionicons name="receipt-outline" size={15} color={colors.textDim} />
              <Text style={styles.metaText}>Итого: {amount}</Text>
            </View>
          ) : null}
          {isSingle && getPlace(event) ? (
            <View style={styles.metaRow}>
              <Ionicons name="location-outline" size={15} color={colors.textDim} />
              <Text style={styles.metaText}>{getPlace(event)}</Text>
            </View>
          ) : null}
        </View>
      </Pressable>

      {canCancel ? (
        <CancelRegistrationButton
          cancelling={cancellingRegistrationId === registration.id}
          onPress={() => onCancel(registration)}
        />
      ) : null}
    </GlassCard>
  );
}

function DetailRow({
  icon,
  text,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}) {
  return (
    <View style={styles.detailRow}>
      <Ionicons name={icon} size={15} color={colors.textDim} />
      <Text style={styles.detailText}>{text}</Text>
    </View>
  );
}

type RegistrationDetailCardProps = {
  cancelling: boolean;
  onCancel: (registration: EventRegistration) => void;
  registration: EventRegistration;
  showCancelAction?: boolean;
};

export function RegistrationDetailCard({
  cancelling,
  onCancel,
  registration,
  showCancelAction = true,
}: RegistrationDetailCardProps) {
  const sessionTitle = getRegistrationSessionTitle(registration);
  const amount = formatMoney(registration.totalAmount, registration.totalCurrency);
  const paymentTitle = getPaymentStatusTitle(registration);
  const guestNames = formatGuestNames(registration.guestNames);
  const canCancel = showCancelAction
    && isActiveRegistrationStatus(registration.status)
    && !hasRegistrationPassed(registration);
  const isInactive = INACTIVE_EVENT_REGISTRATION_STATUSES.has(registration.status);

  return (
    <GlassCard style={isInactive ? styles.inactiveCard : undefined}>
      <View style={styles.detailHeader}>
        <View style={styles.sessionIcon}>
          <Ionicons name="calendar-outline" size={18} color={colors.orange} />
        </View>
        <View style={styles.detailTitleBlock}>
          <Text style={styles.detailTitle}>{formatRegistrationSession(registration)}</Text>
          {sessionTitle ? <Text style={styles.detailSubtitle}>{sessionTitle}</Text> : null}
        </View>
      </View>

      <View style={styles.badgeRow}>
        <RegistrationStatusBadge status={registration.status} />
        <PaymentBadge registration={registration} />
      </View>

      <View style={styles.detailBlock}>
        <DetailRow icon="people-outline" text={`Мест: ${registration.seatsCount}`} />

        {registration.selectedOptions.length > 0 ? (
          <View style={styles.optionsBlock}>
            {registration.selectedOptions.map((option, index) => {
              const optionAmount = formatMoney(option.totalAmount, option.currency);

              return (
                <View key={`${option.id}-${index}`} style={styles.optionLine}>
                  <Text style={styles.optionText}>
                    {option.title} × {option.quantity}
                  </Text>
                  {optionAmount ? <Text style={styles.optionAmount}>{optionAmount}</Text> : null}
                </View>
              );
            })}
          </View>
        ) : null}

        {amount ? <DetailRow icon="receipt-outline" text={`Итого: ${amount}`} /> : null}
        {paymentTitle ? <DetailRow icon="card-outline" text={`Оплата: ${paymentTitle}`} /> : null}
        {guestNames ? <DetailRow icon="person-add-outline" text={`Гости: ${guestNames}`} /> : null}
        {registration.comment ? <DetailRow icon="chatbubble-ellipses-outline" text={registration.comment} /> : null}
        <DetailRow
          icon="time-outline"
          text={`Запись создана: ${formatDate(registration.registeredAt, getRegistrationTimezone(registration), true)}`}
        />
      </View>

      {canCancel ? (
        <CancelRegistrationButton
          cancelling={cancelling}
          onPress={() => onCancel(registration)}
        />
      ) : null}
    </GlassCard>
  );
}

function CancelRegistrationButton({
  cancelling,
  onPress,
}: {
  cancelling: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      disabled={cancelling}
      onPress={onPress}
      style={({ pressed }) => [
        styles.cancelButton,
        cancelling && styles.cancelButtonDisabled,
        pressed && !cancelling && styles.cancelButtonPressed,
      ]}
    >
      <Text style={styles.cancelButtonText}>
        {cancelling ? 'Отменяем...' : 'Отменить запись'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  thumbnail: {
    width: 72,
    height: 72,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  thumbnailPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass.w08,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitleBlock: {
    flex: 1,
    minWidth: 0,
    gap: 9,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  cardTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 23,
  },
  inactiveCard: {
    opacity: 0.72,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  chip: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  chipDefault: {
    backgroundColor: colors.glass.w08,
    borderColor: colors.glass.w16,
  },
  chipDanger: {
    backgroundColor: colors.accent.redBg,
    borderColor: colors.accent.redBorder,
  },
  chipSuccess: {
    backgroundColor: colors.accent.greenBg,
    borderColor: colors.accent.greenBorder,
  },
  chipWarning: {
    backgroundColor: colors.accent.goldBg,
    borderColor: colors.accent.goldBorder,
  },
  chipText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    includeFontPadding: false,
  },
  statusPill: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
    includeFontPadding: false,
  },
  metaBlock: {
    gap: 8,
    marginTop: 14,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
  },
  metaText: {
    flex: 1,
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 18,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  sessionIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent.orangeBg,
    borderWidth: 1,
    borderColor: colors.accent.orangeBorder,
  },
  detailTitleBlock: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  detailTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 21,
  },
  detailSubtitle: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  detailBlock: {
    gap: 10,
    marginTop: 14,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  detailText: {
    flex: 1,
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 18,
  },
  optionsBlock: {
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.glass.w06,
    padding: 12,
  },
  optionLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  optionText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  optionAmount: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  cancelButton: {
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.accent.redBorder,
    backgroundColor: colors.accent.redBg,
    marginTop: 16,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  cancelButtonPressed: {
    opacity: 0.78,
  },
  cancelButtonDisabled: {
    opacity: 0.55,
  },
  cancelButtonText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.78,
  },
});
