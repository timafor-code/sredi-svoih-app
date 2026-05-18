import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  formatMoney,
  RegistrationDetailCard,
} from '@/components/events/MyRegistrationCards';
import { GlassCard } from '@/components/glass/GlassCard';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import {
  buildMyRegistrationGroups,
  formatGroupStatusSummary,
  formatRegistrationCount,
  type MyRegistrationPeriod,
} from '@/lib/registrationGroups';
import { useEventRegistrationAction } from '@/hooks/useEventRegistrationAction';
import { useAuthStore } from '@/store/useAuthStore';
import { useEventsStore } from '@/store/useEventsStore';
import { colors } from '@/theme/colors';

const MY_REGISTRATIONS_DEBUG_TAG = '[mobile registrations]';

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

type RegistrationDetailPeriod = Extract<MyRegistrationPeriod, 'active' | 'past'>;

function getDetailPeriod(value: string | string[] | undefined): RegistrationDetailPeriod {
  return firstParam(value) === 'past' ? 'past' : 'active';
}

export default function RegistrationGroupDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ eventId?: string | string[]; period?: string | string[] }>();
  const eventId = firstParam(params.eventId);
  const period = getDetailPeriod(params.period);
  const authUser = useAuthStore((state) => state.user);
  const loadSession = useAuthStore((state) => state.loadSession);
  const {
    error,
    loadMyRegistrations,
    myRegistrations,
    registrationsLoading,
  } = useEventsStore();
  const {
    cancellingRegistrationId,
    handleCancelRegistration,
  } = useEventRegistrationAction();
  const [refreshing, setRefreshing] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void loadSession().catch(() => undefined);
    }, [loadSession]),
  );

  useFocusEffect(
    useCallback(() => {
      if (!authUser) {
        return undefined;
      }

      void loadMyRegistrations().catch(() => undefined);

      return undefined;
    }, [authUser, loadMyRegistrations]),
  );

  const group = useMemo(() => {
    if (!eventId) {
      return null;
    }

    return buildMyRegistrationGroups(myRegistrations, Date.now(), { period })
      .find((item) => item.eventId === eventId) ?? null;
  }, [eventId, myRegistrations, period]);

  const event = group?.event;
  const statusSummary = group ? formatGroupStatusSummary(group.statusesSummary) : '';
  const amount = group ? formatMoney(group.totalAmount, group.totalCurrency) : null;
  const modeTitle = period === 'past' ? 'Прошедшие записи' : 'Ваши записи на ближайшие даты';
  const amountDescription = period === 'past' ? 'По прошедшим записям' : 'По активным записям';
  const showImage = Boolean(event?.imageUrl && !imageFailed);

  useEffect(() => {
    setImageFailed(false);
  }, [event?.imageUrl]);

  useEffect(() => {
    if (!__DEV__ || !authUser || !eventId) {
      return;
    }

    console.info(`${MY_REGISTRATIONS_DEBUG_TAG} registration-group detail`, {
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? null,
      authUser: {
        id: authUser.id,
        email: authUser.email ?? null,
      },
      eventId,
      period,
      registrationsInStore: myRegistrations.length,
      totalRegistrationsCount: group?.totalRegistrationsCount ?? 0,
      registrationIds: group?.registrations.map((registration) => registration.id) ?? [],
      occurrenceIds: group?.registrations.map((registration) => registration.occurrenceId) ?? [],
      selectedOptionTitles: group?.registrations.map((registration) => ({
        registrationId: registration.id,
        titles: registration.selectedOptions.map((option) => option.title),
      })) ?? [],
    });
  }, [authUser, eventId, group, myRegistrations.length, period]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.push(period === 'past' ? '/profile/past-registrations' : '/profile/my-registrations');
  }, [period, router]);

  const openFallbackList = useCallback(() => {
    router.push(period === 'past' ? '/profile/past-registrations' : '/profile/my-registrations');
  }, [period, router]);

  const handleRefresh = useCallback(async () => {
    if (!authUser) {
      return;
    }

    setRefreshing(true);

    try {
      await loadMyRegistrations();
    } catch {
      // The store keeps a human-readable error for the screen state.
    } finally {
      setRefreshing(false);
    }
  }, [authUser, loadMyRegistrations]);

  const showInitialLoading = authUser && registrationsLoading && !group;
  const showBlockingError = authUser && Boolean(error) && !registrationsLoading && !group;
  const showMissingGroup = authUser && !registrationsLoading && !error && !group;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen
        contentContainerStyle={styles.content}
        refreshControl={
          authUser ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.orange}
              colors={[colors.orange]}
            />
          ) : undefined
        }
      >
        <Pressable onPress={handleBack} style={styles.backButton}>
          <Ionicons name="chevron-back" size={22} color={colors.orange} />
          <Text style={styles.backText}>Назад</Text>
        </Pressable>

        {!authUser ? (
          <GlassCard>
            <View style={styles.stateCard}>
              <Ionicons name="lock-closed-outline" size={24} color={colors.textDim} />
              <Text style={styles.stateTitle}>Войдите, чтобы увидеть свои записи на события.</Text>
            </View>
          </GlassCard>
        ) : null}

        {showInitialLoading ? (
          <GlassCard>
            <View style={styles.stateCard}>
              <ActivityIndicator color={colors.orange} />
              <Text style={styles.stateText}>Загружаем записи...</Text>
            </View>
          </GlassCard>
        ) : null}

        {showBlockingError ? (
          <GlassCard>
            <View style={styles.stateCard}>
              <Ionicons name="alert-circle-outline" size={24} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
              <PrimaryButton title="Повторить" onPress={handleRefresh} />
            </View>
          </GlassCard>
        ) : null}

        {showMissingGroup ? (
          <GlassCard>
            <View style={styles.stateCard}>
              <Ionicons name="calendar-clear-outline" size={24} color={colors.textDim} />
              <Text style={styles.stateTitle}>Записи на это событие не найдены.</Text>
              <PrimaryButton
                title={period === 'past' ? 'К прошедшим событиям' : 'К моим записям'}
                onPress={openFallbackList}
              />
            </View>
          </GlassCard>
        ) : null}

        {group ? (
          <>
            <View style={styles.hero}>
              {showImage ? (
                <Image
                  source={{ uri: event?.imageUrl ?? '' }}
                  resizeMode="cover"
                  style={styles.heroImage}
                  onError={() => setImageFailed(true)}
                />
              ) : (
                <View style={styles.heroPlaceholder}>
                  <Ionicons name="calendar-outline" size={42} color={colors.textDim} />
                </View>
              )}
            </View>

            <View style={styles.titleBlock}>
              <Text style={styles.title}>{event?.title ?? 'Событие'}</Text>
              {event?.subtitle ? <Text style={styles.subtitle}>{event.subtitle}</Text> : null}
              {event?.category ? <Text style={styles.metaText}>{event.category}</Text> : null}
            </View>

            <GlassCard>
              <View style={styles.summaryBlock}>
                <Text style={styles.modeTitle}>{modeTitle}</Text>
                <View style={styles.summaryRow}>
                  <View style={styles.summaryIcon}>
                    <Ionicons name="ticket-outline" size={18} color={colors.orange} />
                  </View>
                  <View style={styles.summaryTextBlock}>
                    <Text style={styles.summaryTitle}>
                      {formatRegistrationCount(group.totalRegistrationsCount)}
                    </Text>
                    {statusSummary ? <Text style={styles.summaryText}>{statusSummary}</Text> : null}
                  </View>
                </View>
                {amount ? (
                  <View style={styles.summaryRow}>
                    <View style={styles.summaryIcon}>
                      <Ionicons name="receipt-outline" size={18} color={colors.orange} />
                    </View>
                    <View style={styles.summaryTextBlock}>
                      <Text style={styles.summaryTitle}>Итого: {amount}</Text>
                      <Text style={styles.summaryText}>{amountDescription}</Text>
                    </View>
                  </View>
                ) : null}
              </View>
            </GlassCard>

            <View style={styles.list}>
              {group.registrations.map((registration) => (
                <RegistrationDetailCard
                  key={registration.id}
                  registration={registration}
                  cancelling={cancellingRegistrationId === registration.id}
                  onCancel={handleCancelRegistration}
                  showCancelAction={period === 'active'}
                />
              ))}
            </View>
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
  hero: {
    height: 188,
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
    backgroundColor: colors.glass.w06,
  },
  titleBlock: {
    gap: 7,
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
    fontSize: 15,
    lineHeight: 21,
  },
  metaText: {
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 18,
  },
  summaryBlock: {
    gap: 12,
  },
  modeTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 20,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  summaryIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent.orangeBg,
    borderWidth: 1,
    borderColor: colors.accent.orangeBorder,
  },
  summaryTextBlock: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  summaryTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 21,
  },
  summaryText: {
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 18,
  },
  list: {
    gap: 12,
  },
  stateCard: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  stateTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 21,
    textAlign: 'center',
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
});
