import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { useAdminAuth } from "../store/useAdminAuth";
import type { AdminProfile } from "../types/auth";

export function NoAccessPage() {
  const { membership, profile, role, session, signOut } = useAdminAuth();
  const userLabel = getUserLabel(profile, session?.user.email ?? null);

  return (
    <div className="page-stack page-stack--center">
      <EmptyState
        description="Этот раздел доступен только администраторам и менеджерам событий."
        title="Нет доступа"
      >
        <div className="access-details">
          <span>{userLabel}</span>
          <strong>Роль: {role ?? membership?.role ?? "не найдена"}</strong>
        </div>
        <Button onClick={signOut} variant="secondary">
          Выйти
        </Button>
      </EmptyState>
    </div>
  );
}

function getUserLabel(profile: AdminProfile | null, email: string | null): string {
  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim();

  return (
    profile?.display_name ??
    profile?.full_name ??
    (fullName || null) ??
    profile?.email ??
    email ??
    "Пользователь"
  );
}
