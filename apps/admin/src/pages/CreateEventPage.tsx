import { useCallback, useEffect, useRef, useState } from "react";

import {
  EventImageUploader,
  type EventImageUploadStage,
} from "../components/events/EventImageUploader";
import { EventForm } from "../components/events/EventForm";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { GlassCard } from "../components/ui/GlassCard";
import {
  getAdminEventImageErrorMessage,
  uploadAdminEventImage,
} from "../services/adminEventImagesApiService";
import {
  createAdminEvent,
  getAdminEvent,
  updateAdminEvent,
} from "../services/adminEventsService";
import { listAdminCommunityLocations } from "../services/communityLocationsService";
import { listAdminEventCategories } from "../services/eventCategoriesService";
import { useAdminAuth } from "../store/useAdminAuth";
import { getEventStatusLabel, getEventVisibilityLabel } from "../types/events";
import type {
  AdminEvent,
  AdminEventMutationInput,
  UpdateAdminEventInput,
} from "../types/events";
import type { AdminCommunityLocation } from "../types/communityLocations";
import type { AdminEventCategory } from "../types/eventCategories";

type CreateEventPageProps = {
  onBackToList: () => void;
  onCreated: (event: AdminEvent) => void;
};

type RequestedFinalState = Pick<AdminEventMutationInput, "status" | "visibility">;
type RecoveryStep = "upload" | "final-state";

const COMMUNITY_ID_ERROR =
  "Не удалось определить communityId текущей активной membership.";

