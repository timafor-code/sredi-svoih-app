import type { BlessingCondition } from '@/types/blessing';

export const blessingConditions = [
  {
    key: 'after_blessing_if_required_amount',
    titleRu: 'Послеблагословение при нужном количестве',
    descriptionRu: 'Показывать напоминание, что послеблагословение зависит от количества и времени еды.',
    needsVerification: true,
  },
  {
    key: 'kazayit_within_time',
    titleRu: 'Казайт за установленное время',
    descriptionRu: 'Послеблагословение зависит от того, был ли съеден казайт за нужный промежуток времени.',
    needsVerification: true,
  },
  {
    key: 'reviit_within_time',
    titleRu: 'Ревиит за установленное время',
    descriptionRu: 'Послеблагословение на напиток зависит от объема и скорости питья.',
    needsVerification: true,
  },
  {
    key: 'drink_for_benefit',
    titleRu: 'Напиток для удовольствия',
    descriptionRu: 'Перед благословением важно понять, пьет ли человек для удовольствия или по иной причине.',
    needsVerification: true,
  },
  {
    key: 'ask_rav_mixed_food',
    titleRu: 'Смешанный или условный продукт',
    descriptionRu: 'Для MVP показываем сценарий как условный и рекомендуем уточнить у раввина.',
    needsVerification: true,
  },
] as const satisfies readonly BlessingCondition[];
