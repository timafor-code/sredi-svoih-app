import type { BlessingItemTuple } from '@/types/blessing';

export const sweetItems = [
  ['candy', 'Конфета', 'shehakol_regular', ['конфета', 'конфеты', 'candy'], { category: 'sweets' }],
  ['chocolate', 'Шоколад', 'shehakol_regular', ['шоколад', 'chocolate'], { category: 'sweets', needsVerification: true }],
  ['ice_cream', 'Мороженое', 'shehakol_regular', ['мороженое', 'ice cream'], { category: 'sweets' }],
] as const satisfies readonly BlessingItemTuple[];
