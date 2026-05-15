import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
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
import { SubHeader } from '@/components/ui/SubHeader';
import { useEventRegistrationAction } from '@/hooks/useEventRegistrationAction';
import {
  buildMyRegistrationGroups,
  type MyRegistrationGroup,
} from '@/lib/registrationGroups';
import { useAuthStore } from '@/store/useAuthStore';
import { useEventsStore } from '@/store/useEventsStore';
import { colors } from '@/theme/colors';

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

  const registrationGroups = useMemo(
    () => buildMyRegistrationGroups(myRegistrations),
    [myRegistrations],
  );

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
    if (group.totalRegistrationsCount === 1 && group.event?.id) {
      router.push({ pathname: '/events/[id]', params: { id: group.event.id } });
      return;
    }

    router.push({
      pathname: '/profile/registration-groups/[eventId]',
      params: { eventId: group.eventId },
    });
  }, [router]);

  const showInitialLoading = authUser && registrationsLoading && registrationGroups.length === 0;
  const showBlockingError = authUser && Boolean(error) && !registrationsLoading && registrationGroups.length === 0;
  const showInlineError = authUser && Boolean(error) && !registrationsLoading && registrationGroups.length > 0;
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
              <Text style={styles.stateTitle}>У вас пока нет записей на события.</Text>
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
