import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { RegistrationGroupCard } from '@/components/events/MyRegistrationCards';
import { GlassCard } from '@/components/glass/GlassCard';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { SegmentControl } from '@/components/ui/SegmentControl';
import { SubHeader } from '@/components/ui/SubHeader';
import { useEventRegistrationAction } from '@/hooks/useEventRegistrationAction';
import {
  buildMyRegistrationGroups,
  type MyRegistrationGroup,
  type MyRegistrationPeriod,
} from '@/lib/registrationGroups';
import { useAuthStore } from '@/store/useAuthStore';
import { useEventsStore } from '@/store/useEventsStore';
import { colors } from '@/theme/colors';

const MY_REGISTRATIONS_DEBUG_TAG = '[mobile registrations]';
const MY_REGISTRATIONS_DEBUG_EVENT_TITLE = 'Шаббат открыто';
const registrationTabs = ['Актуальные', 'Прошедшие'] as const;

type RegistrationTab = (typeof registrationTabs)[number];
type RegistrationListPeriod = Extract<MyRegistrationPeriod, 'active' | 'past'>;

function getRegistrationPeriod(tab: RegistrationTab): RegistrationListPeriod {
  return tab === 'Прошедшие' ? 'past' : 'active';
}

function summarizeDebugGroup(group: MyRegistrationGroup | undefined) {
  if (!group) {
    return null;
  }

  return {
    eventId: group.eventId,
    totalRegistrationsCount: group.totalRegistrationsCount,
    registrationIds: group.registrations.map((registration) => registration.id),
    occurrenceIds: group.registrations.map((registration) => registration.occurrenceId),
    selectedOptionTitles: group.registrations.map((registration) => ({
      registrationId: registration.id,
      titles: registration.selectedOptions.map((option) => ({
        title: option.title,
        quantity: option.quantity,
        seatsCount: option.seatsCount,
        isDonation: option.isDonation,
      })),
    })),
  };
}

export default function MyRegistrationsScreen() {
  const router = useRouter();
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
  const [registrationTab, setRegistrationTab] = useState<RegistrationTab>('Актуальные');

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

  const {
    activeRegistrationGroups,
    pastRegistrationGroups,
  } = useMemo(() => {
    const now = Date.now();

    return {
      activeRegistrationGroups: buildMyRegistrationGroups(myRegistrations, now, { period: 'active' }),
      pastRegistrationGroups: buildMyRegistrationGroups(myRegistrations, now, { period: 'past' }),
    };
  }, [myRegistrations]);
  const selectedPeriod = getRegistrationPeriod(registrationTab);
  const registrationGroups = selectedPeriod === 'past' ? pastRegistrationGroups : activeRegistrationGroups;
  const hasPastRegistrationGroups = pastRegistrationGroups.length > 0;

  useEffect(() => {
    if (!__DEV__ || !authUser) {
      return;
    }

    const debugGroup = activeRegistrationGroups.find((group) => (
      group.event?.title === MY_REGISTRATIONS_DEBUG_EVENT_TITLE
    ));

    console.info(`${MY_REGISTRATIONS_DEBUG_TAG} my-registrations groups`, {
      apiUrl: process.env.EXPO_PUBLIC_API_URL ?? null,
      authUser: {
        id: authUser.id,
        email: authUser.email ?? null,
      },
      sourceRegistrationsCount: myRegistrations.length,
      activeGroupsCount: activeRegistrationGroups.length,
      pastGroupsCount: pastRegistrationGroups.length,
      activeRegistrationRowsAfterBuildMyRegistrationGroups: activeRegistrationGroups.reduce(
        (sum, group) => sum + group.totalRegistrationsCount,
        0,
      ),
      pastRegistrationRowsAfterBuildMyRegistrationGroups: pastRegistrationGroups.reduce(
        (sum, group) => sum + group.totalRegistrationsCount,
        0,
      ),
      debugEventTitle: MY_REGISTRATIONS_DEBUG_EVENT_TITLE,
      debugEventGroup: summarizeDebugGroup(debugGroup),
    });
  }, [
    authUser,
    activeRegistrationGroups,
    myRegistrations.length,
    pastRegistrationGroups,
  ]);

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

  const openEvents = useCallback(() => {
    router.push('/events');
  }, [router]);

  const openRegistrationGroup = useCallback((group: MyRegistrationGroup) => {
    router.push({
      pathname: '/profile/registration-groups/[eventId]',
      params: { eventId: group.eventId, period: selectedPeriod },
    });
  }, [router, selectedPeriod]);

  const hasActiveRegistrationGroups = activeRegistrationGroups.length > 0;
  const hasAnyRegistrationGroups = hasActiveRegistrationGroups || hasPastRegistrationGroups;
  const showInitialLoading = authUser && registrationsLoading && !hasAnyRegistrationGroups;
  const showBlockingError = authUser && Boolean(error) && !registrationsLoading && !hasAnyRegistrationGroups;
  const showInlineError = authUser && Boolean(error) && !registrationsLoading && hasAnyRegistrationGroups;
  const showEmpty = authUser && !registrationsLoading && !error && registrationGroups.length === 0;
  const showTabs = authUser && !showInitialLoading && !showBlockingError && hasAnyRegistrationGroups;
  const isPastTab = selectedPeriod === 'past';
  const emptyStateTitle = isPastTab
    ? 'У вас пока нет прошедших записей.'
    : 'У вас пока нет актуальных записей на ближайшие события.';

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
        <SubHeader title="Мои записи" subtitle="Ваши регистрации на события" />

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
              <Text style={styles.stateText}>Загружаем ваши записи...</Text>
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

        {showInlineError ? <Text style={styles.inlineErrorText}>{error}</Text> : null}

        {showTabs ? (
          <SegmentControl
            items={registrationTabs}
            value={registrationTab}
            onChange={setRegistrationTab}
          />
        ) : null}

        {showEmpty ? (
          <GlassCard>
            <View style={styles.stateCard}>
              <Ionicons name="calendar-clear-outline" size={24} color={colors.textDim} />
              <Text style={styles.stateTitle}>{emptyStateTitle}</Text>
              {!isPastTab ? (
                <PrimaryButton title="Посмотреть события" onPress={openEvents} />
              ) : null}
            </View>
          </GlassCard>
        ) : null}

        {authUser && !showInitialLoading && !showBlockingError && registrationGroups.length > 0 ? (
          <View style={styles.list}>
            {registrationGroups.map((group) => (
              <RegistrationGroupCard
                key={group.eventId}
                group={group}
                cancellingRegistrationId={cancellingRegistrationId}
                muted={isPastTab}
                onCancel={handleCancelRegistration}
                onOpen={openRegistrationGroup}
                showCancelAction={!isPastTab}
                showPastStatus={isPastTab}
              />
            ))}
          </View>
        ) : null}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 16,
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
  inlineErrorText: {
    color: colors.danger,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
});
