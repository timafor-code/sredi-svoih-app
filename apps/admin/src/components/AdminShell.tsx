import type { ReactNode } from "react";

type AdminShellProps = {
  children: ReactNode;
};

export function AdminShell({ children }: AdminShellProps) {
  return (
    <main className="admin-shell" aria-label="Среди Своих Admin Center">
      <section className="admin-shell__panel">{children}</section>
    </main>
  );
}
