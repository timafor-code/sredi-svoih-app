import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { selectNextFutureOccurrence } from '@/lib/eventTime';
import {
  getNearestOccurrence,
  getRegistrationWindowInfo,
  getUnavailableRegistrationText,
  isRegistrationWindowOpen,
  isOccurrenceAlwaysOpen,
  shouldRequireOccurrenceChoice,
  type RegistrationWindowInfo,
} from '@/lib/registrationWindow';
import { listEventOccurrences } from '@/services/eventOccurrencesService';
import { listEventParticipationOptions } from '@/services/participationOptionsService';
import { useAuthStore } from '@/store/useAuthStore';
import {
  findActiveRegistrationForTarget,
  useEventsStore,
} from '@/store/useEventsStore';
import { colors } from '@/theme/colors';
import type { EventItem } from '@/types/event';
import type { EventOccurrence } from '@/types/eventOccurrence';
import type { EventParticipationOption } from '@/types/participationOption';

type Quantities = Record<string, number>;

const paymentSimulationTitle = 'Тестовая оплата';
const paymentSimulationText = 'Это тестовая имитация оплаты. Реальный платёжный сервис пока не подключён.';
const paymentSimulationSuccessText = 'Запись создана. Оплата отмечена как тестовая.';

const optionTypeLabels: Record<string, string> = {
  participation: 'Участие',
  meal: 'Трапеза',
  package: 'Пакет',
  donation: 'Пожертвование',
  child: 'Детский',
  family: 'Семейный',
  other: 'Другое',
};

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function formatDate(value: string, timeZone?: string | null): string {
  const options: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
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

function formatOccurrence(occurrence: EventOccurrence): string {
  const start = `${formatDate(occurrence.startsAt, occurrence.timezone)}, ${formatTime(
    occurrence.startsAt,
    occurrence.timezone,
  )}`;

  if (!occurrence.endsAt) {
    return start;
  }

  const end = isSameCalendarDay(occurrence.startsAt, occurrence.endsAt, occurrence.timezone)
    ? formatTime(occurrence.endsAt, occurrence.timezone)
    : `${formatDate(occurrence.endsAt, occurrence.timezone)}, ${formatTime(
      occurrence.endsAt,
      occurrence.timezone,
    )}`;

  return `${start} - ${end}`;
}

function formatOccurrenceTimeRange(occurrence: EventOccurrence): string {
  const start = formatTime(occurrence.startsAt, occurrence.timezone);

  if (!occurrence.endsAt) {
    return start;
  }

  const end = isSameCalendarDay(occurrence.startsAt, occurrence.endsAt, occurrence.timezone)
    ? formatTime(occurrence.endsAt, occurrence.timezone)
    : `${formatDate(occurrence.endsAt, occurrence.timezone)}, ${formatTime(
      occurrence.endsAt,
      occurrence.timezone,
    )}`;

  return `${start} - ${end}`;
}

function getRegistrationWindowActionTitle(info: RegistrationWindowInfo): string {
  switch (info.state) {
    case 'closed':
      return 'Регистрация закрыта';
    case 'not_yet_open':
      return info.label;
    case 'no_window':
      return 'Регистрация сейчас недоступна';
    case 'open':
    default:
      return 'Продолжить';
  }
}

function getRegistrationWindowHint(
  info: RegistrationWindowInfo,
  occurrences: EventOccurrence[],
): string {
  switch (info.state) {
    case 'closed':
      return 'Запись на ближайший сеанс закрыта.';
    case 'not_yet_open':
      return `Запись ${info.label.toLocaleLowerCase('ru-RU')}.`;
    case 'no_window':
      return occurrences.length > 0
        ? getUnavailableRegistrationText(occurrences)
        : 'Регистрация сейчас недоступна.';
    case 'open':
    default:
      return 'Регистрация открыта.';
  }
}

function getOccurrenceRegistrationLabel(
  occurrence: EventOccurrence,
  info: RegistrationWindowInfo,
): string {
  switch (info.state) {
    case 'closed':
      return 'Регистрация закрыта';
    case 'not_yet_open':
      return `Запись ${info.label.toLocaleLowerCase('ru-RU')}`;
    case 'no_window':
      return 'Регистрация сейчас недоступна';
    case 'open':
    default:
      return isOccurrenceAlwaysOpen(occurrence)
        ? 'Регистрация открыта всегда'
        : 'Регистрация открыта';
  }
}

function formatMoney(amount: number, currency: string | null | undefined): string {
  const rounded = Math.max(0, Math.round(amount));
  const formatted = rounded.toLocaleString('ru-RU').replace(/\u00A0/g, ' ');
  const normalizedCurrency = (currency ?? 'RUB').toUpperCase();

  return normalizedCurrency === 'RUB' ? `${formatted} ₽` : `${formatted} ${normalizedCurrency}`;
}

function clampQuantity(option: EventParticipationOption, value: number): number {
  if (!option.allowQuantity) {
    return 1;
  }

  const min = Math.max(1, option.minQuantity || 1);
  const max = Math.max(min, option.maxQuantity || min);

  return Math.min(max, Math.max(min, value));
}

function getOptionQuantity(option: EventParticipationOption, quantities: Quantities): number {
  return clampQuantity(option, quantities[option.id] ?? option.minQuantity ?? 1);
}

function optionsConflict(
  first: EventParticipationOption,
  second: EventParticipationOption,
): boolean {
  return first.conflictsWith.includes(second.id) || second.conflictsWith.includes(first.id);
}

type ChipProps = {
  children: string;
  tone?: 'default' | 'warning';
};

function Chip({ children, tone = 'default' }: ChipProps) {
  return (
    <View style={[styles.chip, tone === 'warning' && styles.chipWarning]}>
      <Text style={styles.chipText}>{children}</Text>
    </View>
  );
}

type QuantityStepperProps = {
  option: EventParticipationOption;
  quantity: number;
  onDecrease: () => void;
  onIncrease: () => void;
};

function QuantityStepper({
  onDecrease,
  onIncrease,
  option,
  quantity,
}: QuantityStepperProps) {
  const min = option.allowQuantity ? Math.max(1, option.minQuantity || 1) : 1;
  const max = option.allowQuantity ? Math.max(min, option.maxQuantity || min) : 1;
  const decreaseDisabled = quantity <= min;
  const increaseDisabled = quantity >= max;

  return (
    <View style={styles.stepper}>
      <Pressable
        disabled={decreaseDisabled}
        onPress={onDecrease}
        style={({ pressed }) => [
          styles.stepperButton,
          decreaseDisabled && styles.stepperButtonDisabled,
          pressed && !decreaseDisabled && styles.pressed,
        ]}
      >
        <Ionicons name="remove" size={16} color={colors.text} />
      </Pressable>
      <Text style={styles.stepperValue}>{quantity}</Text>
      <Pressable
        disabled={increaseDisabled}
        onPress={onIncrease}
        style={({ pressed }) => [
          styles.stepperButton,
          increaseDisabled && styles.stepperButtonDisabled,
          pressed && !increaseDisabled && styles.pressed,
        ]}
      >
        <Ionicons name="add" size={16} color={colors.text} />
      </Pressable>
    </View>
  );
}

type OccurrenceCardProps = {
  occurrence: EventOccurrence;
  selected: boolean;
  disabled: boolean;
  windowInfo: RegistrationWindowInfo;
  onPress: () => void;
};

function OccurrenceCard({
  disabled,
  occurrence,
  onPress,
  selected,
  windowInfo,
}: OccurrenceCardProps) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.occurrenceCard,
        selected && styles.occurrenceCardSelected,
        disabled && styles.occurrenceCardDisabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <View style={styles.occurrenceTextBlock}>
        <Text style={styles.occurrenceDate}>
          {formatDate(occurrence.startsAt, occurrence.timezone)}
        </Text>
        <Text style={styles.occurrenceTime}>{formatOccurrenceTimeRange(occurrence)}</Text>
        {occurrence.title ? (
          <Text style={styles.occurrenceTitle}>{occurrence.title}</Text>
        ) : null}
        <Text
          style={[
            styles.occurrenceStatus,
            disabled && styles.occurrenceStatusDisabled,
          ]}
        >
          {getOccurrenceRegistrationLabel(occurrence, windowInfo)}
        </Text>
      </View>
      <View
        style={[
          styles.occurrenceRadio,
          selected && styles.occurrenceRadioSelected,
          disabled && styles.occurrenceRadioDisabled,
        ]}
      >
        {selected ? <Ionicons name="checkmark" size={15} color={colors.text} /> : null}
      </View>
    </Pressable>
  );
}

