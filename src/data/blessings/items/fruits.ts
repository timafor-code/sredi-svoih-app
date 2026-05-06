import type { BlessingItemTuple } from '@/types/blessing';

export const fruitItems = [
  ['apple', 'Яблоко', 'tree_fruit_regular', ['яблоко', 'apple'], { category: 'fruits' }],
  ['pear', 'Груша', 'tree_fruit_regular', ['груша', 'pear'], { category: 'fruits' }],
  ['plum', 'Слива', 'tree_fruit_regular', ['слива', 'plum'], { category: 'fruits' }],
  ['peach', 'Персик', 'tree_fruit_regular', ['персик', 'peach'], { category: 'fruits' }],
  ['orange', 'Апельсин', 'tree_fruit_regular', ['апельсин', 'orange'], { category: 'fruits' }],
] as const satisfies readonly BlessingItemTuple[];
