import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { SaveStatusView } from "../ui/SaveStatusView";
import { GlassCard } from "../ui/GlassCard";
import { ApiClientError } from "../../services/apiClient";
import {
  checkAdminEventPublicSlug,
  getAdminEventWebRegistration,
  updateAdminEventWebRegistration,
} from "../../services/adminEventsService";
import type {
  AdminEventWebRegistration,
  AdminEventWebVisibilityUpdate,
} from "../../types/events";

type EventWebRegistrationCardProps = {
  eventId: string;
  onDirtyChange?: (dirty: boolean) => void;
  eventTitle: string;
};

type CopyFeedback = {
  kind: "success" | "error";
  message: string;
};

type SlugCheckState =
  | { kind: "idle" }
  | { kind: "checking"; key: string }
  | { kind: "available"; key: string; normalizedSlug: string }
  | { kind: "taken"; key: string; normalizedSlug: string }
  | { kind: "invalid"; key: string }
  | { kind: "error"; key: string };

type TrustedPublicUrl = {
  prefix: string;
};

const SLUG_CHECK_DEBOUNCE_MS = 400;

const WEB_VISIBILITY_LABELS: Record<AdminEventWebVisibilityUpdate, string> = {
  disabled: "Выключено",
  unlisted: "Только по ссылке",
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function slugCheckValue(suffix: string, eventTitle: string): string {
  return suffix.trim() === "" ? eventTitle : suffix;
}

function slugCheckKey(suffix: string, eventTitle: string): string {
  return JSON.stringify([suffix, slugCheckValue(suffix, eventTitle)]);
}

function trustedPublicUrl(
  publicSlug: string,
  publicRegistrationUrl: string,
): TrustedPublicUrl | null {
  try {
    const parsed = new URL(publicRegistrationUrl);
    const suffixPath = `/events/${publicSlug}`;

    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:")
      || parsed.username !== ""
      || parsed.password !== ""
      || parsed.search !== ""
      || parsed.hash !== ""
      || !parsed.pathname.endsWith(suffixPath)
    ) {
      return null;
    }

    return {
      prefix: `${parsed.origin}${parsed.pathname.slice(0, -publicSlug.length)}`,
    };
  } catch {
    return null;
  }
}

