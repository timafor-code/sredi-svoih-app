import { useEffect, useState } from "react";

import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import {
  getAdminEventWebRegistration,
  updateAdminEventWebRegistration,
} from "../../services/adminEventsService";
import type {
  AdminEventWebRegistration,
  AdminEventWebVisibilityUpdate,
} from "../../types/events";

type EventWebRegistrationCardProps = {
  eventId: string;
};

type CopyFeedback = {
  kind: "success" | "error";
  message: string;
};

const WEB_VISIBILITY_LABELS: Record<AdminEventWebVisibilityUpdate, string> = {
  disabled: "Выключено",
  unlisted: "Только по ссылке",
};

function formatOccurrenceDate(startsAt: string): string {
  const date = new Date(startsAt);

  if (Number.isNaN(date.getTime())) {
    return "Дата и время недоступны";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(date);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function EventWebRegistrationCard({ eventId }: EventWebRegistrationCardProps) {
  const [registration, setRegistration] = useState<AdminEventWebRegistration | null>(null);
  const [selectedVisibility, setSelectedVisibility] =
    useState<AdminEventWebVisibilityUpdate>("disabled");
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<Record<string, CopyFeedback>>({});

  useEffect(() => {
    let active = true;

    setRegistration(null);
    setLoading(true);
    setLoadError(null);
    setSaving(false);
    setSaveError(null);
    setSaveMessage(null);
    setCopyFeedback({});

    void getAdminEventWebRegistration(eventId)
      .then((nextRegistration) => {
        if (!active) return;

        setRegistration(nextRegistration);
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
  }, [eventId, reloadKey]);

  const handleSave = async () => {
    if (!registration || registration.webVisibility === "listed" || saving) return;

    setSaving(true);
    setSaveError(null);
    setSaveMessage(null);

    try {
      const nextRegistration = await updateAdminEventWebRegistration(eventId, {
        webVisibility: selectedVisibility,
      });
      setRegistration(nextRegistration);
      if (nextRegistration.webVisibility !== "listed") {
        setSelectedVisibility(nextRegistration.webVisibility);
      }
      setSaveMessage("Режим публикации сохранён");
    } catch (error) {
      setSaveError(
        errorMessage(error, "Не удалось сохранить режим веб-регистрации."),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async (
    feedbackKey: string,
    url: string,
    successMessage: string,
  ) => {
    setCopyFeedback((current) => {
      const next = { ...current };
      delete next[feedbackKey];
      return next;
    });

    try {
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable");
      }

      await navigator.clipboard.writeText(url);
      setCopyFeedback((current) => ({
        ...current,
        [feedbackKey]: { kind: "success", message: successMessage },
      }));
    } catch {
      setCopyFeedback((current) => ({
        ...current,
        [feedbackKey]: {
          kind: "error",
          message: "Не удалось скопировать ссылку. Скопируйте её из поля вручную.",
        },
      }));
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
            <p>Публикация страницы регистрации и стабильные ссылки события.</p>
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
  const mainFeedback = copyFeedback.main;

  return (
    <GlassCard
      aria-busy={saving}
      className="event-web-registration-card"
      elevated
    >
      <div className="event-web-registration-card__head">
        <div>
          <h2>Веб-регистрация</h2>
          <p>Управляйте доступностью страницы и копируйте ссылки для участников.</p>
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
              disabled={saving}
              id={`web-visibility-${eventId}`}
              onChange={(event) => {
                setSelectedVisibility(event.target.value as AdminEventWebVisibilityUpdate);
                setSaveError(null);
                setSaveMessage(null);
              }}
              value={selectedVisibility}
            >
              <option value="disabled">Выключено</option>
              <option value="unlisted">Только по ссылке</option>
            </select>
          </label>
          <Button
            disabled={saving || selectedVisibility === registration.webVisibility}
            onClick={() => void handleSave()}
            variant="primary"
          >
            {saving ? "Сохраняем…" : "Сохранить режим"}
          </Button>
        </div>
      )}

      {saveMessage ? (
        <p className="event-web-registration-feedback event-web-registration-feedback--success" role="status">
          {saveMessage}
        </p>
      ) : null}
      {saveError ? (
        <p className="event-web-registration-feedback event-web-registration-feedback--error" role="alert">
          {saveError}
        </p>
      ) : null}

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
        <label className="event-form-field">
          <span>Ссылка на страницу регистрации</span>
          <input readOnly type="url" value={registration.publicRegistrationUrl} />
        </label>
        <div className="event-web-registration-card__actions">
          <Button
            onClick={() =>
              void handleCopy("main", registration.publicRegistrationUrl, mainCopyMessage)
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
        {mainFeedback ? (
          <p
            className={`event-web-registration-feedback event-web-registration-feedback--${mainFeedback.kind}`}
            role={mainFeedback.kind === "error" ? "alert" : "status"}
          >
            {mainFeedback.message}
          </p>
        ) : null}
      </div>

      {registration.occurrenceUrls.length > 0 ? (
        <div className="event-web-registration-card__occurrences">
          <h3>Ссылки на отдельные даты</h3>
          <ul>
            {registration.occurrenceUrls.map((occurrence) => {
              const feedbackKey = `occurrence-${occurrence.occurrenceId}`;
              const feedback = copyFeedback[feedbackKey];

              return (
                <li key={occurrence.occurrenceId}>
                  <div>
                    <strong>{formatOccurrenceDate(occurrence.startsAt)}</strong>
                    <Button
                      onClick={() =>
                        void handleCopy(
                          feedbackKey,
                          occurrence.url,
                          "Ссылка на эту дату скопирована",
                        )
                      }
                      size="sm"
                      variant="ghost"
                    >
                      Копировать ссылку на эту дату
                    </Button>
                  </div>
                  {feedback ? (
                    <p
                      className={`event-web-registration-feedback event-web-registration-feedback--${feedback.kind}`}
                      role={feedback.kind === "error" ? "alert" : "status"}
                    >
                      {feedback.message}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </GlassCard>
  );
}
