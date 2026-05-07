import type { BlessingItemTuple } from '@/types/blessing';

export const sevenSpeciesItems = [
  [
    'grapes',
    'Виноград',
    'seven_species_fruit',
    ['виноград', 'виноград свежий', 'grape', 'grapes', 'ענבים'],
    { category: 'seven_species', sourceRefs: ['Brachas.txt: Виноград'] },
  ],
  [
    'raisins',
    'Изюм',
    'seven_species_fruit',
    ['изюм', 'raisins', 'raisin'],
    { category: 'seven_species', sourceRefs: ['Brachas.txt: Изюм'] },
  ],
  [
    'fig',
    'Инжир',
    'seven_species_fruit',
    ['инжир', 'фига', 'fig', 'תאנה'],
    { category: 'seven_species', sourceRefs: ['Brachas.txt: Инжир'] },
  ],
  [
    'pomegranate',
    'Гранат',
    'seven_species_fruit',
    ['гранат', 'pomegranate', 'רמון', 'רימון'],
    { category: 'seven_species', sourceRefs: ['Brachas.txt: Гранат'] },
  ],
  [
    'olives',
    'Маслины / оливки',
    'seven_species_fruit',
    ['маслины', 'оливки', 'оливки маринованные', 'маслины соленые', 'olive', 'olives', 'זית'],
    { category: 'seven_species', sourceRefs: ['Brachas.txt: Маслины маринованные и соленые'] },
  ],
  ['dates', 'Финики', 'seven_species_fruit', ['финики', 'финик', 'date', 'dates', 'תמרים'], { category: 'seven_species', sourceRefs: ['Brachas.txt: Финик'] }],
] as const satisfies readonly BlessingItemTuple[];
