import type { BlessingItemTuple } from '@/types/blessing';

export const sevenSpeciesItems = [
  ['grapes', 'Виноград', 'seven_species_fruit', ['виноград', 'grapes', 'ענבים'], { category: 'seven_species' }],
  ['fig', 'Инжир', 'seven_species_fruit', ['инжир', 'фига', 'fig', 'תאנה']],
  [
    'pomegranate',
    'Гранат',
    'seven_species_fruit',
    ['гранат', 'pomegranate', 'רימון'],
    { category: 'seven_species' },
  ],
  ['olives', 'Оливки', 'seven_species_fruit', ['оливки', 'маслины', 'olives', 'זית'], { category: 'seven_species' }],
  ['dates', 'Финики', 'seven_species_fruit', ['финики', 'dates', 'תמר'], { category: 'seven_species' }],
] as const satisfies readonly BlessingItemTuple[];
