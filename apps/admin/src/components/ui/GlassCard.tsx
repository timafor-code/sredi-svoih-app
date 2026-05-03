import type { HTMLAttributes, ReactNode } from "react";

type GlassCardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  elevated?: boolean;
};

export function GlassCard({ children, className, elevated = false, ...props }: GlassCardProps) {
  const classes = ["glass-card", elevated ? "glass-card--elevated" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} {...props}>
      {children}
    </div>
  );
}
