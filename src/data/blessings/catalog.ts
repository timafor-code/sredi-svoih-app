import type { BlessingCatalog, BlessingItemTuple } from '@/types/blessing';
import { blessings } from './blessings';
import { blessingConditions } from './conditions';
import { blessingDisputes } from './disputes';
import { blessingPatterns } from './patterns';
import { bakedGoodItems } from './items/bakedGoods';
import { cerealItems } from './items/cereals';
import { drinkItems } from './items/drinks';
import { fruitItems } from './items/fruits';
import { grainItems } from './items/grains';
import { preparedFoodItems } from './items/preparedFoods';
import { sevenSpeciesItems } from './items/sevenSpecies';
import { sweetItems } from './items/sweets';
import { vegetableItems } from './items/vegetables';

export const blessingItems = [
  ...sevenSpeciesItems,
  ...fruitItems,
  ...vegetableItems,
  ...grainItems,
  ...bakedGoodItems,
  ...cerealItems,
  ...drinkItems,
  ...preparedFoodItems,
  ...sweetItems,
] as const satisfies readonly BlessingItemTuple[];

export const blessingsCatalog = {
  meta: {
    defaultPsak: 'chabad_alter_rebbe',
  },
  blessings,
  patterns: blessingPatterns,
  conditions: blessingConditions,
  disputes: blessingDisputes,
  items: blessingItems,
} as const satisfies BlessingCatalog;
