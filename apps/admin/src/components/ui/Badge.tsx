import type { ReactNode } from "react";

import type { AdminBadgeTone } from "../../types/admin";

type BadgeProps = {
  children: ReactNode;
  tone?: AdminBadgeTone;
};

export function Badge({ children, tone = "glass" }: BadgeProps) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}
