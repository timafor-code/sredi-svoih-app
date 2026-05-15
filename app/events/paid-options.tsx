import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassCard } from '@/components/glass/GlassCard';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import {
  getNearestOccurrence,
  getOpenOccurrences,
  getUnavailableRegistrationText,
  isRegistrationWindowOpen,
} from '@/lib/registrationWindow';
import { listEventOccurrences } from '@/services/eventOccurrencesService';
import { listEventParticipationOptions } from '@/services/participationOptionsService';
import { useEventsStore } from '@/store/useEventsStore';
import { colors } from '@/theme/colors';
import type { EventItem } from '@/types/event';
import type { EventOccurrence } from '@/types/eventOccurrence';
import type { EventParticipationOption } from '@/types/participationOption';

const paymentSimulationTitle = 'Тестовая оплата';
const paymentSimulationText = 'Это тестовая имитация оплаты. Реальный платёжный сервис пока не подключён.';
const paymentSimulationSuccessText = 'Запись создана. Оплата отмечена как тестовая.';

const optionTypeLabels: Record<string, string> = {
  participation: 'Участие',
  meal: 'Трапеза',
  package: 'Пакет',
  child: 'Детский',
  family: 'Семейный',
  other: 'Другое',
  donation: 'Пожертвование',
};

type Quantities = Record<string, number>;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function formatDate(value: string, timeZone?: string | null): string {
  const options: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: '2-digit',
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

function formatMoney(amount: number, currency: string | null | undefined): string {
  const rounded = Math.max(0, Math.round(amount));
  const formatted = rounded.toLocaleString('ru-RU').replace(/\u00A0/g, ' ');

  return (currency ?? 'RUB').toUpperCase() === 'RUB'
    ? `${formatted} ₽`
    : `${formatted} ${currency ?? 'RUB'}`;
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

function formatOccurrenceSession(occurrence: EventOccurrence): string {
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

  return `${start}-${end}`;
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
  disabled?: boolean;
  option: EventParticipationOption;
  quantity: number;
  onDecrease: () => void;
  onIncrease: () => void;
};

function QuantityStepper({
  disabled = false,
  onDecrease,
  onIncrease,
  option,
  quantity,
}: QuantityStepperProps) {
  const min = Math.max(1, option.minQuantity || 1);
  const max = Math.max(min, option.maxQuantity || min);

  return (
    <View style={styles.stepper}>
      <Pressable
        disabled={disabled || quantity <= min}
        onPress={onDecrease}
        style={({ pressed }) => [
          styles.stepperButton,
          (disabled || quantity <= min) && styles.stepperButtonDisabled,
          pressed && !disabled && quantity > min && styles.pressed,
        ]}
      >
        <Ionicons name="remove" size={17} color={colors.text} />
      </Pressable>
      <Text style={styles.stepperValue}>{quantity}</Text>
      <Pressable
        disabled={disabled || quantity >= max}
        onPress={onIncrease}
        style={({ pressed }) => [
          styles.stepperButton,
          (disabled || quantity >= max) && styles.stepperButtonDisabled,
          pressed && !disabled && quantity < max && styles.pressed,
        ]}
      >
        <Ionicons name="add" size={17} color={colors.text} />
      </Pressable>
    </View>
  );
}

type OptionCardProps = {
  disabled?: boolean;
  kind: 'main' | 'donation';
  option: EventParticipationOption;
  quantity: number;
  selected: boolean;
  onDecrease: () => void;
  onIncrease: () => void;
  onPress: () => void;
};

function OptionCard({
  disabled = false,
  kind,
  onDecrease,
  onIncrease,
  onPress,
  option,
  quantity,
  selected,
}: OptionCardProps) {
  const indicator = kind === 'donation' ? (
    <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
      {selected ? <Ionicons name="checkmark" size={15} color={colors.text} /> : null}
    </View>
  ) : (
    <View style={[styles.radio, selected && styles.radioSelected]}>
      {selected ? <Ionicons name="checkmark" size={15} color={colors.text} /> : null}
    </View>
  );

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.optionCard,
        selected && styles.optionCardSelected,
        disabled && styles.optionCardDisabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <View style={styles.optionTopRow}>
        <View style={styles.optionTitleBlock}>
          <View style={styles.optionMetaRow}>
            <Chip tone={option.isDonation ? 'warning' : 'default'}>
              {optionTypeLabels[option.optionType] ?? option.optionType}
            </Chip>
            {!option.countsTowardCapacity ? (
              <Text style={styles.optionHint}>Не занимает место</Text>
            ) : null}
            {option.isDonation ? <Text style={styles.optionHint}>Пожертвование</Text> : null}
          </View>
          <Text style={styles.optionTitle}>{option.title}</Text>
          {option.description ? (
            <Text style={styles.optionDescription}>{option.description}</Text>
          ) : null}
        </View>
        {indicator}
      </View>

      <View style={styles.optionFooter}>
        <Text style={styles.optionPrice}>
          {formatMoney(option.priceAmount, option.priceCurrency)}
        </Text>
        {selected && option.allowQuantity ? (
          <QuantityStepper
            disabled={disabled}
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

export default function PaidOptionsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    eventId?: string | string[];
    occurrenceId?: string | string[];
  }>();
  const eventId = firstParam(params.eventId);
  const occurrenceId = firstParam(params.occurrenceId);
  const loadEventById = useEventsStore((state) => state.loadEventById);
  const registerForPaidEventSimulated = useEventsStore(
    (state) => state.registerForPaidEventSimulated,
  );
  const [event, setEvent] = useState<EventItem | null>(null);
  const [occurrences, setOccurrences] = useState<EventOccurrence[]>([]);
  const [selectedOccurrenceId, setSelectedOccurrenceId] = useState<string | null>(null);
  const [occurrenceUnavailableReason, setOccurrenceUnavailableReason] = useState<string | null>(null);
  const [options, setOptions] = useState<EventParticipationOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [quantities, setQuantities] = useState<Quantities>({});
  const [heroImageFailed, setHeroImageFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!eventId) {
      setEvent(null);
      setOptions([]);
      setOccurrences([]);
      setSelectedOccurrenceId(null);
      setOccurrenceUnavailableReason(null);
      setError('Событие не найдено');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [loadedEvent, loadedOccurrences, loadedOptions] = await Promise.all([
        loadEventById(eventId),
        listEventOccurrences(eventId),
        listEventParticipationOptions(eventId),
      ]);

      if (!loadedEvent) {
        throw new Error('Событие не найдено');
      }

      const openOccurrences = getOpenOccurrences(loadedOccurrences);
      const requestedOccurrence = occurrenceId
        ? loadedOccurrences.find((item) => item.id === occurrenceId) ?? null
        : null;
      const requestedOpenOccurrence = requestedOccurrence && isRegistrationWindowOpen(requestedOccurrence)
        ? requestedOccurrence
        : null;
      const autoSelectedOccurrenceId = openOccurrences.length === 1
        ? openOccurrences[0].id
        : null;
      const nextSelectedOccurrenceId = occurrenceId
        ? (requestedOpenOccurrence?.id ?? null)
        : autoSelectedOccurrenceId;

      setEvent(loadedEvent);
      setOccurrences(loadedOccurrences);
      setSelectedOccurrenceId(nextSelectedOccurrenceId);
      setOccurrenceUnavailableReason(
        occurrenceId && !requestedOpenOccurrence
          ? 'Выбранный сеанс сейчас недоступен.'
          : null,
      );
      const activeOptions = loadedOptions.filter((option) => option.isActive);
      const shouldClearSelections = !nextSelectedOccurrenceId;

      setOptions(activeOptions);
      setSelectedIds((current) => (
        shouldClearSelections
          ? []
          : current.filter((id) => activeOptions.some((option) => option.id === id))
      ));
      setQuantities((current) => (shouldClearSelections ? {} : current));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить варианты участия');
    } finally {
      setLoading(false);
    }
  }, [eventId, loadEventById, occurrenceId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    setHeroImageFailed(false);
  }, [event?.imageUrl]);

  const mainOptions = useMemo(
    () => options.filter((option) => !option.isDonation),
    [options],
  );
  const donationOptions = useMemo(
    () => options.filter((option) => option.isDonation),
    [options],
  );
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedOptions = useMemo(
    () => options.filter((option) => selectedIdSet.has(option.id)),
    [options, selectedIdSet],
  );
  const openOccurrences = useMemo(
    () => getOpenOccurrences(occurrences),
    [occurrences],
  );
  const selectedOccurrence = useMemo(
    () => openOccurrences.find((item) => item.id === selectedOccurrenceId) ?? null,
    [openOccurrences, selectedOccurrenceId],
  );
  const shouldRedirectToOccurrenceStep = Boolean(
    event?.id === eventId && !occurrenceId && openOccurrences.length > 1,
  );
  const registrationFlowBlocked = !shouldRedirectToOccurrenceStep && !selectedOccurrence;
  const selectedOccurrenceOpen = Boolean(
    selectedOccurrence && isRegistrationWindowOpen(selectedOccurrence),
  );
  const nearestOccurrence = useMemo(
    () => getNearestOccurrence(occurrences),
    [occurrences],
  );
  const unavailableRegistrationText = useMemo(
    () => getUnavailableRegistrationText(occurrences),
    [occurrences],
  );
  const registrationUnavailableText = occurrenceUnavailableReason ?? unavailableRegistrationText;

  useEffect(() => {
    if (!eventId || occurrenceId || openOccurrences.length <= 1 || event?.id !== eventId) {
      return;
    }

    router.replace({
      pathname: '/events/paid-occurrences',
      params: { eventId },
    });
  }, [event?.id, eventId, occurrenceId, openOccurrences.length, router]);

  const totals = useMemo(() => {
    return selectedOptions.reduce(
      (acc, option) => {
        const quantity = getOptionQuantity(option, quantities);
        const lineTotal = option.priceAmount * quantity;

        return {
          amount: acc.amount + lineTotal,
          seats: acc.seats + (!option.isDonation && option.countsTowardCapacity ? quantity : 0),
        };
      },
      { amount: 0, seats: 0 },
    );
  }, [quantities, selectedOptions]);

  const canContinue = totals.seats > 0
    && !submitting
    && !registrationFlowBlocked
    && selectedOccurrenceOpen;
  const displayedTotals = registrationFlowBlocked ? { amount: 0, seats: 0 } : totals;
  const showParticipationControls = !registrationFlowBlocked && !shouldRedirectToOccurrenceStep;
  const showStickyPanel = Boolean(
    !loading
      && !error
      && event
      && !shouldRedirectToOccurrenceStep
      && (options.length > 0 || registrationFlowBlocked),
  );

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

      return [...current, option.id];
    });
    setQuantities((current) => ({
      ...current,
      [option.id]: getOptionQuantity(option, current),
    }));
  }, []);

  const updateQuantity = useCallback((option: EventParticipationOption, delta: number) => {
    setQuantities((current) => {
      const quantity = getOptionQuantity(option, current);

      return {
        ...current,
        [option.id]: clampQuantity(option, quantity + delta),
      };
    });
  }, []);

  const submitRegistration = useCallback(async () => {
    if (!eventId) {
      return;
    }

    if (!selectedOccurrence || !isRegistrationWindowOpen(selectedOccurrence)) {
      Alert.alert(
        'Регистрация сейчас недоступна',
        'Выберите доступный сеанс или дождитесь открытия записи.',
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
    router,
    selectedOccurrence,
    selectedOptions,
    totals.seats,
  ]);

  const handleContinue = useCallback(() => {
    if (!selectedOccurrence || !isRegistrationWindowOpen(selectedOccurrence)) {
      Alert.alert(
        'Регистрация сейчас недоступна',
        'Выберите доступный сеанс или дождитесь открытия записи.',
      );
      return;
    }

    if (totals.seats <= 0) {
      Alert.alert('Выберите вариант участия');
      return;
    }

    Alert.alert(paymentSimulationTitle, paymentSimulationText, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Продолжить', onPress: () => { void submitRegistration(); } },
    ]);
  }, [selectedOccurrence, submitRegistration, totals.seats]);

  const showHeroImage = Boolean(event?.imageUrl && !heroImageFailed);
  const bottomOffset = Math.max(insets.bottom, Platform.OS === 'ios' ? 16 : 12);
  const summaryCurrency = registrationFlowBlocked ? 'RUB' : selectedOptions[0]?.priceCurrency ?? 'RUB';

  return (
    <View style={styles.root}>
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
              <Text style={styles.stateText}>Загружаем варианты участия...</Text>
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
            <View style={styles.hero}>
              {showHeroImage ? (
                <Image
                  source={{ uri: event.imageUrl ?? '' }}
                  resizeMode="cover"
                  style={styles.heroImage}
                  onError={() => setHeroImageFailed(true)}
                />
              ) : (
                <LinearGradient
                  colors={['rgba(240,122,42,0.28)', 'rgba(74,144,217,0.18)', 'rgba(13,15,24,0.96)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.heroPlaceholder}
                >
                  <Text style={styles.heroEmoji}>{event.imageIcon}</Text>
                </LinearGradient>
              )}
              <LinearGradient
                colors={['transparent', 'rgba(6,8,16,0.94)']}
                style={StyleSheet.absoluteFillObject}
              />
              <View style={styles.heroChips}>
                <Chip>{event.category}</Chip>
              </View>
            </View>

            <View style={styles.titleBlock}>
              <Text style={styles.title}>{event.title}</Text>
              {event.subtitle ? <Text style={styles.subtitle}>{event.subtitle}</Text> : null}
            </View>

            {registrationFlowBlocked ? (
              <GlassCard>
                <View style={styles.unavailableCardContent}>
                  <Ionicons name="alert-circle-outline" size={18} color={colors.warning} />
                  <Text style={styles.warningTitle}>Регистрация сейчас недоступна</Text>
                  <Text style={styles.warningText}>{registrationUnavailableText}</Text>
                  {nearestOccurrence ? (
                    <Text style={styles.nearestSessionText}>
                      Ближайший сеанс: {formatOccurrenceSession(nearestOccurrence)}
                    </Text>
                  ) : null}
                </View>
              </GlassCard>
            ) : null}

            {selectedOccurrence ? (
              <GlassCard>
                <View style={styles.dateCardContent}>
                  <View style={styles.dateIcon}>
                    <Ionicons name="calendar-outline" size={18} color={colors.orange} />
                  </View>
                  <View style={styles.dateTextBlock}>
                    <Text style={styles.dateLabel}>
                      {occurrenceId ? 'Выбранный сеанс' : 'Выбран автоматически'}
                    </Text>
                    <Text style={styles.dateTitle}>
                      Сеанс: {formatOccurrenceSession(selectedOccurrence)}
                    </Text>
                    <Text style={styles.dateSubtitle}>
                      {selectedOccurrence.title?.trim() || event.title}
                    </Text>
                  </View>
                </View>
              </GlassCard>
            ) : null}

            {showParticipationControls ? (
              <>
                <GlassCard>
                  <View style={styles.infoRow}>
                    <View style={styles.infoIcon}>
                      <Ionicons name="ticket-outline" size={18} color={colors.orange} />
                    </View>
                    <View style={styles.infoTextBlock}>
                      <Text style={styles.infoTitle}>Выберите вариант участия</Text>
                      <Text style={styles.infoText}>
                        Можно выбрать несколько вариантов участия и добавить пожертвование отдельно.
                      </Text>
                    </View>
                  </View>
                </GlassCard>

                {options.length === 0 ? (
                  <GlassCard>
                    <View style={styles.stateCard}>
                      <Ionicons name="ticket-outline" size={24} color={colors.textDim} />
                      <Text style={styles.emptyTitle}>Варианты участия пока не добавлены</Text>
                      <Text style={styles.stateText}>
                        Когда команда добавит варианты, они появятся на этом экране.
                      </Text>
                    </View>
                  </GlassCard>
                ) : (
                  <View style={styles.optionsBlock}>
                    {mainOptions.length > 0 ? (
                      <View style={styles.optionSection}>
                        <Text style={styles.optionSectionTitle}>Участие</Text>
                        {mainOptions.map((option) => (
                          <OptionCard
                            key={option.id}
                            kind="main"
                            option={option}
                            selected={selectedIdSet.has(option.id)}
                            quantity={getOptionQuantity(option, quantities)}
                            onPress={() => toggleOption(option)}
                            onDecrease={() => updateQuantity(option, -1)}
                            onIncrease={() => updateQuantity(option, 1)}
                          />
                        ))}
                      </View>
                    ) : null}

                    {donationOptions.length > 0 ? (
                      <View style={styles.optionSection}>
                        <Text style={styles.optionSectionTitle}>Дополнительно</Text>
                        {donationOptions.map((option) => (
                          <OptionCard
                            key={option.id}
                            kind="donation"
                            option={option}
                            selected={selectedIdSet.has(option.id)}
                            quantity={getOptionQuantity(option, quantities)}
                            onPress={() => toggleOption(option)}
                            onDecrease={() => updateQuantity(option, -1)}
                            onIncrease={() => updateQuantity(option, 1)}
                          />
                        ))}
                      </View>
                    ) : null}
                  </View>
                )}
              </>
            ) : null}
          </>
        ) : null}
      </Screen>

      {showStickyPanel ? (
        <View pointerEvents="box-none" style={[styles.stickyWrap, { bottom: bottomOffset }]}>
          <GlassCard style={styles.stickyCard} contentStyle={styles.stickyContent}>
            <View style={styles.totalSummary}>
              <View style={styles.totalIcon}>
                <Ionicons name="receipt-outline" size={19} color={colors.orange} />
              </View>
              <View style={styles.totalTextBlock}>
                <Text style={styles.totalLabel}>Итого</Text>
                <Text style={styles.totalText}>
                  {formatMoney(displayedTotals.amount, summaryCurrency)}
                </Text>
                <Text style={styles.seatsText}>
                  {registrationFlowBlocked
                    ? 'Регистрация сейчас недоступна'
                    : displayedTotals.seats > 0
                      ? `Мест: ${displayedTotals.seats}`
                      : 'Места не выбраны'}
                </Text>
              </View>
            </View>
            <PrimaryButton
              title={registrationFlowBlocked
                ? 'Регистрация сейчас недоступна'
                : submitting
                  ? 'Создаём запись...'
                  : 'Имитировать оплату и записаться'}
              disabled={!canContinue}
              onPress={handleContinue}
              buttonStyle={styles.stickyButton}
            />
          </GlassCard>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    gap: 14,
    paddingBottom: 156,
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
  hero: {
    height: 224,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroEmoji: {
    fontSize: 70,
    opacity: 0.58,
  },
  heroChips: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
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
  titleBlock: {
    gap: 8,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 34,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 21,
  },
  dateCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dateIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent.orangeBg,
    borderWidth: 1,
    borderColor: colors.accent.orangeBorder,
  },
  dateTextBlock: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  dateLabel: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: '600',
  },
  dateTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 21,
  },
  dateSubtitle: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  unavailableCardContent: {
    alignItems: 'flex-start',
    gap: 8,
  },
  warningTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 20,
  },
  warningText: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  nearestSessionText: {
    color: colors.textDim,
    fontSize: 12,
    lineHeight: 17,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  infoIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent.orangeBg,
    borderWidth: 1,
    borderColor: colors.accent.orangeBorder,
  },
  infoTextBlock: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  infoTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  infoText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  optionsBlock: {
    gap: 18,
  },
  optionSection: {
    gap: 10,
  },
  optionSectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0,
  },
  optionCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.glass.w06,
    padding: 16,
    gap: 14,
  },
  optionCardSelected: {
    borderColor: colors.accent.orangeBorder,
    backgroundColor: colors.accent.orangeBg,
    shadowColor: colors.orange,
    shadowOpacity: 0.24,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  optionCardDisabled: {
    opacity: 0.58,
  },
  pressed: {
    opacity: 0.84,
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
    fontSize: 17,
    fontWeight: '800',
    lineHeight: 22,
  },
  optionDescription: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.glass.w35,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  radioSelected: {
    borderColor: colors.orange,
    backgroundColor: colors.orange,
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
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  optionPrice: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
  emptyTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  stickyWrap: {
    position: 'absolute',
    left: 12,
    right: 12,
  },
  stickyCard: {
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
  },
  stickyContent: {
    minHeight: 112,
    alignItems: 'stretch',
    gap: 12,
    padding: 12,
  },
  totalSummary: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  totalIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
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
  stickyButton: {
    width: '100%',
  },
});
