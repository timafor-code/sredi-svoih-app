import type { AdminSection, AdminBadge } from "../types/admin";

export const mockEvents: Array<{
  title: string;
  date: string;
  category: string;
  badges: AdminBadge[];
}> = [
  {
    title: "История Иерусалимского Храма",
    date: "6 мая, 19:00",
    category: "Лекция",
    badges: [
      { label: "Опубликовано", tone: "green" },
      { label: "Для участников", tone: "purple" },
    ],
  },
  {
    title: "Шаббат среди своих",
    date: "Пятница, 18:30",
    category: "Шаббат",
    badges: [
      { label: "Черновик", tone: "gold" },
      { label: "₽ Варианты", tone: "blue" },
    ],
  },
  {
    title: "Песах в общине",
    date: "Апрель 2026",
    category: "Праздник",
    badges: [
      { label: "Черновик", tone: "gold" },
      { label: "Для участников", tone: "purple" },
      { label: "₽ Варианты", tone: "blue" },
    ],
  },
];

export const importReviewItems = [
  {
    title: "Неполная дата",
    source: "Шаббат среди своих",
    detail: "В тексте найдено время, но не найден календарный день.",
    tone: "gold",
  },
  {
    title: "Повторяющееся событие",
    source: "Детская воскресная школа",
    detail: "Нужно выбрать правило повторения перед созданием события.",
    tone: "blue",
  },
  {
    title: "Дата не найдена",
    source: "Встреча общины",
    detail: "Элемент останется в review-очереди до ручной проверки.",
    tone: "red",
  },
] as const;

export const registrationPreview = {
  eventTitle: "Шаббат среди своих",
  person: "Анна Левина",
  status: "Pending",
  options: [
    "Вечерняя трапеза × 2",
    "Подарить Шаббат нуждающемуся × 1",
    "Итого 8000 ₽",
    "Мест: 2",
  ],
};

export const mockMembers = [
  {
    name: "Алексей Р.",
    email: "admin@sredisvoih.example",
    role: "admin",
    status: "Администратор",
  },
  {
    name: "Мария К.",
    email: "events@sredisvoih.example",
    role: "event_manager",
    status: "Менеджер событий",
  },
  {
    name: "Давид Н.",
    email: "member@sredisvoih.example",
    role: "member",
    status: "Участник",
  },
] as const;

export const mockInvites = [
  {
    code: "DEV-SREDI-2026",
    role: "event_manager",
    usage: "2 из 10",
  },
  {
    code: "TOUR-MAY-2026",
    role: "member",
    usage: "5 из 25",
  },
] as const;

export const communitySettings = [
  {
    label: "Название",
    value: "Среди Своих",
  },
  {
    label: "Timezone",
    value: "Europe/Moscow",
  },
  {
    label: "Адрес по умолчанию",
    value: "Москва, общинный центр",
  },
] as const;

export const futureFeatures: Partial<Record<AdminSection, string[]>> = {
  contacts: ["Раввин и администратор", "Координатор событий", "WhatsApp / Telegram", "Телефон и адрес общины"],
  notifications: ["Объявления участникам", "Push-уведомления", "Рассылки по записавшимся", "Напоминания о событиях"],
  media: ["Афиши событий", "Логотип общины", "Загрузка изображений", "Медиатека"],
  "prayer-schedule": ["Расписание миньянов", "Шаббат и праздники", "Особые дни", "Зманим по городу"],
  reports: ["Посещаемость событий", "Регистрации по периодам", "Рост участников", "Сборы по вариантам участия"],
  "audit-log": ["Кто создал событие", "Кто изменил дату", "Кто подтвердил регистрацию", "Кто изменил роль участника"],
};
