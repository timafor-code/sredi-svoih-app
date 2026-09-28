import { Button } from "../ui/Button";
import type { AdminMembership } from "../../types/auth";

type AddParticipantEvent = {
  communityId: string;
  registrationMode: string;
};

export function canAddParticipantForEvent(
  event: AddParticipantEvent,
  memberships: readonly AdminMembership[],
): boolean {
  const supportsAdminRegistration =
    event.registrationMode === "internal_free" ||
    event.registrationMode === "internal_paid";
  return supportsAdminRegistration && memberships.some((membership) => (
    membership.community_id === event.communityId &&
    membership.status === "active" &&
    membership.role === "admin"
  ));
}

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
