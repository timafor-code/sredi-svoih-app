import { HDate } from '@hebcal/core';

export function getHebrewDateLabel(date = new Date()) {
  try {
    return new HDate(date).renderGematriya();
  } catch {
    return '23 Нисана 5785';
  }
}

export function getWeeklyParshaMock() {
  return { ru: 'Ахарей Мот', he: 'אחרי מות' };
}

export function getOmerInfoMock() {
  return { day: 8, sefirah: 'Хесед ше-бе-Гвура' };
}
