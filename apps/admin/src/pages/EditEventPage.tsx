import { useEffect, useState } from "react";

import { EventForm } from "../components/events/EventForm";
import { ParticipationOptionsConstructor } from "../components/events/ParticipationOptionsConstructor";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { GlassCard } from "../components/ui/GlassCard";
import { updateAdminEvent } from "../services/adminEventsService";
import type { AdminEvent, AdminEventMutationInput } from "../types/events";

type EditEventPageProps = {
  event: AdminEvent;
  onBackToList: () => void;
  onSaved: (event: AdminEvent) => void;
};

export function EditEventPage({ event, onBackToList, onSaved }: EditEventPageProps) {
  const [currentEvent, setCurrentEvent] = useState(event);
  const [savedEvent, setSavedEvent] = useState<AdminEvent | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [draftRegistrationMode, setDraftRegistrationMode] = useState<string>(
    event.registrationMode,
  );

  useEffect(() => {
    setCurrentEvent(event);
    setSavedEvent(null);
    setSubmitError(null);
    setDraftRegistrationMode(event.registrationMode);
  }, [event.id, event.registrationMode]);

  const handleSubmit = async (input: AdminEventMutationInput) => {
    setSubmitError(null);
    setSubmitting(true);

    try {
      const nextEvent = await updateAdminEvent(currentEvent.id, input);
      setCurrentEvent(nextEvent);
      setDraftRegistrationMode(nextEvent.registrationMode);
      setSavedEvent(nextEvent);
      onSaved(nextEvent);
      return true;
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Не удалось сохранить событие через admin_update_event.",
      );
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const showParticipationOptions = draftRegistrationMode === "internal_paid";

  return (
    <div className="page-stack page-stack--event-create">
      <section className="page-header">
        <Badge tone="blue">edit</Badge>
        <h1>Редактировать событие</h1>
        <p>
          Изменения сохраняются через RPC admin_update_event с текущей
          пользовательской сессией Supabase.
        </p>
      </section>

      {savedEvent ? (
        <GlassCard className="event-create-success" elevated>
          <div>
            <span>Событие обновлено</span>
            <h2>{savedEvent.title}</h2>
            <p>
              {savedEvent.status} / {savedEvent.visibility}
            </p>
          </div>
          <Button onClick={onBackToList} variant="primary">
            Вернуться к списку
          </Button>
        </GlassCard>
      ) : null}

      <GlassCard className="event-create-card" elevated>
        <EventForm
          initialEvent={currentEvent}
          mode="edit"
          onCancel={onBackToList}
          onRegistrationModeChange={setDraftRegistrationMode}
          registrationModeSlot={
            showParticipationOptions ? (
              <div className="event-form-participation-slot">
                <ParticipationOptionsConstructor
                  defaultPriceCurrency={currentEvent.priceCurrency}
                  eventCapacity={currentEvent.capacity}
                  eventId={currentEvent.id}
                />
              </div>
            ) : null
          }
          onSubmit={handleSubmit}
          submitError={submitError}
          submitting={submitting}
        />
      </GlassCard>

    </div>
  );
}
