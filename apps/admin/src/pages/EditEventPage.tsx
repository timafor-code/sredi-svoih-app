import { useCallback, useEffect, useRef, useState } from "react";

import { EventTicketsCapacityModule } from "../components/events/EventTicketsCapacityModule";
import { EventForm } from "../components/events/EventForm";
import { EventOccurrencesConstructor } from "../components/events/EventOccurrencesConstructor";
import { EventQuestionnaireCard } from "../components/events/EventQuestionnaireCard";
import { EventWebRegistrationCard } from "../components/events/EventWebRegistrationCard";
import type { EventImageUploadStage } from "../components/events/EventImageUploader";
import { EventEditorTabs, type EventEditorTab } from "../components/events/EventEditorTabs";
import { SaveStatusView } from "../components/ui/SaveStatusView";
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
  onLeaveGuardChange?: (dirty: boolean) => void;
};

export function EditEventPage({ event, onBackToList, onSaved, onLeaveGuardChange }: EditEventPageProps) {
  const { isAdmin } = useAdminAuth();
  const mutationActiveRef = useRef(false);
  const [currentEvent, setCurrentEvent] = useState(event);
  const confirmedEventRef = useRef(event);
  const [confirmedContentEvent, setConfirmedContentEvent] = useState(event);
  const [activeTab, setActiveTab] = useState<EventEditorTab>("event");
  const [registrationMode, setRegistrationMode] = useState<string>(event.registrationMode);
  const [eventDirty, setEventDirty] = useState(false);
  const [ticketsDirty, setTicketsDirty] = useState(false);
  const [webDirty, setWebDirty] = useState(false);
  const [questionnaireDirty, setQuestionnaireDirty] = useState(false);
  const [periodDirty, setPeriodDirty] = useState(false);
  const [singlePeriodExplicitDirty, setSinglePeriodExplicitDirty] = useState(false);
  const [publicationPending, setPublicationPending] = useState(0);
  const publicationCountRef = useRef(0);
  const publicationErrorRef = useRef<string | null>(null);
  const publicationQueueRef = useRef(Promise.resolve());
  const mountedRef = useRef(false);
  const [publicationToast, setPublicationToast] = useState<{
    saving?: boolean; savedAt?: string; error?: string; undo?: boolean;
  } | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const leaveDirty = eventDirty || webDirty || questionnaireDirty || singlePeriodExplicitDirty;
  useEffect(() => { onLeaveGuardChange?.(leaveDirty); }, [leaveDirty, onLeaveGuardChange]);
  useEffect(() => () => onLeaveGuardChange?.(false), [onLeaveGuardChange]);
  useEffect(() => {
    if (!leaveDirty) return;
    const handleUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, [leaveDirty]);

  useEffect(() => {
    if ((activeTab === "tickets" && registrationMode !== "internal_paid")
      || (activeTab === "web" && !["internal_free", "internal_paid"].includes(registrationMode))) {
      setActiveTab("event");
    }
  }, [activeTab, registrationMode]);

  useEffect(() => {
    if (!publicationToast || publicationPending > 0 || publicationToast.saving || publicationToast.error) return;
    const timeout = window.setTimeout(() => setPublicationToast(null), publicationToast.undo ? 8000 : 4000);
    return () => window.clearTimeout(timeout);
  }, [publicationToast, publicationPending]);
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
    confirmedEventRef.current = event;
    setConfirmedContentEvent(event);
    setRegistrationMode(event.registrationMode);
    setActiveTab("event");
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
    if (!mountedRef.current) return;
    confirmedEventRef.current = nextEvent;
    setCurrentEvent(nextEvent);
    onSaved(nextEvent);
  };

  const savePublication = (patch: Pick<UpdateAdminEventInput, "status" | "visibility">) => {
    // Content/image writes and this publication queue never run concurrently.
    if (mutationActiveRef.current) return;
    if (publicationCountRef.current === 0) publicationErrorRef.current = null;
    publicationCountRef.current += 1;
    setPublicationPending(publicationCountRef.current);
    setPublicationToast((previous) => ({ ...previous, saving: true, error: undefined }));
    publicationQueueRef.current = publicationQueueRef.current.then(async () => {
      if (!mountedRef.current) return;
      const previous = confirmedEventRef.current;
      try {
        const confirmed = await updateAdminEvent(previous.id, patch);
        if (!mountedRef.current) return;
        storeConfirmedEvent(confirmed);
        setPublicationToast((previousToast) => ({
          savedAt: new Date().toISOString(),
          error: publicationErrorRef.current ?? undefined,
          undo: confirmed.status === "draft" && (
            (previous.status === "published" && patch.status === "draft")
            || (!patch.status && previousToast?.undo)
          ),
        }));
      } catch {
        publicationErrorRef.current = "Не удалось сохранить одно из изменений публикации. Проверьте статус и видимость и повторите действие.";
        if (mountedRef.current) setPublicationToast((previousToast) => ({
          ...previousToast, saving: false, error: publicationErrorRef.current ?? undefined,
        }));
      } finally {
        publicationCountRef.current -= 1;
        if (mountedRef.current) setPublicationPending(publicationCountRef.current);
      }
    });
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
    if (mutationActiveRef.current || publicationCountRef.current > 0) {
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
          if (mountedRef.current) setConfirmedContentEvent(eventForImage);
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
    if (!selectedImageFile || mutationActiveRef.current || publicationCountRef.current > 0) {
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
    if (!currentEvent.imageUrl || mutationActiveRef.current || publicationCountRef.current > 0) {
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

        if (!mountedRef.current) return;
        confirmedEventRef.current = recoveredEvent;
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

  const publicationControls = (
    <div className="event-publication-controls">
      <div className="event-publication-control">
        <span className="event-publication-label">Статус</span>
        <div className="event-publication-segment" role="group" aria-label="Статус события">
          {(["draft", "published"] as const).map((status) => <button type="button" key={status}
            disabled={submitting} aria-pressed={currentEvent.status === status}
            onClick={() => savePublication({ status })}>
            {status === "draft" ? "Черновик" : "Опубликовано"}
          </button>)}
        </div>
      </div>
      {currentEvent.status === "cancelled" || currentEvent.status === "archived"
        ? <span className="event-publication-lifecycle">{getEventStatusLabel(currentEvent.status)}</span> : null}
      <div className="event-publication-control">
        <span className="event-publication-label">Видимость</span>
        <div className="event-publication-segment" role="group" aria-label="Видимость события">
          {([ ["public", "Публично"], ["members_only", "Участники"], ["hidden", "Скрыто"] ] as const).map(([visibility, label]) =>
            <button type="button" key={visibility} disabled={submitting} aria-pressed={currentEvent.visibility === visibility}
              onClick={() => savePublication({ visibility })}>{label}</button>)}
        </div>
      </div>
      <details className="event-publication-more">
          <summary aria-label="Другие статусы события">⋯</summary>
          <div className="event-publication-menu">
            {(["cancelled", "archived"] as const).map((status) => <button type="button" key={status}
              disabled={submitting} aria-pressed={currentEvent.status === status}
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                savePublication({ status });
              }}>{getEventStatusLabel(status)}</button>)}
          </div>
      </details>
    </div>
  );

  return (
    <div className="page-stack event-editor">
      <header className="event-editor-header">
        <div className="event-editor-kicker"><button type="button" onClick={onBackToList}>События</button> / Редактирование</div>
        <h1>{currentEvent.title}</h1>
        <div className="event-editor-meta">
          <span className={`event-editor-chip event-editor-chip--${currentEvent.status === "published" ? "green" : "muted"}`}>{getEventStatusLabel(currentEvent.status)}</span>
          <span className="event-editor-chip">{getEventVisibilityLabel(currentEvent.visibility)}</span>
          {currentEvent.category ? <span className="event-editor-chip event-editor-chip--blue">{categories.find((category) => category.slug === currentEvent.category)?.title ?? currentEvent.category}</span> : null}
        </div>
      </header>
      {publicationToast ? <div className="event-publication-toast">
        <SaveStatusView {...publicationToast} saving={publicationPending > 0} />
        {publicationToast.undo && publicationPending === 0 ? <Button variant="ghost" size="sm"
          onClick={() => savePublication({ status: "published" })}>Отменить снятие с публикации</Button> : null}
        {!publicationPending ? <button type="button" aria-label="Закрыть уведомление" onClick={() => setPublicationToast(null)}>×</button> : null}
      </div> : null}
      <EventEditorTabs activeTab={activeTab} onTabChange={setActiveTab} registrationMode={registrationMode}
        dirty={{ event: eventDirty, tickets: ticketsDirty, web: webDirty || questionnaireDirty, period: periodDirty }}
        panels={{
          event: <GlassCard className="event-create-card event-create-card--sticky-actions" elevated>
            <EventForm
              actionsPlacement="stickyTop"
              publicationControls={publicationControls}
              initialEvent={currentEvent}
              confirmedContentEvent={confirmedContentEvent}
              publicationControlled
              onDirtyChange={setEventDirty}
              onRegistrationModeChange={setRegistrationMode}
              onOpenTickets={() => setActiveTab("tickets")}
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
              removingImage={removingImage}
              selectedImageFile={selectedImageFile}
              onSubmit={handleSubmit}
              submitError={submitError}
              submitting={submitting}
              disabled={publicationPending > 0}
            />
          </GlassCard>,
          tickets: <EventTicketsCapacityModule key={currentEvent.id} eventId={currentEvent.id}
            defaultPriceCurrency={currentEvent.priceCurrency} eventCapacity={currentEvent.capacity}
            active={activeTab === "tickets" && registrationMode === "internal_paid"} onDirtyChange={setTicketsDirty} />,
          web: <div className="event-editor-web-grid">
            <EventWebRegistrationCard key={`web-${currentEvent.id}`} eventId={currentEvent.id} eventTitle={currentEvent.title}
              onDirtyChange={setWebDirty} />
            {isAdmin === true ? <EventQuestionnaireCard key={`questionnaire-${currentEvent.id}`} eventId={currentEvent.id}
              onDirtyChange={setQuestionnaireDirty} /> : null}
          </div>,
          period: <GlassCard className="event-occurrences-card" elevated>
            <EventOccurrencesConstructor key={currentEvent.id} defaultTimezone={currentEvent.timezone}
              eventStartsAt={currentEvent.startsAt} eventEndsAt={currentEvent.endsAt} eventStatus={currentEvent.status}
              eventKind={currentEvent.eventKind} eventCapacity={currentEvent.capacity} eventId={currentEvent.id}
              active={activeTab === "period"} onDirtyChange={setPeriodDirty}
              onExplicitDirtyChange={setSinglePeriodExplicitDirty} />
          </GlassCard>,
        }} />
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
