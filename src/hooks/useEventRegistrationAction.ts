import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Linking } from 'react-native';

import { useAuthStore } from '@/store/useAuthStore';
import { isActiveEventRegistration, useEventsStore } from '@/store/useEventsStore';
import type { EventItem, EventRegistration, EventRegistrationStatus } from '@/types/event';

type EventActionTarget = Pick<EventItem, 'id' | 'registrationMode' | 'registrationUrl'>;

export function getRegistrationStatusTitle(status: EventRegistrationStatus): string {
  switch (status) {
    case 'confirmed':
      return 'Вы записаны';
    case 'pending':
      return 'Заявка отправлена';
    case 'waitlisted':
      return 'Вы в листе ожидания';
    case 'cancelled':
      return 'Запись отменена';
    case 'rejected':
      return 'Заявка отклонена';
    case 'attended':
      return 'Вы посетили событие';
    case 'no_show':
      return 'Не посетили';
    default:
      return 'Записаться';
  }
}

export function getEventRegistrationActionTitle(
  event: EventActionTarget,
  registration: EventRegistration | null,
  registering: boolean,
): string {
  if (registering) {
    return 'Записываем...';
  }

  switch (event.registrationMode) {
    case 'none':
      return 'Регистрация не нужна';
    case 'external_link':
      return 'Открыть регистрацию';
    case 'internal_paid':
      return 'Зарегистрироваться';
    case 'internal_free':
      return registration && isActiveEventRegistration(registration)
        ? getRegistrationStatusTitle(registration.status)
        : 'Записаться';
    default:
      return 'Регистрация недоступна';
  }
}

function showActionError(error: unknown) {
  const message = error instanceof Error ? error.message : '';

  if (message === 'Auth required' || message.includes('Нужен вход')) {
    Alert.alert('Нужен вход', 'Чтобы записаться на событие, войдите в приложение.');
    return;
  }

  if (
    message.includes('Вы уже записаны на этот сеанс')
  ) {
    Alert.alert('Вы уже записаны', 'Вы уже записаны на этот сеанс.');
    return;
  }

  if (
    message.includes('Вы уже записаны')
    || message.includes('duplicate key')
    || message.includes('event_registrations_event_id_user_id_key')
  ) {
    Alert.alert('Вы уже записаны', 'Вы уже записаны на это событие.');
    return;
  }

  Alert.alert(
    'Не удалось выполнить действие',
    'Проверьте подключение и попробуйте еще раз.',
  );
}

export function useEventRegistrationAction() {
  const router = useRouter();
  const authUser = useAuthStore((state) => state.user);
  const registerForEvent = useEventsStore((state) => state.registerForEvent);
  const cancelRegistration = useEventsStore((state) => state.cancelRegistration);
  const loadMyRegistrations = useEventsStore((state) => state.loadMyRegistrations);
  const [registeringEventId, setRegisteringEventId] = useState<string | null>(null);
  const [cancellingRegistrationId, setCancellingRegistrationId] = useState<string | null>(null);

  const handleRegistrationAction = useCallback(async (
    event: EventActionTarget,
    registration: EventRegistration | null,
  ) => {
    switch (event.registrationMode) {
      case 'none':
        Alert.alert('Регистрация не требуется');
        return;

      case 'external_link':
        if (!event.registrationUrl) {
          Alert.alert('Ссылка регистрации недоступна', 'У события пока нет ссылки для регистрации.');
          return;
        }

        try {
          await Linking.openURL(event.registrationUrl);
        } catch (error) {
          Alert.alert(
            'Не удалось открыть ссылку',
            error instanceof Error ? error.message : 'Попробуйте открыть регистрацию позже.',
          );
        }
        return;

      case 'internal_free':
        if (!authUser) {
          Alert.alert('Нужен вход', 'Чтобы записаться на событие, войдите в приложение.');
          return;
        }

        if (registration && isActiveEventRegistration(registration)) {
          Alert.alert('Вы уже записаны', 'Вы уже записаны на это событие.');
          return;
        }

        setRegisteringEventId(event.id);

        try {
          await registerForEvent(event.id);
          void loadMyRegistrations().catch(() => undefined);
          Alert.alert('Вы записаны', 'Регистрация на событие создана.');
        } catch (error) {
          showActionError(error);
        } finally {
          setRegisteringEventId(null);
        }
        return;

      case 'internal_paid':
        router.push({ pathname: '/events/register/[id]', params: { id: event.id } });
        return;

      default:
        Alert.alert('Регистрация недоступна');
    }
  }, [authUser, loadMyRegistrations, registerForEvent, router]);

  const handleCancelRegistration = useCallback((registration: EventRegistration) => {
    Alert.alert(
      'Отменить запись?',
      'Вы сможете записаться заново, если места еще будут доступны.',
      [
        { text: 'Оставить', style: 'cancel' },
        {
          text: 'Отменить запись',
          style: 'destructive',
          onPress: () => {
            async function cancelCurrentRegistration() {
              setCancellingRegistrationId(registration.id);

              try {
                await cancelRegistration(registration.id);
                void loadMyRegistrations().catch(() => undefined);
                Alert.alert('Запись отменена', 'Вы больше не записаны на это событие.');
              } catch (error) {
                showActionError(error);
              } finally {
                setCancellingRegistrationId(null);
              }
            }

            void cancelCurrentRegistration();
          },
        },
      ],
    );
  }, [cancelRegistration, loadMyRegistrations]);

  return {
    cancellingRegistrationId,
    handleCancelRegistration,
    handleRegistrationAction,
    registeringEventId,
  };
}
