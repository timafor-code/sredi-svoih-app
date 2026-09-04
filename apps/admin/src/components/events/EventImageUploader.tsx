import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";

import { Button } from "../ui/Button";
import {
  EVENT_IMAGE_ACCEPT,
  formatEventImageSourceSize,
  getEventImageDimensionWarnings,
  getEventImageValidationMessage,
  validateEventImageSource,
  type EventImageDimensions,
} from "../../lib/eventImageValidation";

export type EventImageUploadStage =
  | "preparing"
  | "uploading"
  | "saving"
  | "done";

type EventImageUploaderProps = {
  busy: boolean;
  currentImageUrl?: string | null;
  error?: string | null;
  onRemoveImage?: () => void;
  onRetryImage?: () => void;
  onSelectedFileChange: (file: File | null) => void;
  onValidationErrorChange?: (hasError: boolean) => void;
  removing?: boolean;
  selectionDisabled?: boolean;
  selectedFile: File | null;
  successMessage?: string | null;
  uploadStage?: EventImageUploadStage | null;
};

const UPLOAD_STAGE_LABELS: Record<EventImageUploadStage, string> = {
  preparing: "Подготавливаем",
  uploading: "Загружаем",
  saving: "Сохраняем",
  done: "Готово",
};

export function EventImageUploader({
  busy,
  currentImageUrl = null,
  error = null,
  onRemoveImage,
  onRetryImage,
  onSelectedFileChange,
  onValidationErrorChange,
  removing = false,
  selectionDisabled = false,
  selectedFile,
  successMessage = null,
  uploadStage = null,
}: EventImageUploaderProps) {
  const inputId = useId();
  const detailInputId = useId();
  const helperId = useId();
  const dialogTitleId = useId();
  const dialogDescriptionId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localPreview, setLocalPreview] = useState<{
    file: File;
    url: string;
  } | null>(null);
  const [dimensions, setDimensions] = useState<EventImageDimensions | null>(null);
  const [currentImageFailed, setCurrentImageFailed] = useState(false);

  useEffect(() => {
    onValidationErrorChange?.(Boolean(localError));
  }, [localError, onValidationErrorChange]);

  useEffect(() => {
    setCurrentImageFailed(false);
  }, [currentImageUrl]);

  useEffect(() => {
    if (!selectedFile) {
      setLocalPreview(null);
      setDimensions(null);
      return;
    }

    const objectUrl = URL.createObjectURL(selectedFile);
    const image = new Image();
    let active = true;

    setLocalPreview({ file: selectedFile, url: objectUrl });
    setDimensions(null);
    image.onload = () => {
      if (!active) {
        return;
      }

      if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
        setLocalError(getEventImageValidationMessage("invalid_event_image"));
        onSelectedFileChange(null);
        return;
      }

      setDimensions({
        height: image.naturalHeight,
        width: image.naturalWidth,
      });
    };
    image.onerror = () => {
      if (!active) {
        return;
      }

      setLocalError(getEventImageValidationMessage("invalid_event_image"));
      onSelectedFileChange(null);
    };
    image.src = objectUrl;

    return () => {
      active = false;
      image.onload = null;
      image.onerror = null;
      URL.revokeObjectURL(objectUrl);
    };
  }, [onSelectedFileChange, selectedFile]);

  const displayedError = localError ?? error;
  useEffect(() => {
    if (displayedError) {
      errorRef.current?.focus();
    }
  }, [displayedError]);

  const selectFile = (file: File | null) => {
    if (!file) {
      return;
    }

    const validationError = validateEventImageSource(file);
    if (validationError) {
      setLocalError(getEventImageValidationMessage(validationError));
      onSelectedFileChange(null);
      return;
    }

    setLocalError(null);
    onSelectedFileChange(file);
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    selectFile(event.target.files?.[0] ?? null);
    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);

    if (busy || selectionDisabled) {
      return;
    }

    if (event.dataTransfer.files.length !== 1) {
      setLocalError("Выберите только один файл изображения.");
      onSelectedFileChange(null);
      return;
    }

    selectFile(event.dataTransfer.files[0] ?? null);
  };

  const cancelSelection = () => {
    setLocalError(null);
    onSelectedFileChange(null);
  };

  const dimensionWarnings = dimensions
    ? getEventImageDimensionWarnings(dimensions)
    : [];
  const localPreviewUrl = localPreview?.file === selectedFile
    ? localPreview.url
    : null;
  const effectivePreviewUrl = localPreviewUrl
    ?? (currentImageFailed ? null : currentImageUrl);
  const compactState = removing
    ? "Удаляем изображение..."
    : uploadStage && uploadStage !== "done"
      ? `${UPLOAD_STAGE_LABELS[uploadStage]} изображение...`
      : displayedError
        ? "Изображение требует внимания"
        : successMessage
          ? successMessage
          : uploadStage === "done"
            ? UPLOAD_STAGE_LABELS.done
            : selectedFile
              ? `Выбран новый файл: ${selectedFile.name}`
              : currentImageUrl
                ? "Текущее изображение сохранено"
                : "Изображение пока не выбрано";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialogOpen || !dialog) {
      return;
    }

    if (!dialog.open) {
      dialog.showModal();
    }
  }, [dialogOpen]);

  const closeDialog = () => {
    dialogRef.current?.close();
    setDialogOpen(false);
  };

  const renderMessages = () => (
    <>
      {displayedError ? (
        <div
          className="event-image-uploader__message event-image-uploader__message--error"
          ref={errorRef}
          role="alert"
          tabIndex={-1}
        >
          {displayedError}
        </div>
      ) : null}

      {successMessage ? (
        <div className="event-image-uploader__message event-image-uploader__message--success">
          {successMessage}
        </div>
      ) : null}
    </>
  );

  const renderImageActions = (className: string, includeSelectedCancel = true) => (
    <div className={className}>
      {localError && !selectedFile ? (
        <Button disabled={busy || removing} onClick={cancelSelection} size="sm" variant="ghost">
          Отменить выбор
        </Button>
      ) : null}
      {includeSelectedCancel && selectedFile ? (
        <Button disabled={busy || removing} onClick={cancelSelection} size="sm" variant="ghost">
          Отменить выбор
        </Button>
      ) : null}
      {error && selectedFile && onRetryImage ? (
        <Button disabled={busy || removing} onClick={onRetryImage} size="sm" variant="secondary">
          Повторить загрузку
        </Button>
      ) : null}
      {currentImageUrl && onRemoveImage ? (
        <Button disabled={busy || removing} onClick={onRemoveImage} size="sm" variant="destructive">
          {removing ? "Удаляем..." : "Удалить изображение"}
        </Button>
      ) : null}
    </div>
  );

  return (
    <div className="event-image-uploader" aria-busy={busy || removing}>
      <div className="event-image-uploader__compact">
        <button
          aria-label="Открыть подробный просмотр изображения события"
          className="event-image-uploader__thumbnail"
          onClick={() => setDialogOpen(true)}
          type="button"
        >
          {effectivePreviewUrl ? (
            <img
              alt=""
              onError={localPreviewUrl ? undefined : () => setCurrentImageFailed(true)}
              src={effectivePreviewUrl}
            />
          ) : (
            <span aria-hidden="true">Нет изображения</span>
          )}
        </button>

        <div className="event-image-uploader__compact-copy">
          <div className="event-image-uploader__head">
            <label className="event-image-uploader__label" htmlFor={inputId}>
              Изображение события
            </label>
            <p id={helperId}>
              JPG, PNG или WebP, до 12 МБ. Подробные превью доступны в просмотре.
            </p>
          </div>
          <div className={`event-image-uploader__compact-state${displayedError ? " event-image-uploader__compact-state--error" : selectedFile || busy || removing ? " event-image-uploader__compact-state--pending" : currentImageUrl || successMessage ? " event-image-uploader__compact-state--saved" : ""}`}>
            <strong>{compactState}</strong>
            <span aria-live="polite" className="event-image-uploader__stage visually-hidden">
              {uploadStage ? UPLOAD_STAGE_LABELS[uploadStage] : null}
            </span>
          </div>
        </div>

        <div className="event-image-uploader__compact-actions">
          <label className="button button--secondary button--sm event-image-uploader__file-action">
            <span>{currentImageUrl || selectedFile ? "Заменить изображение" : "Выбрать файл"}</span>
            <input
              accept={EVENT_IMAGE_ACCEPT}
              aria-describedby={helperId}
              disabled={busy || removing || selectionDisabled}
              id={inputId}
              onChange={handleInputChange}
              type="file"
            />
          </label>
          <Button onClick={() => setDialogOpen(true)} size="sm" variant="ghost">
            Просмотреть
          </Button>
          {renderImageActions("event-image-uploader__actions")}
        </div>
      </div>

      {!dialogOpen ? renderMessages() : null}

      {dialogOpen ? (
        <dialog
          aria-describedby={dialogDescriptionId}
          aria-labelledby={dialogTitleId}
          className="event-image-uploader__dialog"
          onCancel={(event) => {
            event.preventDefault();
            closeDialog();
          }}
          onClose={() => setDialogOpen(false)}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeDialog();
            }
          }}
          ref={dialogRef}
        >
          <div className="event-image-uploader__dialog-head">
            <div>
              <span>Изображение события</span>
              <h2 id={dialogTitleId}>Подробный просмотр</h2>
              <p id={dialogDescriptionId}>
                Проверьте исходное изображение, кадрирование и данные файла.
              </p>
            </div>
            <Button onClick={closeDialog} size="sm" variant="ghost">
              Закрыть
            </Button>
          </div>

          {renderMessages()}

          <div
            className={[
              "event-image-uploader__drop-zone",
              dragActive ? "event-image-uploader__drop-zone--active" : "",
            ].filter(Boolean).join(" ")}
            onDragEnter={(event) => {
              event.preventDefault();
              if (!busy && !selectionDisabled) setDragActive(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setDragActive(false);
              }
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
          >
            <div>
              <strong>Перетащите изображение сюда</strong>
              <span>или выберите файл на устройстве</span>
            </div>
            <label className="button button--secondary button--md event-image-uploader__file-action">
              <span>{currentImageUrl || selectedFile ? "Заменить изображение" : "Выбрать файл"}</span>
              <input
                accept={EVENT_IMAGE_ACCEPT}
                aria-describedby={dialogDescriptionId}
                disabled={busy || removing || selectionDisabled}
                id={detailInputId}
                onChange={handleInputChange}
                type="file"
              />
            </label>
          </div>

          <div className="event-image-uploader__dialog-body">
            {currentImageUrl ? (
              <section className="event-image-uploader__source event-image-uploader__source--current">
                <div>
                  <strong>Текущее изображение</strong>
                  <span>Останется без изменений, пока новая загрузка не завершится.</span>
                </div>
                {currentImageFailed ? (
                  <div className="event-image-uploader__fallback">Текущее изображение недоступно для предпросмотра.</div>
                ) : (
                  <img
                    alt="Текущее изображение события"
                    onError={() => setCurrentImageFailed(true)}
                    src={currentImageUrl}
                  />
                )}
              </section>
            ) : null}

            {selectedFile && localPreviewUrl ? (
              <section className="event-image-uploader__source event-image-uploader__source--local">
                <div className="event-image-uploader__local-head">
                  <div>
                    <strong>Новое изображение — локальный предпросмотр</strong>
                    <span>{selectedFile.name}</span>
                  </div>
                  <Button disabled={busy || removing} onClick={cancelSelection} size="sm" variant="ghost">
                    Отменить выбор
                  </Button>
                </div>
                <img alt="Выбранное новое изображение события" src={localPreviewUrl} />
                <dl className="event-image-uploader__metadata">
                  <div>
                    <dt>Размер файла</dt>
                    <dd>{formatEventImageSourceSize(selectedFile.size)}</dd>
                  </div>
                  {dimensions ? (
                    <div>
                      <dt>Размер изображения</dt>
                      <dd>{dimensions.width}×{dimensions.height} px</dd>
                    </div>
                  ) : null}
                </dl>
                {dimensionWarnings.length > 0 ? (
                  <ul className="event-image-uploader__warnings">
                    {dimensionWarnings.map((warning) => <li key={warning}>{warning}</li>)}
                  </ul>
                ) : null}
              </section>
            ) : null}

            {effectivePreviewUrl ? (
              <section className="event-image-uploader__display-preview">
                <div>
                  <strong>Предпросмотр отображения</strong>
                  <span>Фактическое кадрирование зависит от карточки события.</span>
                </div>
                <div className="event-image-uploader__preview-grid">
                  <figure>
                    <div className="event-image-uploader__preview-frame event-image-uploader__preview-frame--contain">
                      <img alt="Изображение события целиком" src={effectivePreviewUrl} />
                    </div>
                    <figcaption>Целиком (contain)</figcaption>
                  </figure>
                  <figure>
                    <div className="event-image-uploader__preview-frame event-image-uploader__preview-frame--cover">
                      <img alt="Изображение события с возможным кадрированием" src={effectivePreviewUrl} />
                    </div>
                    <figcaption>С заполнением (cover)</figcaption>
                  </figure>
                </div>
              </section>
            ) : (
              <div className="event-image-uploader__fallback">Изображение пока не выбрано.</div>
            )}
          </div>

          <div className="event-image-uploader__dialog-footer">
            <div aria-live="polite" className="event-image-uploader__stage">
              {uploadStage ? UPLOAD_STAGE_LABELS[uploadStage] : null}
            </div>
            {renderImageActions(
              "event-image-uploader__actions event-image-uploader__dialog-actions",
              false,
            )}
          </div>
        </dialog>
      ) : null}
    </div>
  );
}
