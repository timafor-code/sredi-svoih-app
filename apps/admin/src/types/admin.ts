import type { ReactNode } from "react";

import type { AdminRole } from "./auth";

export type { AdminRole } from "./auth";

export type AdminSection =
  | "overview"
  | "events"
  | "categories"
  | "import"
  | "registrations"
  | "members"
  | "invites"
  | "settings"
  | "contacts"
  | "notifications"
  | "media"
  | "prayer-schedule"
  | "reports"
  | "audit-log";

export type AdminBadgeTone =
  | "red"
  | "gold"
  | "green"
  | "blue"
  | "purple"
  | "muted"
  | "glass";

export type AdminBadge = {
  label: string;
  tone?: AdminBadgeTone;
};

export type NavigationItem = {
  section: AdminSection;
  label: string;
  icon: ReactNode;
  roles: AdminRole[];
  badge?: string;
  isFuture?: boolean;
};

export type NavigationGroup = {
  label: string;
  items: NavigationItem[];
};
