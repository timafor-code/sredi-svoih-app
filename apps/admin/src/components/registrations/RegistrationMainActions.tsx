import { Button } from "../ui/Button";

type RegistrationMainActionsProps = {
  eventsLoading: boolean;
  onRefresh: () => void;
  registrationsLoading: boolean;
};

export function RegistrationMainActions({
  eventsLoading,
  onRefresh,
  registrationsLoading,
}: RegistrationMainActionsProps) {
  return (
    <div className="registrations-main-actions">
      <Button
        disabled={registrationsLoading || eventsLoading}
        onClick={onRefresh}
        size="sm"
      >
        {registrationsLoading ? "Обновляем..." : "Обновить"}
      </Button>
    </div>
  );
}
