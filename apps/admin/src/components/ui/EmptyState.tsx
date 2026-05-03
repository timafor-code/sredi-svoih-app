import type { ReactNode } from "react";

import { GlassCard } from "./GlassCard";

type EmptyStateProps = {
  title: string;
  description: string;
  children?: ReactNode;
};

export function EmptyState({ title, description, children }: EmptyStateProps) {
  return (
    <GlassCard className="empty-state" elevated>
      <div className="empty-state__mark">⊘</div>
      <h1>{title}</h1>
      <p>{description}</p>
      {children}
    </GlassCard>
  );
}
