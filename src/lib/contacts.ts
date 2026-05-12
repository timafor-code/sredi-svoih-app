import * as Contacts from 'expo-contacts';

export async function requestContactsPermission() {
  const { status } = await Contacts.requestPermissionsAsync();
  return status === 'granted';
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
