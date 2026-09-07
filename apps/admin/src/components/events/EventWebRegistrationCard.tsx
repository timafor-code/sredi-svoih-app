import { useEffect } from "react";

import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { SaveStatusView } from "../ui/SaveStatusView";
import { useEventWebRegistrationEditor } from "./useEventWebRegistrationEditor";

type EventWebRegistrationCardProps = {
  eventId: string;
  eventTitle: string;
  editor: ReturnType<typeof useEventWebRegistrationEditor>;
  onDirtyChange?: (dirty: boolean) => void;
};

export function EventWebRegistrationCard({
  eventId,
  eventTitle,
  editor,
  onDirtyChange,
}: EventWebRegistrationCardProps) {
  useEffect(() => { onDirtyChange?.(editor.dirty); }, [editor.dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [eventId, onDirtyChange]);

  if (editor.loading) {
    return <GlassCard className="event-web-registration-card" elevated>
      <div className="event-web-registration-card__state" role="status">
        Загружаем настройки веб-регистрации…
      </div>
    </GlassCard>;
  }

  if (editor.loadError || !editor.registration) {
    return <GlassCard className="event-web-registration-card" elevated>
      <div className="event-web-registration-card__head"><div>
        <h2>Веб-регистрация</h2>
        <p>Прямая ссылка и постоянный адрес события.</p>
      </div></div>
      <div className="form-error" role="alert">
        {editor.loadError ?? "Настройки веб-регистрации не были получены."}
      </div>
      <div><Button onClick={editor.refresh} variant="secondary">Повторить</Button></div>
    </GlassCard>;
  }

  const { registration } = editor;
  const isDisabled = registration.webVisibility === "disabled";
  const isListed = registration.webVisibility === "listed";
  const slugInputId = `public-slug-${eventId}`;
  const slugPreviewId = `${slugInputId}-preview`;
  const slugStatusId = `${slugInputId}-status`;
  const currentSlugKey = JSON.stringify([
    editor.slugSuffix,
    editor.slugSuffix.trim() === "" ? eventTitle : editor.slugSuffix,
  ]);
  const previewUrl = editor.publicUrl && (
    (editor.slugCheck.kind === "available" || editor.slugCheck.kind === "taken")
    && editor.slugCheck.key === currentSlugKey
  )
    ? `${editor.publicUrl.prefix}${editor.slugCheck.normalizedSlug}`
    : editor.slugSuffix === registration.publicSlug ? registration.publicRegistrationUrl : null;

  const disable = () => {
    if (window.confirm("Отключить веб-регистрацию? Прямая ссылка останется сохранённой, но будет недоступна участникам.")) {
      void editor.changeVisibility("disabled");
    }
  };

  return <GlassCard aria-busy={editor.visibilitySaving || editor.slugSaving} className="event-web-registration-card" elevated>
    <div className="event-web-registration-card__head">
      <div>
        <h2>Веб-регистрация</h2>
        <p>Прямая ссылка включается автоматически для внутренней регистрации.</p>
      </div>
      <Badge tone={isDisabled ? "red" : isListed ? "blue" : "gold"}>
        {isListed ? "В каталоге" : isDisabled ? "Выключено" : "Только по ссылке"}
      </Badge>
    </div>

    {isListed ? <div className="event-web-registration-card__listed">
      <strong>В каталоге</strong>
      <p>Публикация в каталоге не управляется текущим интерфейсом и остаётся доступной только для чтения.</p>
    </div> : <div className="event-web-registration-card__availability">
      {isDisabled ? <><strong>Страница отключена</strong><p>Ссылка сохранена, но пока недоступна участникам.</p></>
        : <><strong>Только по ссылке</strong><p>Веб-регистрация включена по прямой ссылке и не публикует событие в каталоге.</p></>}
      <div className="event-web-registration-card__actions">
        {isDisabled ? <Button disabled={editor.visibilitySaving} onClick={() => void editor.changeVisibility("unlisted")} variant="success">
          {editor.visibilitySaving ? "Сохраняем…" : "Включить веб-регистрацию"}
        </Button> : <Button disabled={editor.visibilitySaving} onClick={disable} variant="secondary">Отключить веб-регистрацию</Button>}
      </div>
      <SaveStatusView saving={editor.visibilitySaving} error={editor.visibilitySaveError}
        savedAt={editor.visibilitySavedAt} recovery="Повторите сохранение режима." />
    </div>}

    <div className="event-web-registration-card__slug-editor">
      <div className="event-web-registration-card__slug-heading">
        <h3>Адрес страницы</h3><p>Изменяется только часть адреса после неизменяемого префикса.</p>
      </div>
      <label className="event-form-field" htmlFor={slugInputId}>
        <span>Человекопонятный адрес</span>
        <span className="event-web-registration-card__slug-field">
          <span aria-hidden="true" className="event-web-registration-card__slug-prefix">{editor.publicUrl?.prefix ?? "Адрес недоступен"}</span>
          <input aria-describedby={`${slugPreviewId} ${slugStatusId}`} autoComplete="off" disabled={!editor.publicUrl || editor.slugSaving}
            id={slugInputId} inputMode="url" onBlur={editor.checkSlugNow}
            onChange={(event) => editor.changeSlug(event.target.value)} spellCheck={false} type="text" value={editor.slugSuffix} />
        </span>
      </label>
      <p className="event-web-registration-card__slug-preview" id={slugPreviewId}>
        <span>Предпросмотр</span>{previewUrl ? <strong>{previewUrl}</strong> : <span>Итоговый адрес появится после проверки.</span>}
      </p>
      <div id={slugStatusId}>
        {!editor.publicUrl ? <p className="event-web-registration-feedback event-web-registration-feedback--error" role="alert">Не удалось определить доверенный адрес страницы. Проверьте конфигурацию backend.</p>
          : editor.slugStatus === "checking" ? <p className="event-web-registration-feedback" role="status">Проверяем…</p>
          : editor.slugStatus === "available" ? <p className="event-web-registration-feedback event-web-registration-feedback--success" role="status">Адрес свободен</p>
          : editor.slugStatus === "taken" ? <p className="event-web-registration-feedback event-web-registration-feedback--error" role="alert">Адрес уже занят</p>
          : editor.slugStatus === "invalid" ? <p className="event-web-registration-feedback event-web-registration-feedback--error" role="alert">Недопустимый формат</p>
          : editor.slugStatus === "error" ? <p className="event-web-registration-feedback event-web-registration-feedback--error" role="alert">Не удалось проверить адрес</p> : null}
      </div>
      <div className="event-web-registration-card__slug-actions">
        <SaveStatusView saving={editor.slugSaving} error={editor.slugSaveError} savedAt={editor.slugSavedAt}
          unsaved={editor.dirty} recovery="Проверьте адрес и повторите сохранение." />
        <Button disabled={!editor.canSaveSlug} onClick={() => void editor.saveSlug()} variant="success">
          {editor.slugSaving ? "Сохраняем…" : "Сохранить адрес"}
        </Button>
      </div>
    </div>

    <div className="event-web-registration-card__main-link">
      <div className="event-form-field"><span>Сохранённая ссылка на страницу регистрации</span>
        <div className={`event-web-registration-card__canonical-url${isDisabled ? " event-web-registration-card__canonical-url--disabled" : ""}`}>{registration.publicRegistrationUrl}</div>
      </div>
      <div className="event-web-registration-card__actions">
        <Button onClick={() => void editor.copyCanonicalUrl()} variant="secondary">Копировать ссылку</Button>
        {isDisabled ? <Button disabled variant="secondary">Открыть страницу</Button> : <a className="button button--secondary button--md event-web-registration-card__open-link" href={registration.publicRegistrationUrl} rel="noopener noreferrer" target="_blank">Открыть страницу</a>}
      </div>
      {editor.copyFeedback ? <p className={`event-web-registration-feedback event-web-registration-feedback--${editor.copyFeedback.kind}`} role={editor.copyFeedback.kind === "error" ? "alert" : "status"}>{editor.copyFeedback.message}</p> : null}
    </div>
  </GlassCard>;
}
