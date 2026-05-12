import type { Href } from 'expo-router';

function encodeRouteId(id: string) {
  return encodeURIComponent(id);
}

export function decodeContactRouteId(id?: string | string[]) {
  const value = Array.isArray(id) ? id[0] : id;
  if (!value) return '';

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function getCommunityContactRoute(id: string): Href {
  return `/contacts/community/${encodeRouteId(id)}` as Href;
}

export function getIphoneContactRoute(id: string): Href {
  return `/contacts/iphone/${encodeRouteId(id)}` as Href;
}
