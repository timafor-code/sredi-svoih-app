import { Redirect, useLocalSearchParams } from 'expo-router';

import { decodeContactRouteId, getCommunityContactRoute } from '@/lib/contactRoutes';

const contactsRoute = '/contacts';

export default function LegacyContactDetailRoute() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const contactId = decodeContactRouteId(id);

  if (!contactId) {
    return <Redirect href={contactsRoute} />;
  }

  return <Redirect href={getCommunityContactRoute(contactId)} />;
}