export function EventWebRegistrationCard({
  eventId,
  eventTitle,
  onDirtyChange,
}: EventWebRegistrationCardProps) {
  const [registration, setRegistration] = useState<AdminEventWebRegistration | null>(null);
  const [selectedVisibility, setSelectedVisibility] =
    useState<AdminEventWebVisibilityUpdate>("disabled");
  const [slugSuffix, setSlugSuffix] = useState("");
  const [slugCheck, setSlugCheck] = useState<SlugCheckState>({ kind: "idle" });
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [visibilitySaving, setVisibilitySaving] = useState(false);
  const [visibilitySaveError, setVisibilitySaveError] = useState<string | null>(null);
  const [visibilitySavedAt, setVisibilitySavedAt] = useState<string | null>(null);
  const [slugSaving, setSlugSaving] = useState(false);
  const [slugSaveError, setSlugSaveError] = useState<string | null>(null);
  const [slugSavedAt, setSlugSavedAt] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback | null>(null);
  const slugDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slugAbortRef = useRef<AbortController | null>(null);
  const slugRequestSequenceRef = useRef(0);
  const mountedRef = useRef(false);

  const dirty = Boolean(registration && (
    (registration.webVisibility !== "listed" && selectedVisibility !== registration.webVisibility)
    || slugSuffix !== registration.publicSlug
  ));

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [eventId, onDirtyChange]);

  const cancelSlugWork = useCallback(() => {
    if (slugDebounceRef.current !== null) {
      clearTimeout(slugDebounceRef.current);
      slugDebounceRef.current = null;
    }
    slugAbortRef.current?.abort();
    slugAbortRef.current = null;
    slugRequestSequenceRef.current += 1;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelSlugWork();
    };
  }, [cancelSlugWork]);

  const performSlugCheck = useCallback(
    async (suffix: string, title: string) => {
      cancelSlugWork();
      const key = slugCheckKey(suffix, title);
      const value = slugCheckValue(suffix, title);
      const controller = new AbortController();
      const requestSequence = slugRequestSequenceRef.current;
      slugAbortRef.current = controller;
      setSlugCheck({ kind: "checking", key });

      try {
        const result = await checkAdminEventPublicSlug(eventId, value, controller.signal);
        if (!mountedRef.current || requestSequence !== slugRequestSequenceRef.current) {
          return;
        }

        setSlugCheck(
          result.available
            ? { kind: "available", key, normalizedSlug: result.normalizedSlug }
            : { kind: "taken", key, normalizedSlug: result.normalizedSlug },
        );
      } catch (error) {
        if (
          !mountedRef.current
          || controller.signal.aborted
          || requestSequence !== slugRequestSequenceRef.current
        ) {
          return;
        }

        setSlugCheck(
          error instanceof ApiClientError && error.code === "invalid_public_slug"
            ? { kind: "invalid", key }
            : { kind: "error", key },
        );
      } finally {
        if (slugAbortRef.current === controller) {
          slugAbortRef.current = null;
        }
      }
    },
    [cancelSlugWork, eventId],
  );

  const scheduleSlugCheck = useCallback(
    (suffix: string, title: string) => {
      cancelSlugWork();
      const key = slugCheckKey(suffix, title);
      setSlugCheck({ kind: "checking", key });
      slugDebounceRef.current = setTimeout(() => {
        slugDebounceRef.current = null;
        void performSlugCheck(suffix, title);
      }, SLUG_CHECK_DEBOUNCE_MS);
    },
    [cancelSlugWork, performSlugCheck],
  );

  useEffect(() => {
    let active = true;

    cancelSlugWork();
    setRegistration(null);
    setLoading(true);
    setLoadError(null);
    setVisibilitySaving(false);
    setVisibilitySaveError(null);
    setVisibilitySavedAt(null);
    setSlugSaving(false);
    setSlugSaveError(null);
    setSlugSavedAt(null);
    setSlugCheck({ kind: "idle" });
    setCopyFeedback(null);

    void getAdminEventWebRegistration(eventId)
      .then((nextRegistration) => {
        if (!active) return;

        setRegistration(nextRegistration);
        setSlugSuffix(nextRegistration.publicSlug);
        if (nextRegistration.webVisibility !== "listed") {
          setSelectedVisibility(nextRegistration.webVisibility);
        }
      })
      .catch((error: unknown) => {
        if (!active) return;

        setLoadError(
          errorMessage(error, "Не удалось загрузить настройки веб-регистрации."),
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [cancelSlugWork, eventId, reloadKey]);

  const publicUrl = useMemo(
    () => registration
      ? trustedPublicUrl(registration.publicSlug, registration.publicRegistrationUrl)
      : null,
    [registration],
  );

  useEffect(() => {
    if (registration && publicUrl && slugSuffix.trim() === "") {
      scheduleSlugCheck(slugSuffix, eventTitle);
    }
  }, [eventTitle, publicUrl, registration, scheduleSlugCheck, slugSuffix]);

  const handleVisibilitySave = async () => {
    if (
      !registration
      || registration.webVisibility === "listed"
      || visibilitySaving
    ) {
      return;
    }

    setVisibilitySaving(true);
    setVisibilitySaveError(null);
    setVisibilitySavedAt(null);

    try {
      const nextRegistration = await updateAdminEventWebRegistration(eventId, {
        webVisibility: selectedVisibility,
      });
      setRegistration(nextRegistration);
      if (nextRegistration.webVisibility !== "listed") {
        setSelectedVisibility(nextRegistration.webVisibility);
      }
      setVisibilitySavedAt(new Date().toISOString());
    } catch (error) {
      setVisibilitySaveError(
        errorMessage(error, "Не удалось сохранить режим веб-регистрации."),
      );
    } finally {
      setVisibilitySaving(false);
    }
  };

  const currentSlugKey = slugCheckKey(slugSuffix, eventTitle);
  const checkedSlug = slugCheck.kind === "available" && slugCheck.key === currentSlugKey
    ? slugCheck.normalizedSlug
    : null;
  const canSaveSlug = Boolean(
    registration
    && publicUrl
    && checkedSlug
    && checkedSlug !== registration.publicSlug
    && !slugSaving,
  );

  const handleSlugSave = async () => {
    if (!registration || !checkedSlug || !canSaveSlug) return;

    setSlugSaving(true);
    setSlugSaveError(null);
    setSlugSavedAt(null);

    try {
      const nextRegistration = await updateAdminEventWebRegistration(eventId, {
        publicSlug: checkedSlug,
      });
      cancelSlugWork();
      setRegistration(nextRegistration);
      setSlugSuffix(nextRegistration.publicSlug);
      setSlugCheck({ kind: "idle" });
      setSlugSavedAt(new Date().toISOString());
      setCopyFeedback(null);
    } catch (error) {
      if (
        error instanceof ApiClientError
        && (error.status === 409 || error.code === "public_slug_taken")
      ) {
        setSlugCheck({ kind: "taken", key: currentSlugKey, normalizedSlug: checkedSlug });
        setSlugSaveError("Адрес уже занят");
      } else if (
        error instanceof ApiClientError
        && (error.status === 422 || error.code === "invalid_public_slug")
        && error.code === "invalid_public_slug"
      ) {
        setSlugCheck({ kind: "invalid", key: currentSlugKey });
        setSlugSaveError("Недопустимый формат");
      } else {
        setSlugSaveError("Не удалось сохранить адрес страницы. Попробуйте ещё раз.");
      }
    } finally {
      setSlugSaving(false);
    }
  };

  const handleCopy = async (url: string, successMessage: string) => {
    setCopyFeedback(null);

    try {
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable");
      }

      await navigator.clipboard.writeText(url);
      setCopyFeedback({ kind: "success", message: successMessage });
    } catch {
      setCopyFeedback({
        kind: "error",
        message: "Не удалось скопировать ссылку. Скопируйте показанный адрес вручную.",
      });
    }
  };

  if (loading) {
    return (
      <GlassCard className="event-web-registration-card" elevated>
        <div className="event-web-registration-card__state" role="status">
          Загружаем настройки веб-регистрации…
        </div>
      </GlassCard>
    );
  }

  if (loadError || !registration) {
    return (
      <GlassCard className="event-web-registration-card" elevated>
        <div className="event-web-registration-card__head">
          <div>
            <h2>Веб-регистрация</h2>
            <p>Публикация страницы регистрации и стабильный адрес события.</p>
          </div>
        </div>
        <div className="form-error" role="alert">
          {loadError ?? "Настройки веб-регистрации не были получены."}
        </div>
        <div>
          <Button onClick={() => setReloadKey((key) => key + 1)} variant="secondary">
            Повторить
          </Button>
        </div>
      </GlassCard>
    );
  }

  const isDisabled = registration.webVisibility === "disabled";
  const isListed = registration.webVisibility === "listed";
  const mainCopyMessage = isDisabled
    ? "Ссылка скопирована. Страница сейчас отключена и недоступна участникам."
    : "Ссылка скопирована";
  const previewUrl = publicUrl && (
    (slugCheck.kind === "available" || slugCheck.kind === "taken")
    && slugCheck.key === currentSlugKey
  )
    ? `${publicUrl.prefix}${slugCheck.normalizedSlug}`
    : slugSuffix === registration.publicSlug
      ? registration.publicRegistrationUrl
      : null;
  const slugInputId = `public-slug-${eventId}`;
  const slugPreviewId = `${slugInputId}-preview`;
  const slugStatusId = `${slugInputId}-status`;
  const slugStatus = slugCheck.kind !== "idle" && slugCheck.key === currentSlugKey
    ? slugCheck.kind
    : "idle";

  return (
    <GlassCard
      aria-busy={visibilitySaving || slugSaving}
      className="event-web-registration-card"
      elevated
    >
      <div className="event-web-registration-card__head">
        <div>
          <h2>Веб-регистрация</h2>
          <p>Управляйте доступностью страницы и её постоянным адресом.</p>
        </div>
        <Badge tone={isDisabled ? "red" : isListed ? "blue" : "gold"}>
          {registration.webVisibility === "listed"
            ? "В каталоге"
            : WEB_VISIBILITY_LABELS[registration.webVisibility]}
        </Badge>
      </div>

      {isListed ? (
        <div className="event-web-registration-card__listed">
          <strong>В каталоге</strong>
          <p>
            Событие опубликовано в режиме каталога. Публикация в каталоге не управляется
            текущим MVP-интерфейсом; статус доступен только для чтения.
          </p>
        </div>
      ) : (
        <div className="event-web-registration-card__publication">
          <label className="event-form-field" htmlFor={`web-visibility-${eventId}`}>
            <span>Режим публикации</span>
            <select
              disabled={visibilitySaving}
              id={`web-visibility-${eventId}`}
              onChange={(event) => {
                setSelectedVisibility(event.target.value as AdminEventWebVisibilityUpdate);
                setVisibilitySaveError(null);
                setVisibilitySavedAt(null);
              }}
              value={selectedVisibility}
            >
              <option value="disabled">Выключено</option>
              <option value="unlisted">Только по ссылке</option>
            </select>
          </label>
          <Button
            disabled={
              visibilitySaving || selectedVisibility === registration.webVisibility
            }
            onClick={() => void handleVisibilitySave()}
            variant="success"
          >
            {visibilitySaving ? "Сохраняем…" : "Сохранить режим"}
          </Button>
        </div>
      )}

      <SaveStatusView
        saving={visibilitySaving}
        error={visibilitySaveError}
        savedAt={visibilitySavedAt}
        unsaved={registration.webVisibility !== "listed" && selectedVisibility !== registration.webVisibility}
        recovery="Повторите сохранение режима."
      />

      <div className="event-web-registration-card__slug-editor">
        <div className="event-web-registration-card__slug-heading">
          <h3>Адрес страницы</h3>
          <p>Изменяется только часть адреса после неизменяемого префикса.</p>
        </div>
        <label className="event-form-field" htmlFor={slugInputId}>
          <span>Человекопонятный адрес</span>
          <span className="event-web-registration-card__slug-field">
            <span aria-hidden="true" className="event-web-registration-card__slug-prefix">
              {publicUrl?.prefix ?? "Адрес недоступен"}
            </span>
            <input
              aria-describedby={`${slugPreviewId} ${slugStatusId}`}
              autoComplete="off"
              disabled={!publicUrl || slugSaving}
              id={slugInputId}
              inputMode="url"
              onBlur={() => {
                const key = slugCheckKey(slugSuffix, eventTitle);
                const hasCurrentTerminalResult = slugCheck.kind !== "idle"
                  && slugCheck.key === key
                  && (
                    slugCheck.kind === "available"
                    || slugCheck.kind === "taken"
                    || slugCheck.kind === "invalid"
                  );

                if (publicUrl && !hasCurrentTerminalResult) {
                  void performSlugCheck(slugSuffix, eventTitle);
                }
              }}
              onChange={(event) => {
                const nextSuffix = event.target.value;
                setSlugSuffix(nextSuffix);
                setSlugSaveError(null);
                setSlugSavedAt(null);
                if (publicUrl) {
                  scheduleSlugCheck(nextSuffix, eventTitle);
                }
              }}
              spellCheck={false}
              type="text"
              value={slugSuffix}
            />
          </span>
        </label>
        <p className="event-web-registration-card__slug-preview" id={slugPreviewId}>
          <span>Предпросмотр</span>
          {previewUrl ? (
            <strong>{previewUrl}</strong>
          ) : (
            <span>Итоговый адрес появится после проверки.</span>
          )}
        </p>
        <div id={slugStatusId}>
          {!publicUrl ? (
            <p className="event-web-registration-feedback event-web-registration-feedback--error" role="alert">
              Не удалось определить доверенный адрес страницы. Проверьте конфигурацию backend.
            </p>
          ) : slugStatus === "checking" ? (
            <p className="event-web-registration-feedback" role="status" aria-live="polite">
              Проверяем…
            </p>
          ) : slugStatus === "available" ? (
            <p className="event-web-registration-feedback event-web-registration-feedback--success" role="status" aria-live="polite">
              Адрес свободен
            </p>
          ) : slugStatus === "taken" ? (
            <p className="event-web-registration-feedback event-web-registration-feedback--error" role="alert">
              Адрес уже занят
            </p>
          ) : slugStatus === "invalid" ? (
            <p className="event-web-registration-feedback event-web-registration-feedback--error" role="alert">
              Недопустимый формат
            </p>
          ) : slugStatus === "error" ? (
            <p className="event-web-registration-feedback event-web-registration-feedback--error" role="alert">
              Не удалось проверить адрес
            </p>
          ) : null}
        </div>
        <div className="event-web-registration-card__slug-actions">
          <Button
            disabled={!canSaveSlug}
            onClick={() => void handleSlugSave()}
            variant="success"
          >
            {slugSaving ? "Сохраняем…" : "Сохранить адрес"}
          </Button>
        </div>
        <SaveStatusView
          saving={slugSaving}
          error={slugSaveError}
          savedAt={slugSavedAt}
          unsaved={slugSuffix !== registration.publicSlug}
          recovery="Проверьте адрес и повторите сохранение."
        />
      </div>

      <div className="event-web-registration-card__availability">
        {isDisabled ? (
          <>
            <strong>Страница пока недоступна участникам</strong>
            <p>
              Стабильную ссылку можно подготовить заранее, но страница откроется только
              после включения публикации.
            </p>
          </>
        ) : registration.webVisibility === "unlisted" ? (
          <>
            <strong>Только по ссылке</strong>
            <p>Событие доступно по прямой ссылке и не показывается в общем каталоге.</p>
          </>
        ) : (
          <p>Страница доступна участникам в текущем режиме публикации.</p>
        )}
      </div>

      <div className="event-web-registration-card__main-link">
        <div className="event-form-field">
          <span>Сохранённая ссылка на страницу регистрации</span>
          <div className="event-web-registration-card__canonical-url">
            {registration.publicRegistrationUrl}
          </div>
        </div>
        <div className="event-web-registration-card__actions">
          <Button
            onClick={() =>
              void handleCopy(registration.publicRegistrationUrl, mainCopyMessage)
            }
            variant="secondary"
          >
            Копировать ссылку
          </Button>
          {isDisabled ? (
            <Button disabled variant="secondary">
              Открыть страницу
            </Button>
          ) : (
            <a
              className="button button--secondary button--md event-web-registration-card__open-link"
              href={registration.publicRegistrationUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              Открыть страницу
            </a>
          )}
        </div>
        {copyFeedback ? (
          <p
            className={`event-web-registration-feedback event-web-registration-feedback--${copyFeedback.kind}`}
            role={copyFeedback.kind === "error" ? "alert" : "status"}
          >
            {copyFeedback.message}
          </p>
        ) : null}
      </div>
    </GlassCard>
  );
}
