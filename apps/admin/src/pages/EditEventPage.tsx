import { useCallback, useEffect, useRef, useState } from "react";

import { EventCapacityUnitsConstructor } from "../components/events/EventCapacityUnitsConstructor";
import { EventForm } from "../components/events/EventForm";
import { EventOccurrencesConstructor } from "../components/events/EventOccurrencesConstructor";
import { EventQuestionnaireCard } from "../components/events/EventQuestionnaireCard";
import { EventWebRegistrationCard } from "../components/events/EventWebRegistrationCard";
import { ParticipationOptionsConstructor } from "../components/events/ParticipationOptionsConstructor";
import type { EventImageUploadStage } from "../components/events/EventImageUploader";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { GlassCard } from "../components/ui/GlassCard";
import { useAdminAuth } from "../context/AdminAuthContext";
import {
  getAdminEventImageErrorMessage,
  removeAdminEventImage,
  uploadAdminEventImage,
} from "../services/adminEventImagesApiService";
import { ApiClientError } from "../services/apiClient";
import { getAdminEvent, updateAdminEvent } from "../services/adminEventsService";
import { listAdminCommunityLocations } from "../services/communityLocationsService";
import { listAdminEventCategories } from "../services/eventCategoriesService";
import { getEventStatusLabel, getEventVisibilityLabel } from "../types/events";
import type { AdminEvent, UpdateAdminEventInput } from "../types/events";
import type { AdminCommunityLocation } from "../types/communityLocations";
import type { AdminEventCategory } from "../types/eventCategories";

type EditEventPageProps = {
  event: AdminEvent;
  onBackToList: () => void;
  onSaved: (event: AdminEvent) => void;
};