export function CreateEventPage({ onBackToList, onCreated }: CreateEventPageProps) {
  const auth = useAdminAuth();
  const communityId = auth.membership?.community_id ?? null;
  const mutationActiveRef = useRef(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [createdEvent, setCreatedEvent] = useState<AdminEvent | null>(null);
  const [pendingEvent, setPendingEvent] = useState<AdminEvent | null>(null);
  const [requestedFinalState, setRequestedFinalState] = useState<RequestedFinalState | null>(null);
  const [recoveryStep, setRecoveryStep] = useState<RecoveryStep | null>(null);
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [imageStage, setImageStage] = useState<EventImageUploadStage | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageSuccessMessage, setImageSuccessMessage] = useState<string | null>(null);
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
          : "Не удалось загрузить категории событий.",
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

  const handleSelectedImageFileChange = useCallback((file: File | null) => {
    setSelectedImageFile(file);
    setImageError(null);
    setImageSuccessMessage(null);
    setImageStage(null);
  }, []);

  const completeCreateFlow = (event: AdminEvent) => {
    setCreatedEvent(event);
    setPendingEvent(null);
    setRecoveryStep(null);
    setSelectedImageFile(null);
    setSubmitError(null);
    onCreated(event);
  };

  const applyRequestedFinalState = async (
    event: AdminEvent,
    finalState: RequestedFinalState,
  ): Promise<boolean> => {
    const remainingUpdate = buildRemainingFinalStateUpdate(event, finalState);
    if (Object.keys(remainingUpdate).length === 0) {
      completeCreateFlow(event);
      return true;
    }

    setRecoveryStep("final-state");
    setSubmitError(null);

    try {
      const finalizedEvent = await updateAdminEvent(event.id, remainingUpdate);
      completeCreateFlow(finalizedEvent);
      return true;
    } catch {
      let authoritativeEvent = event;
      try {
        authoritativeEvent = await getAdminEvent(event.id);
      } catch {
        // Keep the last confirmed event response and retry only the final-state contract.
      }

      setPendingEvent(authoritativeEvent);
      setRecoveryStep("final-state");
      setSubmitError(
        "Событие и изображение сохранены, но не удалось применить запрошенные статус и видимость.",
      );
      return false;
    }
  };

  const uploadCreatedEventImage = async (
    event: AdminEvent,
    file: File,
    finalState: RequestedFinalState,
  ): Promise<boolean> => {
    setImageError(null);
    setImageSuccessMessage(null);
    setSubmitError(null);
    setImageStage("preparing");
    await allowStageAnnouncement();
    setImageStage("uploading");

    let eventWithImage: AdminEvent;
    try {
      eventWithImage = await uploadAdminEventImage(event.id, file);
    } catch (error) {
      setPendingEvent(event);
      setRecoveryStep("upload");
      setImageStage(null);
      setImageError(
        `Событие создано, но изображение не прикреплено. ${getAdminEventImageErrorMessage(error)}`,
      );
      return false;
    }

    setImageStage("saving");
    setPendingEvent(eventWithImage);
    setSelectedImageFile(null);
    setImageSuccessMessage("Изображение прикреплено к событию.");
    await allowStageAnnouncement();
    setImageStage("done");

    return applyRequestedFinalState(eventWithImage, finalState);
  };

  const handleSubmit = async (input: AdminEventMutationInput) => {
    if (mutationActiveRef.current) {
      return false;
    }

    setSubmitError(null);
    setImageError(null);
    setImageSuccessMessage(null);

    if (!communityId) {
      setSubmitError(COMMUNITY_ID_ERROR);
      return false;
    }

    mutationActiveRef.current = true;
    setSubmitting(true);

    try {
      if (!selectedImageFile) {
        const nextEvent = await createAdminEvent({ communityId, ...input });
        completeCreateFlow(nextEvent);
        return true;
      }

      const finalState: RequestedFinalState = {
        status: input.status,
        visibility: input.visibility,
      };
      setRequestedFinalState(finalState);

      let stagedEvent: AdminEvent;
      try {
        stagedEvent = await createAdminEvent({
          communityId,
          ...input,
          status: "draft",
          visibility: "hidden",
        });
      } catch (error) {
        setSubmitError(
          error instanceof Error
            ? error.message
            : "Не удалось создать событие через admin_create_event.",
        );
        return false;
      }

      setPendingEvent(stagedEvent);
      return await uploadCreatedEventImage(stagedEvent, selectedImageFile, finalState);
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Не удалось создать событие через admin_create_event.",
      );
      return false;
    } finally {
      mutationActiveRef.current = false;
      setSubmitting(false);
    }
  };

  const retryImageUpload = async () => {
    if (
      !pendingEvent
      || !selectedImageFile
      || !requestedFinalState
      || mutationActiveRef.current
    ) {
      return;
    }

    mutationActiveRef.current = true;
    setSubmitting(true);
    try {
      await uploadCreatedEventImage(pendingEvent, selectedImageFile, requestedFinalState);
    } finally {
      mutationActiveRef.current = false;
      setSubmitting(false);
    }
  };

  const continueWithoutImage = async () => {
    if (!pendingEvent || !requestedFinalState || mutationActiveRef.current) {
      return;
    }

    mutationActiveRef.current = true;
    setSubmitting(true);
    setSelectedImageFile(null);
    setImageError(null);
    setImageStage(null);

    try {
      await applyRequestedFinalState(pendingEvent, requestedFinalState);
    } finally {
      mutationActiveRef.current = false;
      setSubmitting(false);
    }
  };

  const retryFinalState = async () => {
    if (!pendingEvent || !requestedFinalState || mutationActiveRef.current) {
      return;
    }

    mutationActiveRef.current = true;
    setSubmitting(true);
    try {
      await applyRequestedFinalState(pendingEvent, requestedFinalState);
    } finally {
      mutationActiveRef.current = false;
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

  if (pendingEvent && recoveryStep) {
    return (
      <div className="page-stack page-stack--event-create">
        <section className="page-header">
          <Badge tone="gold">Требуется действие</Badge>
          <h1>Событие создано не полностью</h1>
          <p>
            Событие «{pendingEvent.title}» уже имеет постоянный ID. Повторные действия
            продолжат эту запись и не создадут дубликат.
          </p>
        </section>

        <GlassCard className="event-create-card event-create-recovery" elevated>
          {recoveryStep === "upload" ? (
            <>
              <EventImageUploader
                busy={submitting}
                currentImageUrl={pendingEvent.imageUrl}
                error={imageError}
                onRetryImage={retryImageUpload}
                onSelectedFileChange={handleSelectedImageFileChange}
                selectedFile={selectedImageFile}
                successMessage={imageSuccessMessage}
                uploadStage={imageStage}
              />
              <div className="event-create-recovery__actions">
                <Button disabled={submitting} onClick={continueWithoutImage} variant="secondary">
                  Продолжить без изображения
                </Button>
              </div>
            </>
          ) : (
            <>
              {submitError ? <div className="form-error" role="alert">{submitError}</div> : null}
              <EventImageUploader
                busy={submitting}
                currentImageUrl={pendingEvent.imageUrl}
                onSelectedFileChange={handleSelectedImageFileChange}
                selectionDisabled
                selectedFile={null}
                successMessage={imageSuccessMessage}
                uploadStage={imageStage}
              />
              <div className="event-create-recovery__actions">
                <Button disabled={submitting} onClick={retryFinalState} variant="primary">
                  Повторить изменение статуса и видимости
                </Button>
              </div>
            </>
          )}
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
          imageError={imageError}
          imageAuthoringMode="file"
          imageSuccessMessage={imageSuccessMessage}
          imageUploadStage={imageStage}
          mode="create"
          notice={
            <div className="event-form-notice">
              Даты и сеансы можно настроить после создания события.
            </div>
          }
          onCancel={onBackToList}
          onSelectedImageFileChange={handleSelectedImageFileChange}
          onSubmit={handleSubmit}
          selectedImageFile={selectedImageFile}
          submitError={submitError}
          submitting={submitting}
        />
      </GlassCard>

      <GlassCard className="event-web-registration-create-notice" elevated>
        <h2>Веб-регистрация</h2>
        <p>Сохраните событие, чтобы получить стабильную ссылку на страницу регистрации.</p>
      </GlassCard>
    </div>
  );
}

function buildRemainingFinalStateUpdate(
  event: AdminEvent,
  finalState: RequestedFinalState,
): UpdateAdminEventInput {
  const update: UpdateAdminEventInput = {};

  if (event.status !== finalState.status) {
    update.status = finalState.status;
  }

  if (event.visibility !== finalState.visibility) {
    update.visibility = finalState.visibility;
  }

  return update;
}

function allowStageAnnouncement(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}
