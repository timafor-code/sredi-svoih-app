import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getWebEventRegistrationForm,
  PublicApiError,
  RegistrationUnavailableError,
} from "./api";
import { formatDate, formatDateTimeRange, formatTime } from "./format";
import { parseRoute, replaceOccurrenceQuery } from "./route";
import type {
  AccountChoice,
  WebEventRegistrationFormResponse,
  WebRegistrationLegalDocument,
  WebRegistrationOccurrence,
  WebRegistrationParticipationOption,
  WebRegistrationState,
} from "./types";
import {
  normalizeName,
  type PersonalErrors,
  type PersonalField,
  validateEmail,
  validateName,
  validatePersonalFields,
  validatePhone,
} from "./validation";

const DEFAULT_TITLE = "Регистрация на мероприятие — Среди Своих";

const STATUS_LABELS: Record<WebRegistrationState, string> = {
  open: "Регистрация открыта",
  not_yet_open: "Регистрация ещё не открыта",
  closed: "Регистрация закрыта",
  full: "Мест нет",
  unavailable: "Регистрация недоступна",
};

type PageState =
  | { kind: "loading"; eventId: string | null }
  | { kind: "available"; eventId: string; data: WebEventRegistrationFormResponse }
  | { kind: "registration_unavailable"; eventId: string }
  | { kind: "network_error"; eventId: string }
  | { kind: "server_error"; eventId: string };

function BrandHeader(): ReactNode {
  return (
    <header className="brand-header">
      <a className="brand-link" href="#main-content" aria-label="Среди Своих — к содержимому">
        <img src="/logo.png" alt="Среди Своих" width="184" height="74" />
      </a>
    </header>
  );
}

function PageFrame({ children, privacyDocument }: {
  children: ReactNode;
  privacyDocument?: WebRegistrationLegalDocument;
}): ReactNode {
  return (
    <div className="page-shell">
      <BrandHeader />
      {children}
      <footer className="site-footer">
        <span>Местная иудейская религиозная организация «Среди Своих»</span>
        {privacyDocument ? (
          <a href={privacyDocument.published_url} target="_blank" rel="noopener noreferrer">
            {privacyDocument.title} · версия {privacyDocument.version}
          </a>
        ) : null}
      </footer>
    </div>
  );
}

function StaticStatePage({ title, description, action }: {
  title: string;
  description?: string;
  action?: ReactNode;
}): ReactNode {
  return (
    <PageFrame>
      <main id="main-content" className="state-page">
        <section className="surface state-surface" aria-live="polite">
          <p className="eyebrow">Регистрация на мероприятие</p>
          <h1>{title}</h1>
          {description ? <p className="muted-copy">{description}</p> : null}
          {action}
        </section>
      </main>
    </PageFrame>
  );
}

function LoadingPage(): ReactNode {
  return (
    <PageFrame>
      <main id="main-content" className="state-page" aria-busy="true" aria-live="polite">
        <section className="surface loading-surface">
          <span className="sr-only">Загружаем мероприятие</span>
          <div className="skeleton skeleton-image" />
          <div className="skeleton skeleton-title" />
          <div className="skeleton skeleton-line" />
          <h1 className="loading-title">Регистрация на мероприятие</h1>
        </section>
      </main>
    </PageFrame>
  );
}

