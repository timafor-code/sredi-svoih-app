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
  {
    key: 'depends_on_main_ingredient',
    titleRu: 'Зависит от основного ингредиента',
    descriptionRu: 'Для смешанных блюд нужно знать, какой ингредиент главный и ради чего едят остальные компоненты.',
    needsVerification: true,
  },
  {
    key: 'depends_on_preparation',
    titleRu: 'Зависит от приготовления',
    descriptionRu: 'Благословение может зависеть от того, продукт сырой, вареный, жареный, запеченный или сильно обработанный.',
    needsVerification: true,
  },
  {
    key: 'depends_on_grain_content',
    titleRu: 'Зависит от содержания злаков',
    descriptionRu: 'Если в составе есть злаки или мука, нужно учитывать их вид, количество и роль в продукте.',
    needsVerification: true,
  },
  {
    key: 'depends_on_form_of_food',
    titleRu: 'Зависит от формы продукта',
    descriptionRu: 'Цельный продукт, сок, пюре, паста или мелкая смесь могут рассматриваться по-разному.',
    needsVerification: true,
  },
  {
    key: 'mixed_food_primary_ingredient',
    titleRu: 'Главный ингредиент в смеси',
    descriptionRu: 'В смеси нужно определить основной компонент; без этого MVP не делает окончательный вывод.',
    needsVerification: true,
  },
  {
    key: 'bread_like_dough_case',
    titleRu: 'Хлебное или похожее тесто',
    descriptionRu: 'Для изделий из теста важны состав, способ выпечки, сладость, начинка и трапезный контекст.',
    needsVerification: true,
  },
  {
    key: 'cooked_grain_case',
    titleRu: 'Вареная крупа или каша',
    descriptionRu: 'Для каш и вареных круп благословение зависит от вида зерна, консистенции и способа приготовления.',
    needsVerification: true,
  },
  {
    key: 'fruit_processed_case',
    titleRu: 'Обработанный фрукт',
    descriptionRu: 'Для сока, джема, пюре, смузи или нарезанной смеси нужно учитывать форму и узнаваемость фрукта.',
    needsVerification: true,
  },
  {
    key: 'drink_thick_smoothie_case',
    titleRu: 'Густой напиток или смузи',
    descriptionRu: 'Смузи может зависеть от густоты, способа употребления и того, что является главным ингредиентом.',
    needsVerification: true,
  },
] as const satisfies readonly BlessingCondition[];
