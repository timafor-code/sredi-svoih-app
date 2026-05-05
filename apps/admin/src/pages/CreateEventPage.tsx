import { useState } from "react";

import { EventForm } from "../components/events/EventForm";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { GlassCard } from "../components/ui/GlassCard";
import { createAdminEvent } from "../services/adminEventsService";
import { useAdminAuth } from "../store/useAdminAuth";
import type { AdminEvent, AdminEventMutationInput } from "../types/events";

type CreateEventPageProps = {
  onBackToList: () => void;
  onCreated: (event: AdminEvent) => void;
};

const COMMUNITY_ID_ERROR =
  "Не удалось определить communityId текущей активной membership.";

export function CreateEventPage({ onBackToList, onCreated }: CreateEventPageProps) {
  const auth = useAdminAuth();
  const communityId = auth.membership?.community_id ?? null;
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [createdEvent, setCreatedEvent] = useState<AdminEvent | null>(null);

  const handleSubmit = async (input: AdminEventMutationInput) => {
    setSubmitError(null);

    if (!communityId) {
      setSubmitError(COMMUNITY_ID_ERROR);
      return false;
    }

    setSubmitting(true);

    try {
      const nextEvent = await createAdminEvent({ communityId, ...input });
      setCreatedEvent(nextEvent);
      onCreated(nextEvent);
      return true;
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Не удалось создать событие через admin_create_event.",
      );
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  if (createdEvent) {
    return (
      <div className="page-stack page-stack--event-create">
        <section className="page-header">
          <Badge tone="green">created</Badge>
          <h1>Событие создано</h1>
          <p>
            Запись создана через RPC admin_create_event. Вернитесь к списку, чтобы
            увидеть обновлённую таблицу событий.
          </p>
        </section>

        <GlassCard className="event-create-success" elevated>
          <div>
            <span>Новое событие</span>
            <h2>{createdEvent.title}</h2>
            <p>
              {createdEvent.status} / {createdEvent.visibility}
            </p>
          </div>
          <Button onClick={onBackToList} variant="primary">
            Вернуться к списку
          </Button>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="page-stack page-stack--event-create">
      <section className="page-header">
        <Badge tone="gold">manual create</Badge>
        <h1>Создать событие</h1>
        <p>
          Ручное создание события в текущей общине. Сохранение идёт через
          admin_create_event с текущей пользовательской сессией Supabase.
        </p>
      </section>

      <GlassCard className="event-create-card" elevated>
        <EventForm
          disabled={!communityId}
          disabledMessage={communityId ? null : COMMUNITY_ID_ERROR}
          mode="create"
          notice={
            <div className="event-form-notice">
              Даты и сеансы можно настроить после создания события.
            </div>
          }
          onCancel={onBackToList}
          onSubmit={handleSubmit}
          submitError={submitError}
          submitting={submitting}
        />
      </GlassCard>
    </div>
  );
}