function EventImage({ imageUrl, title }: { imageUrl: string | null; title: string }): ReactNode {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [imageUrl]);

  if (!imageUrl || failed) {
    return (
      <div className="event-image-fallback" role="img" aria-label={`Изображение мероприятия «${title}» недоступно`}>
        <img src="/logo.png" alt="" aria-hidden="true" />
      </div>
    );
  }

  return (
    <img
      className="event-image"
      src={imageUrl}
      alt={`Мероприятие «${title}»`}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

function OccurrenceSelector({
  occurrences,
  selectedId,
  onChange,
}: {
  occurrences: WebRegistrationOccurrence[];
  selectedId: string | null;
  onChange: (id: string) => void;
}): ReactNode {
  if (occurrences.length <= 1) return null;
  if (occurrences.length > 6) {
    return (
      <section className="surface section-card">
        <label className="section-label" htmlFor="occurrence-select">Выберите дату</label>
        <select id="occurrence-select" value={selectedId ?? ""} onChange={(event) => onChange(event.target.value)}>
          {occurrences.map((occurrence) => (
            <option key={occurrence.id} value={occurrence.id}>
              {occurrence.title ? `${occurrence.title} — ` : ""}
              {formatDateTimeRange(occurrence.starts_at, occurrence.ends_at, occurrence.timezone)} — {STATUS_LABELS[occurrence.registration_state]}
            </option>
          ))}
        </select>
      </section>
    );
  }

  return (
    <section className="surface section-card">
      <fieldset className="choice-fieldset">
        <legend>Выберите дату</legend>
        <div className="radio-card-grid">
          {occurrences.map((occurrence) => (
            <label className="radio-card" key={occurrence.id}>
              <input
                type="radio"
                name="occurrence"
                value={occurrence.id}
                checked={selectedId === occurrence.id}
                onChange={() => onChange(occurrence.id)}
              />
              <span>
                {occurrence.title ? <strong>{occurrence.title}</strong> : null}
                <span>{formatDate(occurrence.starts_at, occurrence.timezone)}</span>
                <span>{formatTime(occurrence.starts_at, occurrence.timezone)}</span>
                <small>{STATUS_LABELS[occurrence.registration_state]}</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </section>
  );
}

type OptionSelection = { selected: boolean; quantity: number };

function ParticipationOptions({
  options,
  selections,
  onSelectionChange,
  onQuantityChange,
  error,
  focusRef,
}: {
  options: WebRegistrationParticipationOption[];
  selections: Record<string, OptionSelection>;
  onSelectionChange: (option: WebRegistrationParticipationOption, selected: boolean) => void;
  onQuantityChange: (option: WebRegistrationParticipationOption, quantity: number) => void;
  error?: string;
  focusRef: React.RefObject<HTMLFieldSetElement | null>;
}): ReactNode {
  if (options.length === 0) return null;
  return (
    <fieldset
      className="surface section-card choice-fieldset"
      aria-describedby={error ? "options-error" : undefined}
      ref={focusRef}
      tabIndex={-1}
    >
      <legend>Варианты участия</legend>
      <div className="option-list">
        {options.map((option) => {
          const selection = selections[option.id] ?? { selected: false, quantity: option.min_quantity };
          const inputType = option.group_key ? "radio" : "checkbox";
          return (
            <div className="option-card" key={option.id}>
              <label className="option-select">
                <input
                  type={inputType}
                  name={option.group_key ? `option-group-${option.group_key}` : `option-${option.id}`}
                  checked={selection.selected}
                  onChange={(event) => onSelectionChange(option, event.target.checked)}
                />
                <span>
                  <strong>{option.title}</strong>
                  {option.description ? <small>{option.description}</small> : null}
                </span>
              </label>
              {option.allow_quantity ? (
                <label className="quantity-label">
                  Количество
                  <input
                    type="number"
                    min={option.min_quantity}
                    max={option.max_quantity}
                    value={selection.quantity}
                    disabled={!selection.selected}
                    aria-label={`Количество: ${option.title}`}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => {
                      const parsed = Number(event.target.value);
                      const quantity = Number.isFinite(parsed)
                        ? Math.min(option.max_quantity, Math.max(option.min_quantity, parsed))
                        : option.min_quantity;
                      onQuantityChange(option, quantity);
                    }}
                  />
                </label>
              ) : null}
            </div>
          );
        })}
      </div>
      {error ? <p className="field-error" id="options-error" role="alert">{error}</p> : null}
    </fieldset>
  );
}

type FormValues = Record<PersonalField, string> & {
  accountChoice: AccountChoice | null;
  consent: boolean;
};

type FormErrors = PersonalErrors & {
  occurrence?: string;
  options?: string;
  accountChoice?: string;
  consent?: string;
};

function RegistrationForm({
  eventId,
  occurrences,
  selectedOccurrenceId,
  options,
  consentDocument,
  privacyDocument,
}: {
  eventId: string;
  occurrences: WebRegistrationOccurrence[];
  selectedOccurrenceId: string | null;
  options: WebRegistrationParticipationOption[];
  consentDocument: WebRegistrationLegalDocument;
  privacyDocument?: WebRegistrationLegalDocument;
}): ReactNode {
  const emptyValues: FormValues = {
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    accountChoice: null,
    consent: false,
  };
  const [values, setValues] = useState<FormValues>(emptyValues);
  const [errors, setErrors] = useState<FormErrors>({});
  const [selections, setSelections] = useState<Record<string, OptionSelection>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const optionsRef = useRef<HTMLFieldSetElement>(null);

  useEffect(() => {
    setValues(emptyValues);
    setErrors({});
    setSelections({});
    setNotice(null);
  }, [eventId]);

  const updateField = (field: PersonalField, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setNotice(null);
  };

  const validateField = (field: PersonalField) => {
    const error = field === "firstName" || field === "lastName"
      ? validateName(values[field])
      : field === "phone"
        ? validatePhone(values.phone)
        : validateEmail(values.email);
    setErrors((current) => ({ ...current, [field]: error ?? undefined }));
    if (field === "firstName" || field === "lastName") {
      setValues((current) => ({ ...current, [field]: normalizeName(current[field]) }));
    } else if (field === "email") {
      setValues((current) => ({ ...current, email: current.email.trim() }));
    }
  };

  const onOptionSelectionChange = (
    option: WebRegistrationParticipationOption,
    selected: boolean,
  ) => {
    setSelections((current) => {
      const next = { ...current };
      if (option.group_key && selected) {
        options.filter((candidate) => candidate.group_key === option.group_key)
          .forEach((candidate) => { next[candidate.id] = { selected: false, quantity: candidate.min_quantity }; });
      }
      next[option.id] = {
        selected,
        quantity: Math.min(option.max_quantity, Math.max(option.min_quantity, option.min_quantity)),
      };
      return next;
    });
    setErrors((current) => ({ ...current, options: undefined }));
    setNotice(null);
  };

  const onOptionQuantityChange = (
    option: WebRegistrationParticipationOption,
    quantity: number,
  ) => {
    setSelections((current) => ({
      ...current,
      [option.id]: {
        selected: true,
        quantity: Math.min(option.max_quantity, Math.max(option.min_quantity, quantity)),
      },
    }));
    setNotice(null);
  };

  const focusFirstError = (nextErrors: FormErrors) => {
    const orderedIds: Array<[keyof FormErrors, string]> = [
      ["occurrence", "occurrence-select"],
      ["options", "options"],
      ["firstName", "first-name"],
      ["lastName", "last-name"],
      ["phone", "phone"],
      ["email", "email"],
      ["accountChoice", "account-without-password"],
      ["consent", "consent"],
    ];
    const first = orderedIds.find(([field]) => nextErrors[field]);
    if (!first) return;
    if (first[0] === "options") optionsRef.current?.focus();
    else document.getElementById(first[1])?.focus();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedValues = {
      ...values,
      firstName: normalizeName(values.firstName),
      lastName: normalizeName(values.lastName),
      email: values.email.trim(),
    };
    setValues(normalizedValues);
    const nextErrors: FormErrors = validatePersonalFields(normalizedValues);
    if (occurrences.length > 0 && !selectedOccurrenceId) nextErrors.occurrence = "Выберите дату мероприятия.";
    if (options.length > 0 && !Object.values(selections).some((selection) => selection.selected)) {
      nextErrors.options = "Выберите вариант участия.";
    }
    if (!values.accountChoice) nextErrors.accountChoice = "Выберите один из вариантов продолжения.";
    if (!values.consent) nextErrors.consent = "Подтвердите согласие для продолжения.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setNotice(null);
      window.requestAnimationFrame(() => focusFirstError(nextErrors));
      return;
    }

    // PR 8 (feature/public-web-registration-account-claim) will connect POST /web/registration-intents here.
    setNotice("Форма заполнена. Отправка кода подтверждения будет подключена на следующем этапе.");
  };

  const field = (
    id: string,
    key: PersonalField,
    label: string,
    inputProps: React.InputHTMLAttributes<HTMLInputElement>,
  ) => (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={values[key]}
        {...inputProps}
        aria-invalid={Boolean(errors[key])}
        aria-describedby={errors[key] ? `${id}-error` : undefined}
        onChange={(event) => updateField(key, event.target.value)}
        onBlur={() => validateField(key)}
      />
      {errors[key] ? <p className="field-error" id={`${id}-error`} role="alert">{errors[key]}</p> : null}
    </div>
  );

  return (
    <form className="registration-form" noValidate onSubmit={handleSubmit}>
      <ParticipationOptions
        options={options}
        selections={selections}
        onSelectionChange={onOptionSelectionChange}
        onQuantityChange={onOptionQuantityChange}
        error={errors.options}
        focusRef={optionsRef}
      />

      <section className="surface section-card" aria-labelledby="personal-heading">
        <h2 id="personal-heading">Ваши данные</h2>
        <div className="form-grid">
          {field("first-name", "firstName", "Имя", { autoComplete: "given-name", maxLength: 100 })}
          {field("last-name", "lastName", "Фамилия", { autoComplete: "family-name", maxLength: 100 })}
          {field("phone", "phone", "Телефон", { type: "tel", autoComplete: "tel", inputMode: "tel" })}
          {field("email", "email", "Email", { type: "email", autoComplete: "email", inputMode: "email", maxLength: 254 })}
        </div>
      </section>

      <fieldset className="surface section-card choice-fieldset" aria-describedby={errors.accountChoice ? "account-choice-error" : undefined}>
        <legend>Как продолжить</legend>
        <div className="account-choice-grid">
          <label className="account-choice-card">
            <input
              id="account-without-password"
              type="radio"
              name="account-choice"
              value="without_password"
              checked={values.accountChoice === "without_password"}
              onChange={() => {
                setValues((current) => ({ ...current, accountChoice: "without_password" }));
                setErrors((current) => ({ ...current, accountChoice: undefined }));
              }}
            />
            <span>
              <strong>Продолжить без пароля</strong>
              <small>Подтвердите email и запишитесь на мероприятие. Пароль не нужен. Чтобы ваши записи не дублировались, мы сохраним одну техническую карточку. Управлять или удалить данные можно по коду из email.</small>
            </span>
          </label>
          <label className="account-choice-card">
            <input
              type="radio"
              name="account-choice"
              value="create_account"
              checked={values.accountChoice === "create_account"}
              onChange={() => {
                setValues((current) => ({ ...current, accountChoice: "create_account" }));
                setErrors((current) => ({ ...current, accountChoice: undefined }));
              }}
            />
            <span>
              <strong>Создать аккаунт</strong>
              <small>Задайте пароль один раз, чтобы в дальнейшем не вводить данные повторно и видеть свои регистрации в приложении и на сайте.</small>
            </span>
          </label>
        </div>
        {errors.accountChoice ? <p className="field-error" id="account-choice-error" role="alert">{errors.accountChoice}</p> : null}
        <button
          className="text-button"
          type="button"
          onClick={() => setNotice("Вход для существующего аккаунта будет подключён на следующем этапе.")}
        >
          У меня уже есть аккаунт
        </button>
      </fieldset>

      <section className="surface section-card legal-section" aria-labelledby="legal-heading">
        <h2 id="legal-heading">Согласие на обработку данных</h2>
        <p>
          <a href={consentDocument.published_url} target="_blank" rel="noopener noreferrer">
            {consentDocument.title} · версия {consentDocument.version}
          </a>
        </p>
        {privacyDocument ? (
          <p>
            <a href={privacyDocument.published_url} target="_blank" rel="noopener noreferrer">
              {privacyDocument.title} · версия {privacyDocument.version}
            </a>
          </p>
        ) : null}
        <label className="consent-control">
          <input
            id="consent"
            type="checkbox"
            checked={values.consent}
            aria-invalid={Boolean(errors.consent)}
            aria-describedby={errors.consent ? "consent-error" : undefined}
            onChange={(event) => {
              setValues((current) => ({ ...current, consent: event.target.checked }));
              setErrors((current) => ({ ...current, consent: undefined }));
            }}
          />
          <span>Я ознакомился(-ась) с документом и даю отдельное согласие на обработку персональных данных для регистрации на мероприятие.</span>
        </label>
        {errors.consent ? <p className="field-error" id="consent-error" role="alert">{errors.consent}</p> : null}
      </section>

      <button className="primary-button" type="submit">Продолжить</button>
      {notice ? <p className="form-notice" role="status">{notice}</p> : null}
    </form>
  );
}

function EventPage({ data, requestedOccurrenceId }: {
  data: WebEventRegistrationFormResponse;
  requestedOccurrenceId: string | null;
}): ReactNode {
  const initialOccurrenceId = useMemo(() => {
    const requested = data.occurrences.find((item) => item.id.toLowerCase() === requestedOccurrenceId)?.id;
    return requested ?? data.occurrences[0]?.id ?? null;
  }, [data.occurrences, requestedOccurrenceId]);
  const [selectedOccurrenceId, setSelectedOccurrenceId] = useState(initialOccurrenceId);
  const selectedOccurrence = data.occurrences.find((item) => item.id === selectedOccurrenceId) ?? null;
  const effectiveState = selectedOccurrence?.registration_state ?? data.registration_state;
  const timeZone = selectedOccurrence?.timezone ?? data.event.timezone;
  const startsAt = selectedOccurrence?.starts_at ?? data.event.starts_at;
  const endsAt = selectedOccurrence?.ends_at ?? data.event.ends_at;
  const consentDocument = data.legal_documents.find((item) => item.document_type === "event_registration_consent");
  const privacyDocument = data.legal_documents.find((item) => item.document_type === "privacy_policy");

  const changeOccurrence = (id: string) => {
    setSelectedOccurrenceId(id);
    replaceOccurrenceQuery(id);
  };

  return (
    <PageFrame privacyDocument={privacyDocument}>
      <main id="main-content" className="event-layout">
        <div className="event-column">
          <article className="surface event-card">
            <EventImage imageUrl={data.event.image_url} title={data.event.title} />
            <div className="event-copy">
              <p className="eyebrow">Мероприятие</p>
              <h1>{data.event.title}</h1>
              {data.event.subtitle ? <p className="event-subtitle">{data.event.subtitle}</p> : null}
              <dl className="event-facts">
                <div><dt>Дата и время</dt><dd>{formatDateTimeRange(startsAt, endsAt, timeZone)}</dd></div>
                {data.event.location_name || data.event.address ? (
                  <div><dt>Место</dt><dd>{[data.event.location_name, data.event.address].filter(Boolean).join(", ")}</dd></div>
                ) : null}
              </dl>
              {data.event.short_description ? <p className="description">{data.event.short_description}</p> : null}
              {data.event.description ? <p className="description full-description">{data.event.description}</p> : null}
            </div>
          </article>

          <OccurrenceSelector
            occurrences={data.occurrences}
            selectedId={selectedOccurrenceId}
            onChange={changeOccurrence}
          />
        </div>

        <div className="form-column">
          <section className={`registration-status status-${effectiveState}`} aria-live="polite">
            <span aria-hidden="true" className="status-dot" />
            <strong>{STATUS_LABELS[effectiveState]}</strong>
          </section>
          {effectiveState === "open" && consentDocument ? (
            <RegistrationForm
              key={data.event.id}
              eventId={data.event.id}
              occurrences={data.occurrences}
              selectedOccurrenceId={selectedOccurrenceId}
              options={data.participation_options}
              consentDocument={consentDocument}
              privacyDocument={privacyDocument}
            />
          ) : null}
        </div>
      </main>
    </PageFrame>
  );
}

export default function App(): ReactNode {
  const [, setLocationVersion] = useState(0);
  const route = parseRoute(window.location.pathname, window.location.search);
  const [page, setPage] = useState<PageState>({
    kind: "loading",
    eventId: route.kind === "event" ? route.eventId : null,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const handlePopState = () => setLocationVersion((value) => value + 1);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    document.title = DEFAULT_TITLE;
    if (route.kind === "invalid") return;
    const controller = new AbortController();
    setPage({ kind: "loading", eventId: route.eventId });
    getWebEventRegistrationForm(route.eventId, controller.signal)
      .then((data) => {
        document.title = `${data.event.title} — Среди Своих`;
        setPage({ kind: "available", eventId: route.eventId, data });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof RegistrationUnavailableError) {
          setPage({ kind: "registration_unavailable", eventId: route.eventId });
        } else if (error instanceof PublicApiError) {
          setPage({ kind: "server_error", eventId: route.eventId });
        } else {
          setPage({ kind: "network_error", eventId: route.eventId });
        }
      });
    return () => controller.abort();
  }, [route.kind === "event" ? route.eventId : null, attempt]);

  if (route.kind === "invalid") {
    return <StaticStatePage title="Страница не найдена" />;
  }
  if (page.eventId !== route.eventId) return <LoadingPage />;
  if (page.kind === "loading") return <LoadingPage />;
  if (page.kind === "registration_unavailable") {
    return (
      <StaticStatePage
        title="Страница мероприятия недоступна"
        description="Возможно, регистрация ещё не открыта, была выключена или мероприятие больше не доступно."
      />
    );
  }
  if (page.kind === "network_error" || page.kind === "server_error") {
    return (
      <StaticStatePage
        title="Не удалось загрузить мероприятие"
        action={<button className="primary-button retry-button" type="button" onClick={() => setAttempt((value) => value + 1)}>Попробовать снова</button>}
      />
    );
  }
  return <EventPage key={page.data.event.id} data={page.data} requestedOccurrenceId={route.requestedOccurrenceId} />;
}
