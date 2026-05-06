import type { BlessingDispute } from '@/types/blessing';

export const blessingDisputes = [
  {
    key: 'rice_case',
    titleRu: 'Рис',
    descriptionRu: 'Для риса есть особые правила и практические различия. В MVP помечаем как условный случай.',
    severity: 'ask_rav',
    needsVerification: true,
  },
  {
    key: 'pasta_case',
    titleRu: 'Паста',
    descriptionRu: 'Паста может зависеть от состава, способа приготовления и трапезного контекста.',
    severity: 'ask_rav',
    needsVerification: true,
  },
  {
    key: 'pizza_case',
    titleRu: 'Пицца',
    descriptionRu: 'Пицца зависит от теста, начинки, количества и того, считается ли это трапезой.',
    severity: 'ask_rav',
    needsVerification: true,
  },
] as const satisfies readonly BlessingDispute[];
