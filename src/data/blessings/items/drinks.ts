import type { BlessingItemTuple } from '@/types/blessing';

export const drinkItems = [
  ['water', 'Вода', 'drink_shehakol', ['вода', 'water'], { category: 'drinks' }],
  ['tea', 'Чай', 'drink_shehakol', ['чай', 'tea'], { category: 'drinks' }],
  ['coffee', 'Кофе', 'drink_shehakol', ['кофе', 'coffee'], { category: 'drinks' }],
  ['wine', 'Вино', 'wine_grape', ['вино', 'wine', 'יין'], { category: 'drinks' }],
  ['grape_juice', 'Виноградный сок', 'wine_grape', ['виноградный сок', 'grape juice'], { category: 'drinks' }],
] as const satisfies readonly BlessingItemTuple[];
