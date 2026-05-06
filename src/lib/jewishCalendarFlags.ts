import { HDate, HebrewCalendar, flags as hebcalFlags } from '@hebcal/core';
import type { Event } from '@hebcal/core';

import type { JewishCalendarFlag } from '@/types/blessing';

const CALENDAR_FLAG_ORDER: readonly JewishCalendarFlag[] = [
  'hanukkah',
  'purim',
  'rosh_chodesh',
  'chol_hamoed_pesach',
  'chol_hamoed_sukkot',
];

const PURIM_BASENAMES = new Set(['Purim', 'Shushan Purim']);

function getEventFlags(event: Event): number {
  try {
    const eventFlags = event.getFlags();
    return Number.isFinite(eventFlags) ? eventFlags : 0;
  } catch {
    return 0;
  }
}

function getEventBasename(event: Event): string {
  try {
    const basename = event.basename();
    if (typeof basename === 'string') return basename;
  } catch {
    // Fall through to the raw description below.
  }

  try {
    const desc = event.getDesc();
    return typeof desc === 'string' ? desc : '';
  } catch {
    return '';
  }
}

function addCalendarFlag(target: Set<JewishCalendarFlag>, event: Event) {
  const eventFlags = getEventFlags(event);
  const basename = getEventBasename(event);

  if (basename === 'Chanukah') {
    target.add('hanukkah');
  }

  if (PURIM_BASENAMES.has(basename)) {
    target.add('purim');
  }

  if ((eventFlags & hebcalFlags.ROSH_CHODESH) !== 0) {
    target.add('rosh_chodesh');
  }

  if ((eventFlags & hebcalFlags.CHOL_HAMOED) === 0) {
    return;
  }

  if (basename === 'Pesach') {
    target.add('chol_hamoed_pesach');
  }

  if (basename === 'Sukkot') {
    target.add('chol_hamoed_sukkot');
  }
}

export function resolveJewishCalendarFlags(date: Date = new Date()): JewishCalendarFlag[] {
  const resolvedFlags = new Set<JewishCalendarFlag>();

  try {
    const hdate = new HDate(date);
    const events: unknown = HebrewCalendar.calendar({ start: hdate, end: hdate });

    if (!Array.isArray(events)) {
      return [];
    }

    for (const event of events) {
      addCalendarFlag(resolvedFlags, event as Event);
    }
  } catch {
    return [];
  }

  return CALENDAR_FLAG_ORDER.filter((flag) => resolvedFlags.has(flag));
}

export function hasJewishCalendarFlag(
  flags: readonly JewishCalendarFlag[],
  flag: JewishCalendarFlag,
): boolean {
  return flags.includes(flag);
}
