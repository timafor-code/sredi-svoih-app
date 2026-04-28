import { Redirect } from 'expo-router';
import type { Href } from 'expo-router';

const myRegistrationsHref = '/profile/my-registrations' as Href;

export default function MyEventsScreen() {
  return <Redirect href={myRegistrationsHref} />;
}
