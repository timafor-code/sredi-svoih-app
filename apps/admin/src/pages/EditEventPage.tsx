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

  useEffect(() => {
    setCurrentEvent(event);
    setSavedEvent(null);
    setSubmitError(null);
  }, [event.id]);

  const handleSubmit = async (input: AdminEventMutationInput) => {
    setSubmitError(null);
    setSubmitting(true);

    try {
      const nextEvent = await updateAdminEvent(currentEvent.id, input);
      setCurrentEvent(nextEvent);
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
          onSubmit={handleSubmit}
          submitError={submitError}
          submitting={submitting}
        />
      </GlassCard>

      {currentEvent.registrationMode === "internal_paid" ? (
        <GlassCard className="event-create-card" elevated>
          <ParticipationOptionsConstructor
            defaultPriceCurrency={currentEvent.priceCurrency}
            eventCapacity={currentEvent.capacity}
            eventId={currentEvent.id}
          />
        </GlassCard>
      ) : null}
    </div>
  );
}
