import { EmptyState } from "../components/ui/EmptyState";

export function NoAccessPage() {
  return (
    <div className="page-stack page-stack--center">
      <EmptyState
        description="Этот раздел доступен только администраторам и менеджерам событий"
        title="Нет доступа"
      />
    </div>
  );
}
