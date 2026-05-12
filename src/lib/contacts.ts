import * as Contacts from 'expo-contacts';
import type { ContactsPermissionResponse } from 'expo-contacts';

import type { LocalContactsPermissionStatus } from '@/types/contact';

function toLocalContactsPermissionStatus(permission: ContactsPermissionResponse): LocalContactsPermissionStatus {
  if (permission.status === 'granted') {
    return permission.accessPrivileges === 'limited' ? 'limited' : 'granted';
  }

  return 'denied';
}

export async function requestContactsPermissionStatus(): Promise<LocalContactsPermissionStatus> {
  try {
    return toLocalContactsPermissionStatus(await Contacts.requestPermissionsAsync());
  } catch {
    return 'error';
  }
}

export async function requestContactsPermission() {
  return (await requestContactsPermissionStatus()) === 'granted';
}

export async function readContactsLocalOnly() {
  const granted = await requestContactsPermission();
  if (!granted) return [];
  return readContactsLocalOnlyGranted();
}

export async function readContactsLocalOnlyGranted() {
  const res = await Contacts.getContactsAsync({ fields: [Contacts.Fields.Birthday, Contacts.Fields.PhoneNumbers] });
  return res.data;
}
