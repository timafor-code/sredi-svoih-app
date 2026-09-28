import { Button } from "../ui/Button";

type RegistrationMainActionsProps = {
  canAddParticipant: boolean;
  eventsLoading: boolean;
  onAddParticipant: () => void;
  onRefresh: () => void;
  registrationsLoading: boolean;
};

export function RegistrationMainActions({
  canAddParticipant,
  eventsLoading,
  onAddParticipant,
  onRefresh,
  registrationsLoading,
}: RegistrationMainActionsProps) {
  return (
    <div className="registrations-main-actions">
      {canAddParticipant ? (
        <Button
          disabled={registrationsLoading || eventsLoading}
          onClick={onAddParticipant}
          size="sm"
          variant="primary"
        >
          Добавить участника
        </Button>
      ) : null}
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