export function EditEventPage({ event, onBackToList, onSaved }: EditEventPageProps) {
  const { isAdmin } = useAdminAuth();
  const mutationActiveRef = useRef(false);
  const [currentEvent, setCurrentEvent] = useState(event);
  const [savedEvent, setSavedEvent] = useState<AdminEvent | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [removingImage, setRemovingImage] = useState(false);
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [imageStage, setImageStage] = useState<EventImageUploadStage | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageSuccessMessage, setImageSuccessMessage] = useState<string | null>(null);
  const [fieldsSavedBeforeImageFailure, setFieldsSavedBeforeImageFailure] = useState(false);
  const communityId = currentEvent.communityId;
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

  useEffect(() => {
    setCurrentEvent(event);
    setSavedEvent(null);
    setSubmitError(null);
    setSelectedImageFile(null);
    setImageStage(null);
    setImageError(null);
    setImageSuccessMessage(null);
  }, [event.id]);

  const handleSelectedImageFileChange = useCallback((file: File | null) => {
    setSelectedImageFile(file);
    setImageStage(null);
    setImageError(null);
    setImageSuccessMessage(null);
    setFieldsSavedBeforeImageFailure(false);
  }, []);

  const storeConfirmedEvent = (nextEvent: AdminEvent) => {
    setCurrentEvent(nextEvent);
    setSavedEvent(nextEvent);
    onSaved(nextEvent);
  };

  const uploadPendingImage = async (
    baseEvent: AdminEvent,
    file: File,
    ordinaryFieldsSaved: boolean,
  ): Promise<boolean> => {
    setImageError(null);
    setImageSuccessMessage(null);
    setImageStage("preparing");
    await allowStageAnnouncement();
    setImageStage("uploading");

    let eventWithImage: AdminEvent;
    try {
      eventWithImage = await uploadAdminEventImage(baseEvent.id, file);
    } catch (error) {
      setImageStage(null);
      setFieldsSavedBeforeImageFailure(ordinaryFieldsSaved);
      setImageError(
        ordinaryFieldsSaved
          ? `Обычные поля уже сохранены. Текущее изображение осталось без изменений. ${getAdminEventImageErrorMessage(error)}`
          : `Обычные поля не изменялись. Текущее изображение осталось без изменений. ${getAdminEventImageErrorMessage(error)}`,
      );
      return false;
    }

    setImageStage("saving");
    storeConfirmedEvent(eventWithImage);
    setSelectedImageFile(null);
    setFieldsSavedBeforeImageFailure(false);
    setImageSuccessMessage("Изображение сохранено.");
    await allowStageAnnouncement();
    setImageStage("done");
    return true;
  };

  const handleSubmit = async (input: UpdateAdminEventInput) => {
    if (mutationActiveRef.current) {
      return false;
    }

    mutationActiveRef.current = true;
    setSubmitError(null);
    setImageError(null);
    setImageSuccessMessage(null);
    setSubmitting(true);

    try {
      let eventForImage = currentEvent;
      const hasOrdinaryUpdates = Object.keys(input).length > 0;

      if (hasOrdinaryUpdates) {
        try {
          eventForImage = await updateAdminEvent(currentEvent.id, input);
          storeConfirmedEvent(eventForImage);
        } catch (error) {
          setSubmitError(
            error instanceof Error
              ? error.message
              : "Не удалось сохранить событие через admin_update_event.",
          );
          return false;
        }
      }

      if (selectedImageFile) {
        return await uploadPendingImage(
          eventForImage,
          selectedImageFile,
          hasOrdinaryUpdates,
        );
      }

      return true;
    } finally {
      mutationActiveRef.current = false;
      setSubmitting(false);
    }
  };

  const retryImageUpload = async () => {
    if (!selectedImageFile || mutationActiveRef.current) {
      return;
    }

    mutationActiveRef.current = true;
    setSubmitting(true);
    try {
      await uploadPendingImage(
        currentEvent,
        selectedImageFile,
        fieldsSavedBeforeImageFailure,
      );
    } finally {
      mutationActiveRef.current = false;
      setSubmitting(false);
    }
  };

  const handleRemoveImage = async () => {
    if (!currentEvent.imageUrl || mutationActiveRef.current) {
      return;
    }

    const confirmed = window.confirm(
      `Удалить изображение события «${currentEvent.title}»?\n\nИзображение больше не будет отображаться на событии.`,
    );
    if (!confirmed) {
      return;
    }

    mutationActiveRef.current = true;
    setSubmitting(true);
    setRemovingImage(true);
    setSubmitError(null);
    setImageError(null);
    setImageSuccessMessage(null);
    setImageStage(null);

    try {
      const nextEvent = await removeAdminEventImage(currentEvent.id);
      storeConfirmedEvent(nextEvent);
      setSelectedImageFile(null);
      setImageStage(null);
      setImageSuccessMessage("Изображение удалено.");
    } catch (error) {
      if (isUncertainRemovalResult(error)) {
        const storageUnavailable =
          error instanceof ApiClientError
          && error.code === "event_image_storage_unavailable";
        let recoveredEvent = storageUnavailable
          ? { ...currentEvent, imageUrl: null }
          : currentEvent;
        let refreshed = false;

        try {
          recoveredEvent = await getAdminEvent(currentEvent.id);
          refreshed = true;
        } catch {
          // The safe message below asks for a refresh when the read path is unavailable.
        }

        setCurrentEvent(recoveredEvent);
        if (refreshed || storageUnavailable) {
          onSaved(recoveredEvent);
        }

        if (!recoveredEvent.imageUrl) {
          setImageError(
            "Изображение больше не показывается на событии, но сервер не подтвердил полное завершение очистки. Хранилище не раскрывает технические детали и повторит безопасную очистку.",
          );
        } else {
          setImageError(
            refreshed
              ? getAdminEventImageErrorMessage(error)
              : "Не удалось подтвердить удаление изображения. Обновите страницу и проверьте текущее состояние.",
          );
        }
      } else {
        setImageError(getAdminEventImageErrorMessage(error));
      }
    } finally {
      mutationActiveRef.current = false;
      setRemovingImage(false);
      setSubmitting(false);
    }
  };

  return (
    <div className="page-stack page-stack--event-create">
      <section className="page-header">
        <Badge tone="blue">Редактирование</Badge>
        <h1>Редактировать событие</h1>
        <p>
          Изменения сохраняются через Python API с текущей
          пользовательской сессией.
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

      <GlassCard className="event-create-card event-create-card--sticky-actions" elevated>
        <EventForm
          actionsPlacement="stickyTop"
          initialEvent={currentEvent}
          mode="edit"
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
          onCancel={onBackToList}
          onRemoveImage={handleRemoveImage}
          onRetryImage={retryImageUpload}
          onSelectedImageFileChange={handleSelectedImageFileChange}
          registrationModeSlot={({ registrationMode }) =>
            registrationMode === "internal_paid" ? (
              <div className="event-form-participation-slot">
                <ParticipationOptionsConstructor
                  defaultPriceCurrency={currentEvent.priceCurrency}
                  eventCapacity={currentEvent.capacity}
                  eventId={currentEvent.id}
                />
                <EventCapacityUnitsConstructor eventId={currentEvent.id} />
              </div>
            ) : null
          }
          removingImage={removingImage}
          selectedImageFile={selectedImageFile}
          onSubmit={handleSubmit}
          submitError={submitError}
          submitting={submitting}
        />
      </GlassCard>

      <EventWebRegistrationCard
        eventId={currentEvent.id}
        eventTitle={currentEvent.title}
      />

      {isAdmin === true ? <EventQuestionnaireCard eventId={currentEvent.id} /> : null}

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

function isUncertainRemovalResult(error: unknown): boolean {
  return error instanceof ApiClientError && (
    error.code === "event_image_storage_unavailable"
    || error.code === "request_timeout"
    || error.code === "network_error"
    || error.code === "invalid_event_image_response"
  );
}

function allowStageAnnouncement(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}
