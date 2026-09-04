import { useId } from "react";

import { Button } from "../ui/Button";
import { SaveStatusView } from "../ui/SaveStatusView";

export type SingleEventRegistrationPeriodValues = {
  opensOnPublication: boolean;
  registrationOpensAt: string;
  registrationClosesAt: string;
};

type SingleEventRegistrationPeriodFormProps = {
  eventDateError: string | null;
  eventDateSummary: string;
  eventStatus?: string | null;
  onChange: (values: SingleEventRegistrationPeriodValues) => void;
  onSave: () => void;
  openingError?: string;
  closingError?: string;
  saveError: string | null;
  saving: boolean;
  timezone: string;
  unsaved: boolean;
  values: SingleEventRegistrationPeriodValues;
};

export function SingleEventRegistrationPeriodForm({
  eventDateError, eventDateSummary, eventStatus, onChange, onSave,
  openingError, closingError, saveError, saving, timezone, unsaved, values,
}: SingleEventRegistrationPeriodFormProps) {
  const id = useId();

  return (
    <form className="single-event-period event-occurrences-constructor" noValidate
      onSubmit={(event) => { event.preventDefault(); onSave(); }}>
      <header className="event-occurrences-constructor__head">
        <div>
          <h2>Период регистрации</h2>
          <p>Когда открывается и закрывается регистрация?</p>
        </div>
      </header>

      <div className="single-event-period__date">
        <span>Дата события</span>
        <strong>{eventDateSummary}</strong>
        <span>{timezone}</span>
      </div>
      {eventDateError ? <p className="form-error" role="alert">{eventDateError}</p> : null}

      <fieldset className="single-event-period__fields" disabled={saving}>
        <legend className="event-editor-sr-only">Границы периода регистрации</legend>
        <label className="single-event-period__checkbox">
          <input checked={values.opensOnPublication} type="checkbox"
            onChange={(event) => onChange({ ...values, opensOnPublication: event.target.checked })} />
          <span>Регистрация открывается с момента публикации</span>
        </label>
        {values.opensOnPublication && eventStatus === "published" ? (
          <p className="single-event-period__note">
            Событие уже опубликовано. После сохранения начало регистрации будет считаться наступившим.
          </p>
        ) : null}

        {!values.opensOnPublication ? (
          <label className="participation-modal__field">
            <span>Начало регистрации</span>
            <input aria-describedby={openingError ? `${id}-opening-error` : undefined}
              aria-invalid={Boolean(openingError)} required type="datetime-local"
              value={values.registrationOpensAt}
              onChange={(event) => onChange({ ...values, registrationOpensAt: event.target.value })} />
            {openingError ? <small id={`${id}-opening-error`}>{openingError}</small> : null}
          </label>
        ) : null}

        <label className="participation-modal__field">
          <span>Окончание регистрации</span>
          <input aria-describedby={closingError ? `${id}-closing-error` : undefined}
            aria-invalid={Boolean(closingError)} required type="datetime-local"
            value={values.registrationClosesAt}
            onChange={(event) => onChange({ ...values, registrationClosesAt: event.target.value })} />
          {closingError ? <small id={`${id}-closing-error`}>{closingError}</small> : null}
        </label>
      </fieldset>

      <p className="single-event-period__note">
        Пока период не сохранён, регистрация для события не ограничена этим временным окном.
      </p>
      <footer className="single-event-period__actions">
        <Button disabled={saving} type="submit" variant="success">Сохранить период регистрации</Button>
        <SaveStatusView error={saveError} saving={saving} unsaved={unsaved} />
      </footer>
    </form>
  );
}
