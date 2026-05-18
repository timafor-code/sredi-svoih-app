import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { RegistrationGroupCard } from '@/components/events/MyRegistrationCards';
import { GlassCard } from '@/components/glass/GlassCard';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { SubHeader } from '@/components/ui/SubHeader';
import { useEventRegistrationAction } from '@/hooks/useEventRegistrationAction';
import {
  buildMyRegistrationGroups,
  type MyRegistrationGroup,
} from '@/lib/registrationGroups';
import { useAuthStore } from '@/store/useAuthStore';
import { useEventsStore } from '@/store/useEventsStore';
import { colors } from '@/theme/colors';

const MY_REGISTRATIONS_DEBUG_TAG = '[mobile registrations]';
const MY_REGISTRATIONS_DEBUG_EVENT_TITLE = 'Шаббат открыто';

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
  const registrationGroups = activeRegistrationGroups;
  const hasPastRegistrationGroups = pastRegistrationGroups.length > 0;

  useEffect(() => {
    if (!__DEV__ || !authUser) {
      return;
    }

    const debugGroup = registrationGroups.find((group) => (
      group.event?.title === MY_REGISTRATIONS_DEBUG_EVENT_TITLE
    ));

    console.info(`${MY_REGISTRATIONS_DEBUG_TAG} my-registrations groups`, {
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? null,
      authUser: {
        id: authUser.id,
        email: authUser.email ?? null,
      },
      sourceRegistrationsCount: myRegistrations.length,
      activeGroupsCount: registrationGroups.length,
      pastGroupsCount: pastRegistrationGroups.length,
      activeRegistrationRowsAfterBuildMyRegistrationGroups: registrationGroups.reduce(
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
    myRegistrations.length,
    pastRegistrationGroups,
    registrationGroups,
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

  const openPastRegistrations = useCallback(() => {
    router.push('/profile/past-registrations');
  }, [router]);

  const openRegistrationGroup = useCallback((group: MyRegistrationGroup) => {
    router.push({
      pathname: '/profile/registration-groups/[eventId]',
      params: { eventId: group.eventId, period: 'active' },
    });
  }, [router]);

  const hasAnyRegistrationGroups = registrationGroups.length > 0 || hasPastRegistrationGroups;
  const showInitialLoading = authUser && registrationsLoading && !hasAnyRegistrationGroups;
  const showBlockingError = authUser && Boolean(error) && !registrationsLoading && !hasAnyRegistrationGroups;
  const showInlineError = authUser && Boolean(error) && !registrationsLoading && hasAnyRegistrationGroups;
  const showEmpty = authUser && !registrationsLoading && !error && registrationGroups.length === 0;

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

        {showEmpty ? (
          <GlassCard>
            <View style={styles.stateCard}>
              <Ionicons name="calendar-clear-outline" size={24} color={colors.textDim} />
              <Text style={styles.stateTitle}>У вас пока нет активных записей на ближайшие события.</Text>
              <PrimaryButton title="Посмотреть события" onPress={openEvents} />
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
                onCancel={handleCancelRegistration}
                onOpen={openRegistrationGroup}
              />
            ))}
          </View>
        ) : null}

        {authUser && !showInitialLoading && !showBlockingError && hasPastRegistrationGroups ? (
          <GlassCard>
            <Pressable
              onPress={openPastRegistrations}
              style={({ pressed }) => [styles.pastLink, pressed && styles.pressed]}
            >
              <View style={styles.pastLinkIcon}>
                <Ionicons name="time-outline" size={20} color={colors.orange} />
              </View>
              <View style={styles.pastLinkTextBlock}>
                <Text style={styles.pastLinkTitle}>Прошедшие события</Text>
                <Text style={styles.pastLinkSubtitle}>
                  Посмотреть записи на события, которые уже прошли
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.36)" />
            </Pressable>
          </GlassCard>
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
  pastLink: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  pastLinkIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent.orangeBg,
    borderWidth: 1,
    borderColor: colors.accent.orangeBorder,
  },
  pastLinkTextBlock: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  pastLinkTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 20,
  },
  pastLinkSubtitle: {
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.78,
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
