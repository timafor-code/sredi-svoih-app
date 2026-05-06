import type { BlessingItemTuple } from '@/types/blessing';

export const sevenSpeciesItems = [
  [
    'grapes',
    'Виноград',
    'seven_species_fruit',
    ['виноград', 'виноград свежий', 'grape', 'grapes', 'ענבים'],
    { category: 'seven_species' },
  ],
  ['fig', 'Инжир', 'seven_species_fruit', ['инжир', 'фига', 'fig', 'תאנה'], { category: 'seven_species' }],
  [
    'pomegranate',
    'Гранат',
    'seven_species_fruit',
    ['гранат', 'pomegranate', 'רמון', 'רימון'],
    { category: 'seven_species' },
  ],
  ['olives', 'Оливки', 'seven_species_fruit', ['оливки', 'маслины', 'olive', 'olives', 'זית'], { category: 'seven_species' }],
  ['dates', 'Финики', 'seven_species_fruit', ['финики', 'финик', 'date', 'dates', 'תמרים'], { category: 'seven_species' }],
] as const satisfies readonly BlessingItemTuple[];
