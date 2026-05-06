import type { BlessingItemTuple } from '@/types/blessing';

export const sweetItems = [
  ['candy', 'Конфета', 'shehakol_regular', ['конфета', 'конфеты', 'candy'], { category: 'sweets' }],
  ['chocolate', 'Шоколад', 'shehakol_regular', ['шоколад', 'chocolate'], { category: 'sweets', needsVerification: true }],
  ['ice_cream', 'Мороженое', 'shehakol_regular', ['мороженое', 'ice cream'], { category: 'sweets' }],
  ['honey', 'Мед', 'shehakol_regular', ['мед', 'мёд', 'honey', 'דבש'], { category: 'sweets', needsVerification: true }],
  [
    'jam',
    'Варенье',
    'conditional',
    ['варенье', 'джем', 'jam'],
    {
      category: 'sweets',
      complexity: 'conditional',
      conditionKeys: ['fruit_processed_case'],
      disputeKeys: ['processed_fruit_case'],
      needsVerification: true,
    },
  ],
  [
    'chewing_gum',
    'Жевательная резинка',
    'shehakol_regular',
    ['жвачка', 'жевательная резинка', 'chewing gum', 'gum'],
    {
      category: 'sweets',
      complexity: 'conditional',
      conditionKeys: ['depends_on_form_of_food'],
      needsVerification: true,
    },
  ],
  ['lollipop', 'Леденец на палочке', 'shehakol_regular', ['леденец', 'чупа-чупс', 'lollipop'], { category: 'sweets' }],
  ['hard_candy', 'Леденец', 'shehakol_regular', ['карамель', 'леденцы', 'hard candy'], { category: 'sweets' }],
  [
    'cake_pop',
    'Кейк-поп',
    'conditional',
    ['кейк поп', 'кейк-поп', 'cake pop'],
    {
      category: 'sweets',
      complexity: 'conditional',
      conditionKeys: ['depends_on_grain_content', 'depends_on_main_ingredient'],
      disputeKeys: ['bread_like_pastry_case'],
      needsVerification: true,
    },
  ],
  ['pudding', 'Пудинг', 'shehakol_regular', ['пудинг', 'pudding'], { category: 'sweets', needsVerification: true }],
  ['jelly', 'Желе', 'shehakol_regular', ['желе', 'jelly', 'gelatin dessert'], { category: 'sweets', needsVerification: true }],
  [
    'halva',
    'Халва',
    'conditional',
    ['халва', 'halva', 'חלבה'],
    {
      category: 'sweets',
      complexity: 'conditional',
      conditionKeys: ['depends_on_main_ingredient', 'depends_on_grain_content'],
      needsVerification: true,
    },
  ],
  ['marshmallow', 'Маршмеллоу', 'shehakol_regular', ['маршмеллоу', 'зефир', 'marshmallow'], { category: 'sweets', needsVerification: true }],
  ['popsicle', 'Фруктовый лед', 'shehakol_regular', ['фруктовый лед', 'эскимо лед', 'popsicle', 'ice pop'], { category: 'sweets', needsVerification: true }],
] as const satisfies readonly BlessingItemTuple[];
