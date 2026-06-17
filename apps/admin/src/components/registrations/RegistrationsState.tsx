import type { ReactNode } from "react";

export function RegistrationsState({
  children,
  description,
  title,
}: {
  children?: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <div className="registrations-state" role="status">
      <h3>{title}</h3>
      <p>{description}</p>
      {children ? <div className="registrations-state__actions">{children}</div> : null}
    </div>
  );
}