type OptionCardProps = {
  option: EventParticipationOption;
  quantity: number;
  selected: boolean;
  onDecrease: () => void;
  onIncrease: () => void;
  onPress: () => void;
};

function OptionCard({
  onDecrease,
  onIncrease,
  onPress,
  option,
  quantity,
  selected,
}: OptionCardProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.optionCard,
        selected && styles.optionCardSelected,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.optionTopRow}>
        <View style={styles.optionTitleBlock}>
          <View style={styles.optionMetaRow}>
            <Chip tone={option.isDonation ? 'warning' : 'default'}>
              {optionTypeLabels[option.optionType] ?? option.optionType}
            </Chip>
            {!option.countsTowardCapacity || option.isDonation ? (
              <Text style={styles.optionHint}>Не занимает место</Text>
            ) : null}
          </View>
          <Text style={styles.optionTitle}>{option.title}</Text>
          {option.description ? (
            <Text style={styles.optionDescription}>{option.description}</Text>
          ) : null}
        </View>
        <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
          {selected ? <Ionicons name="checkmark" size={15} color={colors.text} /> : null}
        </View>
      </View>

      <View style={styles.optionFooter}>
        <Text style={styles.optionPrice}>
          {formatMoney(option.priceAmount, option.priceCurrency)}
        </Text>
        {selected ? (
          <QuantityStepper
            option={option}
            quantity={quantity}
            onDecrease={onDecrease}
            onIncrease={onIncrease}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

export default function EventRegistrationScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const eventId = firstParam(params.id);
  const authUser = useAuthStore((state) => state.user);
  const loadEventById = useEventsStore((state) => state.loadEventById);
  const loadMyRegistrations = useEventsStore((state) => state.loadMyRegistrations);
  const myRegistrations = useEventsStore((state) => state.myRegistrations);
  const registerForPaidEventSimulated = useEventsStore(
    (state) => state.registerForPaidEventSimulated,
  );
  const [event, setEvent] = useState<EventItem | null>(null);
  const [occurrences, setOccurrences] = useState<EventOccurrence[]>([]);
  const [options, setOptions] = useState<EventParticipationOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedOccurrenceId, setSelectedOccurrenceId] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<Quantities>({});
  const [imageFailed, setImageFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!eventId) {
      setEvent(null);
      setOccurrences([]);
      setOptions([]);
      setSelectedIds([]);
      setSelectedOccurrenceId(null);
      setError('Событие не найдено');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [loadedEvent, loadedOccurrences, loadedOptions] = await Promise.all([
        loadEventById(eventId),
        listEventOccurrences(eventId).catch(() => [] as EventOccurrence[]),
        listEventParticipationOptions(eventId),
      ]);

      if (!loadedEvent) {
        throw new Error('Событие не найдено');
      }

      if (loadedEvent.registrationMode !== 'internal_paid') {
        throw new Error('Регистрация для этого события недоступна');
      }

      const activeOptions = loadedOptions.filter((option) => option.isActive);

      setEvent(loadedEvent);
      setOccurrences(loadedOccurrences);
      setOptions(activeOptions);
      setSelectedIds((current) => (
        current.filter((id) => activeOptions.some((option) => option.id === id))
      ));
      setSelectedOccurrenceId((current) => (
        current && loadedOccurrences.some((occurrence) => occurrence.id === current)
          ? current
          : null
      ));
    } catch (loadError) {
      setEvent(null);
      setOccurrences([]);
      setOptions([]);
      setSelectedIds([]);
      setSelectedOccurrenceId(null);
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Не удалось загрузить варианты участия',
      );
    } finally {
      setLoading(false);
    }
  }, [eventId, loadEventById]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!authUser) {
      return;
    }

    void loadMyRegistrations().catch(() => undefined);
  }, [authUser, loadMyRegistrations]);

  useEffect(() => {
    setImageFailed(false);
  }, [event?.imageUrl]);

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedOptions = useMemo(
    () => options.filter((option) => selectedIdSet.has(option.id)),
    [options, selectedIdSet],
  );
  const nearestFutureOccurrence = useMemo(
    () => selectNextFutureOccurrence(occurrences) ?? event?.nextOccurrence ?? null,
    [event?.nextOccurrence, occurrences],
  );
  const occurrenceChoiceRequired = useMemo(
    () => shouldRequireOccurrenceChoice(event, occurrences),
    [event, occurrences],
  );
  const selectedOccurrenceFromChoice = useMemo(
    () => {
      const occurrence = occurrences.find((item) => item.id === selectedOccurrenceId) ?? null;

      if (
        !occurrence
        || !isRegistrationWindowOpen(occurrence)
        || !isOccurrenceAlwaysOpen(occurrence)
      ) {
        return null;
      }

      return occurrence;
    },
    [occurrences, selectedOccurrenceId],
  );
  const autoOccurrence = occurrenceChoiceRequired ? null : nearestFutureOccurrence;
  const selectedOccurrence = occurrenceChoiceRequired
    ? selectedOccurrenceFromChoice
    : autoOccurrence;
  const displayOccurrence = useMemo(
    () => (
      occurrenceChoiceRequired
        ? selectedOccurrenceFromChoice
        : nearestFutureOccurrence ?? getNearestOccurrence(occurrences)
    ),
    [
      nearestFutureOccurrence,
      occurrenceChoiceRequired,
      occurrences,
      selectedOccurrenceFromChoice,
    ],
  );
  const occurrenceWindowRequired = Boolean(
    occurrenceChoiceRequired
    || selectedOccurrence
    || autoOccurrence
    || event?.hasOccurrences === true
    || event?.nextOccurrence
    || occurrences.length > 0,
  );
  const registrationWindowInfo = useMemo(() => {
    if (!occurrenceWindowRequired) {
      return null;
    }

    if (occurrenceChoiceRequired && !selectedOccurrence) {
      return null;
    }

    return getRegistrationWindowInfo(selectedOccurrence);
  }, [occurrenceChoiceRequired, occurrenceWindowRequired, selectedOccurrence]);
  const registrationWindowBlocked = Boolean(
    registrationWindowInfo && registrationWindowInfo.state !== 'open',
  );
  const registrationWindowHint = registrationWindowInfo && registrationWindowBlocked
    ? getRegistrationWindowHint(registrationWindowInfo, occurrences)
    : null;
  const occurrenceChoiceBlocked = occurrenceChoiceRequired && !selectedOccurrence;
  const registrationTargetBlocked = occurrenceWindowRequired && selectedOccurrence === null;
  const showOccurrenceChoiceStep = occurrenceChoiceRequired && !selectedOccurrence;
  const showOptionsStep = !showOccurrenceChoiceStep;
  const totals = useMemo(() => (
    selectedOptions.reduce(
      (acc, option) => {
        const quantity = getOptionQuantity(option, quantities);

        return {
          amount: acc.amount + option.priceAmount * quantity,
          seats: acc.seats + (!option.isDonation && option.countsTowardCapacity ? quantity : 0),
        };
      },
      { amount: 0, seats: 0 },
    )
  ), [quantities, selectedOptions]);
  const existingRegistrationForTarget = useMemo(() => {
    if (!eventId || registrationTargetBlocked) {
      return null;
    }

    return findActiveRegistrationForTarget(
      myRegistrations,
      eventId,
      selectedOccurrence?.id ?? null,
    );
  }, [eventId, myRegistrations, registrationTargetBlocked, selectedOccurrence]);
  const summaryCurrency = selectedOptions[0]?.priceCurrency ?? 'RUB';
  const canContinue = totals.seats > 0
    && !submitting
    && !registrationTargetBlocked
    && !registrationWindowBlocked;
  const showImage = Boolean(event?.imageUrl && !imageFailed);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    if (eventId) {
      router.push({ pathname: '/events/[id]', params: { id: eventId } });
      return;
    }

    router.push('/events');
  }, [eventId, router]);

  const toggleOption = useCallback((option: EventParticipationOption) => {
    setSelectedIds((current) => {
      if (current.includes(option.id)) {
        return current.filter((id) => id !== option.id);
      }

      const compatibleIds = current.filter((id) => {
        const selectedOption = options.find((item) => item.id === id);

        return selectedOption ? !optionsConflict(option, selectedOption) : true;
      });

      return [...compatibleIds, option.id];
    });
    setQuantities((current) => ({
      ...current,
      [option.id]: getOptionQuantity(option, current),
    }));
  }, [options]);

  const updateQuantity = useCallback((option: EventParticipationOption, delta: number) => {
    setQuantities((current) => {
      const quantity = getOptionQuantity(option, current);

      return {
        ...current,
        [option.id]: clampQuantity(option, quantity + delta),
      };
    });
  }, []);

  const handleSelectOccurrence = useCallback((occurrence: EventOccurrence) => {
    if (!isRegistrationWindowOpen(occurrence) || !isOccurrenceAlwaysOpen(occurrence)) {
      return;
    }

    setSelectedOccurrenceId(occurrence.id);
  }, []);

  const handleChangeOccurrence = useCallback(() => {
    setSelectedOccurrenceId(null);
    setSelectedIds([]);
    setQuantities({});
  }, []);

  const submitRegistration = useCallback(async () => {
    if (!eventId) {
      return;
    }

    if (registrationTargetBlocked || registrationWindowBlocked) {
      Alert.alert(
        'Регистрация сейчас недоступна',
        registrationWindowHint ?? 'Регистрация сейчас недоступна.',
      );
      return;
    }

    if (totals.seats <= 0) {
      Alert.alert('Выберите вариант участия');
      return;
    }

    setSubmitting(true);

    try {
      await registerForPaidEventSimulated({
        eventId,
        occurrenceId: selectedOccurrence?.id ?? null,
        optionSelections: selectedOptions.map((option) => ({
          optionId: option.id,
          quantity: getOptionQuantity(option, quantities),
        })),
        seatsCount: totals.seats,
      });

      Alert.alert('Готово', paymentSimulationSuccessText, [
        {
          text: 'ОК',
          onPress: () => router.replace({ pathname: '/events/[id]', params: { id: eventId } }),
        },
      ]);
    } catch (submitError) {
      Alert.alert(
        'Не удалось создать запись',
        submitError instanceof Error ? submitError.message : 'Попробуйте ещё раз.',
      );
    } finally {
      setSubmitting(false);
    }
  }, [
    eventId,
    quantities,
    registerForPaidEventSimulated,
    registrationTargetBlocked,
    registrationWindowBlocked,
    registrationWindowHint,
    router,
    selectedOccurrence,
    selectedOptions,
    totals.seats,
  ]);

  const handleContinue = useCallback(() => {
    if (occurrenceChoiceBlocked) {
      Alert.alert('Выберите дату', 'Сначала выберите дату события.');
      return;
    }

    if (registrationWindowBlocked) {
      Alert.alert(
        'Регистрация сейчас недоступна',
        registrationWindowHint ?? 'Регистрация сейчас недоступна.',
      );
      return;
    }

    if (totals.seats <= 0) {
      Alert.alert('Выберите вариант участия');
      return;
    }

    if (existingRegistrationForTarget) {
      Alert.alert(
        'Создать ещё одну запись?',
        'У вас уже есть запись на этот сеанс. Новая запись будет создана отдельно.',
        [
          { text: 'Отмена', style: 'cancel' },
          {
            text: 'Создать ещё одну запись',
            onPress: () => { void submitRegistration(); },
          },
        ],
      );
      return;
    }

    Alert.alert(paymentSimulationTitle, paymentSimulationText, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Продолжить', onPress: () => { void submitRegistration(); } },
    ]);
  }, [
    existingRegistrationForTarget,
    occurrenceChoiceBlocked,
    registrationWindowBlocked,
    registrationWindowHint,
    submitRegistration,
    totals.seats,
  ]);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen contentContainerStyle={styles.content}>
        <Pressable onPress={handleBack} style={styles.backButton}>
          <Ionicons name="chevron-back" size={22} color={colors.orange} />
          <Text style={styles.backText}>Назад</Text>
        </Pressable>

        {loading ? (
          <GlassCard>
            <View style={styles.stateCard}>
              <ActivityIndicator color={colors.orange} />
              <Text style={styles.stateText}>Загружаем регистрацию...</Text>
            </View>
          </GlassCard>
        ) : null}

        {!loading && error ? (
          <GlassCard>
            <View style={styles.stateCard}>
              <Ionicons name="alert-circle-outline" size={24} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
              <PrimaryButton title="Повторить" onPress={loadData} />
            </View>
          </GlassCard>
        ) : null}

        {!loading && !error && event ? (
          <>
            {showImage ? (
              <View style={styles.posterFrame}>
                <Image
                  source={{ uri: event.imageUrl ?? '' }}
                  resizeMode="contain"
                  style={styles.posterImage}
                  onError={() => setImageFailed(true)}
                />
              </View>
            ) : null}

            <View style={styles.titleBlock}>
              <Text style={styles.title}>{event.title}</Text>
              {displayOccurrence ? (
                <Text style={styles.subtitle}>{formatOccurrence(displayOccurrence)}</Text>
              ) : null}
              {registrationWindowHint ? (
                <Text style={styles.windowHint}>{registrationWindowHint}</Text>
              ) : null}
            </View>

            {showOccurrenceChoiceStep ? (
              <GlassCard>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Выберите дату</Text>
                </View>
                <Text style={styles.sectionSubtitle}>Выберите дату события</Text>
                <View style={styles.occurrenceList}>
                  {occurrences.map((occurrence) => {
                    const windowInfo = getRegistrationWindowInfo(occurrence);
                    const disabled = !isRegistrationWindowOpen(occurrence)
                      || !isOccurrenceAlwaysOpen(occurrence);

                    return (
                      <OccurrenceCard
                        key={occurrence.id}
                        occurrence={occurrence}
                        selected={selectedOccurrenceId === occurrence.id}
                        disabled={disabled}
                        windowInfo={windowInfo}
                        onPress={() => handleSelectOccurrence(occurrence)}
                      />
                    );
                  })}
                </View>
              </GlassCard>
            ) : null}

            {occurrenceChoiceRequired && selectedOccurrence ? (
              <GlassCard>
                <View style={styles.selectedOccurrenceSummary}>
                  <View style={styles.selectedOccurrenceTextBlock}>
                    <Text style={styles.selectedOccurrenceLabel}>Выбранная дата</Text>
                    <Text style={styles.selectedOccurrenceDate}>
                      {formatDate(selectedOccurrence.startsAt, selectedOccurrence.timezone)}
                    </Text>
                    <Text style={styles.selectedOccurrenceTime}>
                      {formatOccurrenceTimeRange(selectedOccurrence)}
                    </Text>
                    {selectedOccurrence.title ? (
                      <Text style={styles.selectedOccurrenceTitle}>{selectedOccurrence.title}</Text>
                    ) : null}
                  </View>
                  <Pressable
                    onPress={handleChangeOccurrence}
                    style={({ pressed }) => [
                      styles.changeOccurrenceButton,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Ionicons name="calendar-outline" size={16} color={colors.orange} />
                    <Text style={styles.changeOccurrenceText}>Изменить дату</Text>
                  </Pressable>
                </View>
              </GlassCard>
            ) : null}

            {showOptionsStep ? (
              <>
                <GlassCard>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>Варианты участия</Text>
                    <Chip tone="warning">Платно</Chip>
                  </View>
                  {options.length === 0 ? (
                    <View style={styles.emptyOptions}>
                      <Ionicons name="ticket-outline" size={24} color={colors.textDim} />
                      <Text style={styles.emptyTitle}>Варианты участия пока не настроены</Text>
                    </View>
                  ) : (
                    <View style={styles.optionsBlock}>
                      {options.map((option) => (
                        <OptionCard
                          key={option.id}
                          option={option}
                          selected={selectedIdSet.has(option.id)}
                          quantity={getOptionQuantity(option, quantities)}
                          onPress={() => toggleOption(option)}
                          onDecrease={() => updateQuantity(option, -1)}
                          onIncrease={() => updateQuantity(option, 1)}
                        />
                      ))}
                    </View>
                  )}
                </GlassCard>

                <GlassCard>
                  <View style={styles.totalRow}>
                    <View style={styles.totalIcon}>
                      <Ionicons name="receipt-outline" size={18} color={colors.orange} />
                    </View>
                    <View style={styles.totalTextBlock}>
                      <Text style={styles.totalLabel}>Итого</Text>
                      <Text style={styles.totalText}>
                        {formatMoney(totals.amount, summaryCurrency)}
                      </Text>
                      <Text style={styles.seatsText}>
                        {selectedOptions.length > 0
                          ? `Мест: ${totals.seats}`
                          : 'Места не выбраны'}
                      </Text>
                    </View>
                  </View>
                  <PrimaryButton
                    title={submitting
                      ? 'Создаём запись...'
                      : occurrenceChoiceBlocked
                        ? 'Выберите дату'
                        : registrationWindowInfo && registrationWindowBlocked
                          ? getRegistrationWindowActionTitle(registrationWindowInfo)
                          : 'Продолжить'}
                    disabled={!canContinue}
                    onPress={handleContinue}
                    buttonStyle={styles.continueButton}
                  />
                </GlassCard>
              </>
            ) : null}
          </>
        ) : null}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 14,
    paddingBottom: 36,
  },
  backButton: {
    alignSelf: 'flex-start',
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  backText: {
    color: colors.orange,
    fontSize: 15,
    fontWeight: '600',
  },
  posterFrame: {
    width: '100%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  posterImage: {
    width: '100%',
    height: '100%',
  },
  titleBlock: {
    gap: 8,
  },
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 32,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  windowHint: {
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 18,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  sectionTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 24,
  },
  sectionSubtitle: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
  },
  selectedOccurrenceSummary: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  selectedOccurrenceTextBlock: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  selectedOccurrenceLabel: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 16,
  },
  selectedOccurrenceDate: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '900',
    lineHeight: 22,
  },
  selectedOccurrenceTime: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 19,
  },
  selectedOccurrenceTitle: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  changeOccurrenceButton: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.accent.orangeBorder,
    backgroundColor: colors.accent.orangeBg,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  changeOccurrenceText: {
    color: colors.orange,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 17,
  },
  chip: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.glass.w16,
    backgroundColor: colors.glass.w10,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  chipWarning: {
    borderColor: colors.accent.goldBorder,
    backgroundColor: colors.accent.goldBg,
  },
  chipText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    includeFontPadding: false,
  },
  occurrenceList: {
    gap: 10,
    marginTop: 14,
  },
  occurrenceCard: {
    minHeight: 112,
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.glass.w06,
    padding: 14,
    gap: 12,
  },
  occurrenceCardSelected: {
    borderColor: colors.accent.orangeBorder,
    backgroundColor: colors.accent.orangeBg,
  },
  occurrenceCardDisabled: {
    opacity: 0.55,
  },
  occurrenceTextBlock: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  occurrenceDate: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 21,
  },
  occurrenceTime: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 19,
  },
  occurrenceTitle: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  occurrenceStatus: {
    color: colors.accent.goldText,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
  },
  occurrenceStatusDisabled: {
    color: colors.textDim,
  },
  occurrenceRadio: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.glass.w35,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  occurrenceRadioSelected: {
    borderColor: colors.orange,
    backgroundColor: colors.orange,
  },
  occurrenceRadioDisabled: {
    borderColor: colors.glass.w16,
  },
  optionsBlock: {
    gap: 10,
    marginTop: 14,
  },
  optionCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.glass.w06,
    padding: 14,
    gap: 12,
  },
  optionCardSelected: {
    borderColor: colors.accent.orangeBorder,
    backgroundColor: colors.accent.orangeBg,
  },
  optionTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  optionTitleBlock: {
    flex: 1,
    minWidth: 0,
    gap: 8,
  },
  optionMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionHint: {
    color: colors.textDim,
    fontSize: 12,
    lineHeight: 17,
  },
  optionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 21,
  },
  optionDescription: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.glass.w35,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxSelected: {
    borderColor: colors.orange,
    backgroundColor: colors.orange,
  },
  optionFooter: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  optionPrice: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '900',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.glass.w08,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  stepperButton: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass.w10,
  },
  stepperButtonDisabled: {
    opacity: 0.42,
  },
  stepperValue: {
    minWidth: 22,
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  totalIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent.orangeBg,
    borderWidth: 1,
    borderColor: colors.accent.orangeBorder,
  },
  totalTextBlock: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  totalLabel: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: '600',
  },
  totalText: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  seatsText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  continueButton: {
    width: '100%',
    marginTop: 14,
  },
  emptyOptions: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 18,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  stateCard: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
  },
  stateText: {
    color: colors.textDim,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.84,
  },
});
