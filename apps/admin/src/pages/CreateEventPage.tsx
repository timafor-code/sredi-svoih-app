import { useCallback, useEffect, useState } from "react";

import { EventForm } from "../components/events/EventForm";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { GlassCard } from "../components/ui/GlassCard";
import { createAdminEvent } from "../services/adminEventsService";
import { listAdminCommunityLocations } from "../services/communityLocationsService";
import { listAdminEventCategories } from "../services/eventCategoriesService";
import { useAdminAuth } from "../store/useAdminAuth";
import { getEventStatusLabel, getEventVisibilityLabel } from "../types/events";
import type { AdminEvent, AdminEventMutationInput } from "../types/events";
import type { AdminCommunityLocation } from "../types/communityLocations";
import type { AdminEventCategory } from "../types/eventCategories";

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
  const [categories, setCategories] = useState<AdminEventCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [communityLocations, setCommunityLocations] = useState<AdminCommunityLocation[]>([]);
  const [communityLocationsLoading, setCommunityLocationsLoading] = useState(false);
  const [communityLocationsError, setCommunityLocationsError] = useState<string | null>(null);

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

  const loadCommunityLocations = useCallback(async () => {
    if (!communityId) {
      setCommunityLocations([]);
      setCommunityLocationsLoading(false);
      setCommunityLocationsError(null);
      return;
    }

    setCommunityLocationsLoading(true);
    setCommunityLocationsError(null);

    try {
      const nextLocations = await listAdminCommunityLocations(communityId);
      setCommunityLocations(nextLocations);
    } catch (error) {
      setCommunityLocations([]);
      setCommunityLocationsError(
        error instanceof Error ? error.message : "Не удалось загрузить адреса общины.",
      );
    } finally {
      setCommunityLocationsLoading(false);
    }
  }, [communityId]);

  useEffect(() => {
    void loadCommunityLocations();
  }, [loadCommunityLocations]);


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
          <Badge tone="green">Создано</Badge>
          <h1>Событие создано</h1>
          <p>
            Запись создана через Python API. Вернитесь к списку, чтобы
            увидеть обновлённую таблицу событий.
          </p>
        </section>

        <GlassCard className="event-create-success" elevated>
          <div>
            <span>Новое событие</span>
            <h2>{createdEvent.title}</h2>
            <p>
              {getEventStatusLabel(createdEvent.status)} /{" "}
              {getEventVisibilityLabel(createdEvent.visibility)}
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
        <Badge tone="gold">Ручное создание</Badge>
        <h1>Создать событие</h1>
        <p>
          Ручное создание события в текущей общине. Сохранение идёт через
          Python API с текущей пользовательской сессией.
        </p>
      </section>

      <GlassCard className="event-create-card" elevated>
        <EventForm
          disabled={!communityId}
          disabledMessage={communityId ? null : COMMUNITY_ID_ERROR}
          categories={categories}
          categoriesError={categoriesError}
          categoriesLoading={categoriesLoading}
          communityLocations={communityLocations}
          communityLocationsError={communityLocationsError}
          communityLocationsLoading={communityLocationsLoading}
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
