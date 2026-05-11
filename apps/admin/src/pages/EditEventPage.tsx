import { useCallback, useEffect, useState } from "react";

import { EventForm } from "../components/events/EventForm";
import { EventOccurrencesConstructor } from "../components/events/EventOccurrencesConstructor";
import { ParticipationOptionsConstructor } from "../components/events/ParticipationOptionsConstructor";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { GlassCard } from "../components/ui/GlassCard";
import { updateAdminEvent } from "../services/adminEventsService";
import { listAdminEventCategories } from "../services/eventCategoriesService";
import { getEventStatusLabel, getEventVisibilityLabel } from "../types/events";
import type { AdminEvent, AdminEventMutationInput } from "../types/events";
import type { AdminEventCategory } from "../types/eventCategories";

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
  const communityId = currentEvent.communityId;
  const [categories, setCategories] = useState<AdminEventCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);

  const loadCategories = useCallback(async () => {
    if (!communityId) {
      setCategories([]);
      setCategoriesLoading(false);
      setCategoriesError(null);
      return;
    }

    setCategoriesLoading(true);
    setCategoriesError(null);

    try {
      const nextCategories = await listAdminEventCategories(communityId);
      setCategories(nextCategories);
    } catch (error) {
      setCategories([]);
      setCategoriesError(
        error instanceof Error
          ? error.message
          : "?? ??????? ????????? ????????? ???????.",
      );
    } finally {
      setCategoriesLoading(false);
    }
  }, [communityId]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);


  useEffect(() => {
    setCurrentEvent(event);
    setSavedEvent(null);
    setSubmitError(null);
  }, [event.eventKind, event.id, event.registrationMode]);

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
        <Badge tone="blue">Редактирование</Badge>
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
              {getEventStatusLabel(savedEvent.status)} /{" "}
              {getEventVisibilityLabel(savedEvent.visibility)}
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
          categories={categories}
          categoriesError={categoriesError}
          categoriesLoading={categoriesLoading}
          onCancel={onBackToList}
          registrationModeSlot={({
            registrationMode,
            requiresApproval,
            setRequiresApproval,
          }) =>
            registrationMode === "internal_paid" ? (
              <div className="event-form-participation-slot">
                <ParticipationOptionsConstructor
                  defaultPriceCurrency={currentEvent.priceCurrency}
                  eventCapacity={currentEvent.capacity}
                  eventId={currentEvent.id}
                  onRequiresApprovalChange={setRequiresApproval}
                  requiresApproval={requiresApproval}
                />
              </div>
            ) : null
          }
          onSubmit={handleSubmit}
          submitError={submitError}
          submitting={submitting}
        />
      </GlassCard>

      <GlassCard className="event-occurrences-card" elevated>
        <EventOccurrencesConstructor
          defaultTimezone={currentEvent.timezone}
          eventKind={currentEvent.eventKind}
          eventCapacity={currentEvent.capacity}
          eventId={currentEvent.id}
        />
      </GlassCard>

    </div>
  );
}
