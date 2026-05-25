import * as Notifications from 'expo-notifications';

export type NotificationPermissionStatus = 'granted' | 'denied' | 'undetermined' | 'unknown';

export type ScheduleTestLocalNotificationResult = {
  error?: string;
  notificationId?: string;
  ok: boolean;
  permissionStatus: NotificationPermissionStatus;
};

export type CancelLocalNotificationsResult = {
  error?: string;
  ok: boolean;
};

function normalizeNotificationPermissionStatus(status: unknown): NotificationPermissionStatus {
  if (typeof status !== 'string') {
    return 'unknown';
  }

  switch (status.toLowerCase()) {
    case 'granted':
      return 'granted';
    case 'denied':
      return 'denied';
    case 'undetermined':
      return 'undetermined';
    default:
      return 'unknown';
  }
}

export async function getNotificationPermissionStatus(): Promise<NotificationPermissionStatus> {
  try {
    if (typeof Notifications.getPermissionsAsync !== 'function') {
      return 'unknown';
    }

    const permission = await Notifications.getPermissionsAsync();
    return normalizeNotificationPermissionStatus(permission?.status);
  } catch {
    return 'unknown';
  }
}

export async function requestNotificationPermissions(): Promise<NotificationPermissionStatus> {
  try {
    if (typeof Notifications.requestPermissionsAsync !== 'function') {
      return 'unknown';
    }

    const permission = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: false,
        allowSound: false,
      },
    });

    return normalizeNotificationPermissionStatus(permission?.status);
  } catch {
    return 'unknown';
  }
}

export async function scheduleTestLocalNotification(): Promise<ScheduleTestLocalNotificationResult> {
  const permissionStatus = await getNotificationPermissionStatus();

  if (permissionStatus !== 'granted') {
    return {
      error: 'notifications_permission_not_granted',
      ok: false,
      permissionStatus,
    };
  }

  try {
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Среди Своих',
        body: 'Тестовое локальное уведомление',
        data: {
          source: 'notifications-local-permission-foundation',
          type: 'test-local-notification',
        },
        sound: false,
      },
      trigger: null,
    });

    return {
      notificationId,
      ok: true,
      permissionStatus,
    };
  } catch {
    return {
      error: 'notifications_schedule_failed',
      ok: false,
      permissionStatus,
    };
  }
}

export async function cancelAllLocalNotifications(): Promise<CancelLocalNotificationsResult> {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
    return { ok: true };
  } catch {
    return {
      error: 'notifications_cancel_failed',
      ok: false,
    };
  }
}
