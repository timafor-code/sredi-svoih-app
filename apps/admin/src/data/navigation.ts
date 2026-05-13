import type { AdminRole, AdminSection, NavigationGroup, NavigationItem } from "../types/admin";

export const adminRoles: AdminRole[] = ["admin", "event_manager", "member"];

export const navigationGroups: NavigationGroup[] = [
  {
    label: "Основные",
    items: [
      {
        section: "overview",
        label: "Обзор",
        icon: "⬡",
        roles: ["admin", "event_manager"],
      },
      {
        section: "events",
        label: "События",
        icon: "◈",
        roles: ["admin", "event_manager"],
      },
      {
        section: "categories",
        label: "Категории",
        icon: "◉",
        roles: ["admin", "event_manager"],
      },
      {
        section: "import",
        label: "Импорт с сайта",
        icon: "⟳",
        roles: ["admin", "event_manager"],
      },
      {
        section: "registrations",
        label: "Регистрации",
        icon: "✓",
        roles: ["admin", "event_manager"],
      },
      {
        section: "members",
        label: "Участники",
        icon: "◎",
        roles: ["admin"],
      },
      {
        section: "invites",
        label: "Приглашения",
        icon: "◇",
        roles: ["admin"],
      },
      {
        section: "settings",
        label: "Настройки",
        icon: "⚙",
        roles: ["admin"],
      },
    ],
  },
  {
    label: "Позже",
    items: [
      {
        section: "contacts",
        label: "Контакты общины",
        icon: "◎",
        roles: ["admin", "event_manager"],
        isFuture: true,
      },
      {
        section: "notifications",
        label: "Уведомления",
        icon: "◌",
        roles: ["admin", "event_manager"],
        isFuture: true,
      },
      {
        section: "media",
        label: "Медиа",
        icon: "◻",
        roles: ["admin", "event_manager"],
        isFuture: true,
      },
      {
        section: "prayer-schedule",
        label: "Расписание молитв",
        icon: "✦",
        roles: ["admin", "event_manager"],
        isFuture: true,
      },
      {
        section: "reports",
        label: "Отчёты",
        icon: "◈",
        roles: ["admin", "event_manager"],
        isFuture: true,
      },
      {
        section: "audit-log",
        label: "Журнал действий",
        icon: "⊞",
        roles: ["admin", "event_manager"],
        isFuture: true,
      },
    ],
  },
];

export const navigationItems = navigationGroups.flatMap((group) => group.items);

export function getSectionTitle(section: AdminSection): string {
  return navigationItems.find((item) => item.section === section)?.label ?? "Admin Center";
}

export function canRoleOpenSection(role: AdminRole, section: AdminSection): boolean {
  if (role === "member") {
    return false;
  }

  const item = navigationItems.find((candidate) => candidate.section === section);
  return Boolean(item?.roles.includes(role));
}

export function isFutureSection(section: AdminSection): boolean {
  return Boolean(navigationItems.find((item) => item.section === section)?.isFuture);
}

export function getVisibleNavigationGroups(role: AdminRole): NavigationGroup[] {
  if (role === "member") {
    return [];
  }

  return navigationGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.roles.includes(role)),
    }))
    .filter((group) => group.items.length > 0);
}

export function getNavigationItem(section: AdminSection): NavigationItem | undefined {
  return navigationItems.find((item) => item.section === section);
}
