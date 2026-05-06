import type { BlessingItemTuple } from '@/types/blessing';

export const vegetableItems = [
  ['potato', 'Картофель', 'ground_fruit_regular', ['картофель', 'картошка', 'potato'], { category: 'vegetables' }],
  ['carrot', 'Морковь', 'ground_fruit_regular', ['морковь', 'carrot'], { category: 'vegetables' }],
  ['cucumber', 'Огурец', 'ground_fruit_regular', ['огурец', 'cucumber'], { category: 'vegetables' }],
  ['tomato', 'Помидор', 'ground_fruit_regular', ['помидор', 'томат', 'tomato'], { category: 'vegetables' }],
  ['onion', 'Лук', 'ground_fruit_regular', ['лук', 'onion'], { category: 'vegetables' }],
] as const satisfies readonly BlessingItemTuple[];
