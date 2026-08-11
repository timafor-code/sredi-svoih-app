import {
  type ChangeEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  confirmSetPassword,
  confirmWebRegistrationEmail,
  createWebRegistrationIntent,
  getWebRegistrationIntentStatus,
  getWebEventRegistrationForm,
  PublicApiError,
  RegistrationUnavailableError,
  requestSetPassword,
  resendWebRegistrationCode,
} from "./api";
import { formatDate, formatDateTimeRange, formatTime } from "./format";
import { QuestionnaireFields } from "./QuestionnaireFields";
import {
  focusFirstQuestionnaireError,
  type QuestionnaireErrors,
  type QuestionnaireValues,
  validateQuestionnaire,
} from "./questionnaire";
import {
  parseRoute,
  replaceCanonicalEventPath,
} from "./route";
import type {
  AccountChoice,
  AccountNextStep,
  WebEventRegistrationFormResponse,
  WebRegistrationConfirmResult,
  WebRegistrationIntentRequest,
  WebRegistrationLegalDocument,
  WebRegistrationOccurrence,
  WebRegistrationParticipationOption,
  WebQuestionnaireAnswerValue,
  WebQuestionnaireField,
  WebRegistrationResult,
  WebRegistrationState,
} from "./types";
import {
  normalizeName,
  normalizeRussianPhone,
  type PersonalErrors,
  type PersonalField,
  validateEmail,
  validateName,
  validatePersonalFields,
  validatePhone,
  validateSeatsCount,
} from "./validation";

const DEFAULT_TITLE = "Регистрация на мероприятие — Среди Своих";

function createIdempotencyKey(): string {
  if (!globalThis.crypto?.getRandomValues) throw new Error("Web Crypto is unavailable");
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return `web-${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function formatExpiry(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function safeApiError(error: unknown, context: "create" | "confirm" | "resend" | "status" | "password"): string {
  if (!(error instanceof PublicApiError)) {
    return context === "confirm"
      ? "Не удалось получить ответ после подтверждения. Проверьте статус перед повторной попыткой."
      : "Не удалось связаться с сервером. Проверьте соединение и попробуйте снова.";
  }
  switch (error.code) {
    case "registration_unavailable":
      return "Регистрация на мероприятие стала недоступна.";
    case "questionnaire_changed":
      return "Анкета регистрации была обновлена. Обновите страницу и заполните дополнительные вопросы ещё раз.";
    case "state_conflict":
      return "Окно регистрации закрыто или регистрация сейчас недоступна.";
    case "capacity_unavailable":
      return "Свободных мест больше нет.";
    case "invalid_verification_code":
      return "Код неверный или истёк. Проверьте код и попробуйте снова.";
    case "registration_intent_not_available":
      return "Срок действия регистрации истёк. Начните заново.";
    case "resend_cooldown":
    case "rate_limited":
      return "Код можно будет отправить повторно немного позже.";
    case "email_delivery_unavailable":
    case "service_unavailable":
      return "Отправка email временно недоступна. Попробуйте позже.";
    case "identity_confirmation_unavailable":
      return "Не удалось автоматически подтвердить данные. Используйте восстановление доступа или обратитесь в поддержку.";
    case "bad_request":
    case "conflict":
      return context === "password"
        ? "Код задания пароля недействителен или истёк. Запросите новый код."
        : "Не удалось обработать запрос. Проверьте данные и попробуйте снова.";
    case "validation_error":
      return "Проверьте введённые данные. Если всё верно, начните регистрацию заново.";
    default:
      return "Произошла неизвестная ошибка сервера. Попробуйте позже.";
  }
}

const STATUS_LABELS: Record<WebRegistrationState, string> = {
  open: "Регистрация открыта",
  not_yet_open: "Регистрация ещё не открыта",
  closed: "Регистрация закрыта",
  full: "Мест нет",
  unavailable: "Регистрация недоступна",
};

type PageState =
  | { kind: "loading"; routeKey: string | null }
  | { kind: "available"; routeKey: string; data: WebEventRegistrationFormResponse }
  | { kind: "registration_unavailable"; routeKey: string }
  | { kind: "network_error"; routeKey: string }
  | { kind: "server_error"; routeKey: string };

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
          <option value="" disabled>Выберите дату участия</option>
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
  seatsCount: string;
  accountChoice: AccountChoice | null;
  consent: boolean;
};

type FormErrors = PersonalErrors & {
  occurrence?: string;
  options?: string;
  seatsCount?: string;
  consent?: string;
};

type FlowStage = "form" | "verification" | "success";

const SUCCESS_COPY: Record<WebRegistrationResult["status"], string> = {
  confirmed: "Регистрация подтверждена.",
  pending: "Заявка отправлена и ожидает подтверждения организатора.",
  waitlisted: "Вы добавлены в лист ожидания. Участие пока не подтверждено.",
  attended: "Регистрация сохранена.",
};

function RegistrationForm({
  eventId,
  eventTitle,
  occurrences,
  selectedOccurrenceId,
  options,
  questionnaireFormId,
  questions,
  consentDocument,
  privacyDocument,
}: {
  eventId: string;
  eventTitle: string;
  occurrences: WebRegistrationOccurrence[];
  selectedOccurrenceId: string | null;
  options: WebRegistrationParticipationOption[];
  questionnaireFormId: string | null;
  questions: WebQuestionnaireField[];
  consentDocument: WebRegistrationLegalDocument;
  privacyDocument?: WebRegistrationLegalDocument;
}): ReactNode {
  const emptyValues: FormValues = {
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    seatsCount: "1",
    accountChoice: null,
    consent: false,
  };
  const [values, setValues] = useState<FormValues>(emptyValues);
  const [errors, setErrors] = useState<FormErrors>({});
  const [selections, setSelections] = useState<Record<string, OptionSelection>>({});
  const [questionnaireValues, setQuestionnaireValues] = useState<QuestionnaireValues>({});
  const [questionnaireErrors, setQuestionnaireErrors] = useState<QuestionnaireErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [flowError, setFlowError] = useState<string | null>(null);
  const [stage, setStage] = useState<FlowStage>("form");
  const [flowId, setFlowId] = useState<string | null>(null);
  const [flowExpiresAt, setFlowExpiresAt] = useState<string | null>(null);
  const [emailCode, setEmailCode] = useState("");
  const [busyAction, setBusyAction] = useState<"create" | "confirm" | "resend" | "status" | "request_password" | "password" | null>(null);
  const [confirmationUnknown, setConfirmationUnknown] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [registration, setRegistration] = useState<WebRegistrationResult | null>(null);
  const [accountNextStep, setAccountNextStep] = useState<AccountNextStep | null>(null);
  const [setPasswordCode, setSetPasswordCode] = useState<string | null>(null);
  const [setPasswordExpiresAt, setSetPasswordExpiresAt] = useState<string | null>(null);
  const [requestedPasswordCode, setRequestedPasswordCode] = useState("");
  const [passwordRequestSent, setPasswordRequestSent] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [accountCompleted, setAccountCompleted] = useState(false);
  const optionsRef = useRef<HTMLFieldSetElement>(null);
  const emailCodeRef = useRef<HTMLInputElement>(null);
  const passwordCodeRef = useRef<HTMLInputElement>(null);
  const newPasswordRef = useRef<HTMLInputElement>(null);
  const repeatPasswordRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);
  const idempotencyRef = useRef<{ signature: string; key: string } | null>(null);

  useEffect(() => {
    setValues(emptyValues);
    setErrors({});
    setSelections({});
    setQuestionnaireValues({});
    setQuestionnaireErrors({});
    setNotice(null);
    setFlowError(null);
    setStage("form");
    setFlowId(null);
    setFlowExpiresAt(null);
    setRegistration(null);
    setAccountNextStep(null);
    setSetPasswordCode(null);
    idempotencyRef.current = null;
  }, [eventId]);

  useEffect(() => {
    if (stage === "verification") emailCodeRef.current?.focus();
  }, [stage]);

  useEffect(() => {
    if (passwordRequestSent) passwordCodeRef.current?.focus();
  }, [passwordRequestSent]);

  useEffect(() => {
    if (cooldownUntil === null) {
      setCooldownSeconds(0);
      return;
    }
    const update = () => {
      const remaining = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
      setCooldownSeconds(remaining);
      if (remaining === 0) setCooldownUntil(null);
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);

  const updateField = (field: PersonalField, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setNotice(null);
    setFlowError(null);
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

  const updateSeatsCount = (value: string) => {
    setValues((current) => ({ ...current, seatsCount: value }));
    setErrors((current) => ({ ...current, seatsCount: undefined }));
    setNotice(null);
    setFlowError(null);
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
    setFlowError(null);
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
    setFlowError(null);
  };

  const onQuestionnaireChange = (fieldId: string, value: WebQuestionnaireAnswerValue) => {
    setQuestionnaireValues((current) => ({ ...current, [fieldId]: value }));
    setQuestionnaireErrors((current) => ({ ...current, [fieldId]: undefined }));
    setNotice(null);
    setFlowError(null);
  };

  const focusFirstError = (
    nextErrors: FormErrors,
    nextQuestionnaireErrors: QuestionnaireErrors,
  ) => {
    const beforeQuestionnaire: Array<[keyof FormErrors, string]> = [
      ["occurrence", "occurrence-select"],
      ["options", "options"],
      ["seatsCount", "seats-count"],
    ];
    const before = beforeQuestionnaire.find(([field]) => nextErrors[field]);
    if (before) {
      if (before[0] === "options") optionsRef.current?.focus();
      else document.getElementById(before[1])?.focus();
      return;
    }
    if (focusFirstQuestionnaireError(questions, nextQuestionnaireErrors)) return;
    const afterQuestionnaire: Array<[keyof FormErrors, string]> = [
      ["firstName", "first-name"],
      ["lastName", "last-name"],
      ["phone", "phone"],
      ["email", "email"],
      ["consent", "consent"],
    ];
    const first = afterQuestionnaire.find(([field]) => nextErrors[field]);
    if (!first) return;
    if (first[0] === "options") optionsRef.current?.focus();
    else document.getElementById(first[1])?.focus();
  };

  const completeRegistration = (
    result: WebRegistrationResult,
    nextStep: AccountNextStep,
    passwordCode: string | null = null,
    passwordExpiry: string | null = null,
  ) => {
    if (result.event_id.toLowerCase() !== eventId.toLowerCase()) {
      throw new PublicApiError("invalid_response");
    }
    setRegistration(result);
    setAccountNextStep(nextStep === "set_password" && !passwordCode ? "request_set_password" : nextStep);
    setSetPasswordCode(passwordCode);
    setSetPasswordExpiresAt(passwordExpiry);
    setFlowId(null);
    setEmailCode("");
    setStage("success");
    setFlowError(null);
    setNotice(null);
    setConfirmationUnknown(false);
  };

  const applyStatus = (status: Awaited<ReturnType<typeof getWebRegistrationIntentStatus>>) => {
    if (status.state === "confirmed" && status.registration && status.account_next_step) {
      completeRegistration(status.registration, status.account_next_step);
      return;
    }
    if (status.state === "email_verification_required") {
      setStage("verification");
      setFlowExpiresAt(status.expires_at);
      setConfirmationUnknown(false);
      setFlowError(null);
      setNotice("Подтверждение ещё не завершено. Введите код из письма.");
      return;
    }
    setFlowError("Срок действия регистрации истёк или регистрация недоступна. Начните заново.");
    setConfirmationUnknown(false);
  };

  const checkStatus = async (currentFlowId = flowId) => {
    if (!currentFlowId || submittingRef.current) return;
    submittingRef.current = true;
    setBusyAction("status");
    setFlowError(null);
    try {
      applyStatus(await getWebRegistrationIntentStatus(currentFlowId));
    } catch (error: unknown) {
      setFlowError(safeApiError(error, "status"));
    } finally {
      submittingRef.current = false;
      setBusyAction(null);
    }
  };

  const continueWithAccountChoice = async (accountChoice: AccountChoice) => {
    if (submittingRef.current) return;
    const normalizedValues = {
      ...values,
      firstName: normalizeName(values.firstName),
      lastName: normalizeName(values.lastName),
      email: values.email.trim(),
      accountChoice,
    };
    setValues(normalizedValues);
    const nextErrors: FormErrors = validatePersonalFields(normalizedValues);
    if (occurrences.length > 0 && !selectedOccurrenceId) nextErrors.occurrence = "Выберите дату мероприятия.";
    if (options.length > 0 && !Object.values(selections).some((selection) => selection.selected)) {
      nextErrors.options = "Выберите вариант участия.";
    }
    const seatsCountError = validateSeatsCount(normalizedValues.seatsCount);
    if (seatsCountError) nextErrors.seatsCount = seatsCountError;
    if (!values.consent) nextErrors.consent = "Подтвердите согласие для продолжения.";
    const questionnaireResult = validateQuestionnaire(questions, questionnaireValues);
    setQuestionnaireErrors(questionnaireResult.errors);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || Object.keys(questionnaireResult.errors).length > 0) {
      setNotice(null);
      window.requestAnimationFrame(() => focusFirstError(nextErrors, questionnaireResult.errors));
      return;
    }

    const phone = normalizeRussianPhone(normalizedValues.phone);
    if (!phone) return;
    const requestWithoutKey: Omit<WebRegistrationIntentRequest, "idempotency_key"> = {
      event_id: eventId,
      occurrence_id: selectedOccurrenceId,
      first_name: normalizedValues.firstName,
      last_name: normalizedValues.lastName,
      phone,
      email: normalizedValues.email,
      seats_count: Number(normalizedValues.seatsCount),
      option_selections: options
        .filter((option) => selections[option.id]?.selected)
        .map((option) => ({
          option_id: option.id,
          quantity: selections[option.id]?.quantity ?? option.min_quantity,
        })),
      questionnaire_form_id: questionnaireFormId,
      answers: questionnaireResult.answers,
      legal_acceptances: [{
        document_id: consentDocument.id,
        content_hash: consentDocument.content_hash,
      }],
      account_choice: accountChoice,
    };
    const signature = JSON.stringify(requestWithoutKey);
    try {
      if (!idempotencyRef.current || idempotencyRef.current.signature !== signature) {
        idempotencyRef.current = { signature, key: createIdempotencyKey() };
      }
    } catch {
      setFlowError("Этот браузер не поддерживает безопасное создание регистрации.");
      return;
    }
    const payload: WebRegistrationIntentRequest = {
      ...requestWithoutKey,
      idempotency_key: idempotencyRef.current.key,
    };

    submittingRef.current = true;
    setBusyAction("create");
    setFlowError(null);
    setNotice("Отправляем данные и запрашиваем код подтверждения…");
    try {
      const created = await createWebRegistrationIntent(payload);
      setFlowId(created.flow_id);
      setFlowExpiresAt(created.expires_at);
      if (created.next_step === "completed") {
        const status = await getWebRegistrationIntentStatus(created.flow_id);
        applyStatus(status);
      } else {
        setEmailCode("");
        setStage("verification");
        setNotice(null);
      }
    } catch (error: unknown) {
      setFlowError(safeApiError(error, "create"));
      setNotice(null);
    } finally {
      submittingRef.current = false;
      setBusyAction(null);
    }
  };

  const confirmEmail = async () => {
    if (!flowId || emailCode.length !== 6 || submittingRef.current) return;
    submittingRef.current = true;
    setBusyAction("confirm");
    setFlowError(null);
    setNotice("Проверяем код…");
    try {
      const confirmed: WebRegistrationConfirmResult = await confirmWebRegistrationEmail(flowId, emailCode);
      completeRegistration(
        confirmed.registration,
        confirmed.account_next_step,
        confirmed.set_password_code,
        confirmed.set_password_expires_at,
      );
    } catch (error: unknown) {
      const ambiguous = !(error instanceof PublicApiError);
      setConfirmationUnknown(ambiguous);
      setFlowError(safeApiError(error, "confirm"));
      setNotice(null);
      window.requestAnimationFrame(() => emailCodeRef.current?.focus());
    } finally {
      submittingRef.current = false;
      setBusyAction(null);
    }
  };

  const resendCode = async () => {
    if (!flowId || submittingRef.current || cooldownSeconds > 0) return;
    submittingRef.current = true;
    setBusyAction("resend");
    setFlowError(null);
    setNotice("Отправляем новый код…");
    try {
      const resent = await resendWebRegistrationCode(flowId);
      setFlowExpiresAt(resent.expires_at);
      setEmailCode("");
      setNotice("Новый код отправлен. Старый код больше не действует.");
      window.requestAnimationFrame(() => emailCodeRef.current?.focus());
    } catch (error: unknown) {
      if (error instanceof PublicApiError && error.retryAfterSeconds !== null) {
        setCooldownUntil(Date.now() + error.retryAfterSeconds * 1000);
      }
      setFlowError(safeApiError(error, "resend"));
      setNotice(null);
    } finally {
      submittingRef.current = false;
      setBusyAction(null);
    }
  };

  const startNewFlow = () => {
    idempotencyRef.current = null;
    setFlowId(null);
    setFlowExpiresAt(null);
    setEmailCode("");
    setFlowError(null);
    setNotice(null);
    setConfirmationUnknown(false);
    setCooldownUntil(null);
    setStage("form");
  };

  const sendPasswordCode = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setBusyAction("request_password");
    setPasswordError(null);
    try {
      await requestSetPassword(values.email);
      setPasswordRequestSent(true);
      setRequestedPasswordCode("");
      setNotice("Если задание пароля доступно, код отправлен на указанный email.");
    } catch (error: unknown) {
      setPasswordError(safeApiError(error, "password"));
    } finally {
      submittingRef.current = false;
      setBusyAction(null);
    }
  };

  const submitPassword = async () => {
    if (submittingRef.current) return;
    const code = setPasswordCode ?? requestedPasswordCode.trim();
    if (!code) {
      setPasswordError("Введите код из письма.");
      passwordCodeRef.current?.focus();
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError("Пароль должен содержать минимум 8 символов.");
      newPasswordRef.current?.focus();
      return;
    }
    if (newPassword !== repeatPassword) {
      setPasswordError("Пароли не совпадают.");
      repeatPasswordRef.current?.focus();
      return;
    }
    submittingRef.current = true;
    setBusyAction("password");
    setPasswordError(null);
    try {
      await confirmSetPassword(code, newPassword);
      setAccountCompleted(true);
      setSetPasswordCode(null);
      setRequestedPasswordCode("");
      setNewPassword("");
      setRepeatPassword("");
      setNotice("Аккаунт создан для этой же регистрации.");
    } catch (error: unknown) {
      setPasswordError(safeApiError(error, "password"));
    } finally {
      submittingRef.current = false;
      setBusyAction(null);
    }
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

  if (stage === "verification") {
    return (
      <section className="surface section-card flow-card" aria-labelledby="verification-heading">
        <p className="eyebrow">Подтверждение email</p>
        <h2 id="verification-heading">Введите код из письма</h2>
        <p className="muted-copy">Шестизначный код отправлен на указанный email.</p>
        {flowExpiresAt ? <p className="flow-expiry">Текущий срок действия: до {formatExpiry(flowExpiresAt)}.</p> : null}
        <div className="form-field code-field">
          <label htmlFor="email-code">Код подтверждения</label>
          <input
            ref={emailCodeRef}
            id="email-code"
            value={emailCode}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            aria-invalid={Boolean(flowError && !confirmationUnknown)}
            aria-describedby={flowError ? "verification-error" : undefined}
            onChange={(event) => {
              setEmailCode(event.target.value.replace(/\D/g, "").slice(0, 6));
              setFlowError(null);
            }}
          />
        </div>
        <div className="flow-actions">
          <button className="primary-button" type="button" disabled={emailCode.length !== 6 || busyAction !== null} onClick={confirmEmail}>
            {busyAction === "confirm" ? "Проверяем…" : "Подтвердить email"}
          </button>
          <button className="secondary-button" type="button" disabled={busyAction !== null || cooldownSeconds > 0} onClick={resendCode}>
            {busyAction === "resend"
              ? "Отправляем…"
              : cooldownSeconds > 0
                ? `Повторная отправка через ${cooldownSeconds} сек.`
                : "Отправить код повторно"}
          </button>
          {confirmationUnknown ? (
            <button className="secondary-button" type="button" disabled={busyAction !== null} onClick={() => checkStatus()}>
              {busyAction === "status" ? "Проверяем…" : "Проверить статус"}
            </button>
          ) : null}
          <button className="text-button" type="button" disabled={busyAction !== null} onClick={startNewFlow}>Изменить данные и начать заново</button>
        </div>
        <div className="flow-live" aria-live="polite" aria-atomic="true">
          {notice ? <p className="form-notice" role="status">{notice}</p> : null}
          {flowError ? <p className="form-error" id="verification-error" role="alert">{flowError}</p> : null}
        </div>
      </section>
    );
  }

  if (stage === "success" && registration) {
    const resultOccurrence = occurrences.find((item) => item.id === registration.occurrence_id);
    const showPasswordForm = accountNextStep === "set_password"
      || (accountNextStep === "request_set_password" && passwordRequestSent);
    return (
      <section className="surface section-card flow-card success-card" aria-labelledby="success-heading" aria-live="polite">
        <p className="eyebrow">Готово</p>
        <h2 id="success-heading">Регистрация успешно сохранена</h2>
        <p className={`registration-result result-${registration.status}`}>{SUCCESS_COPY[registration.status]}</p>
        <dl className="result-details">
          <div><dt>Мероприятие</dt><dd>{eventTitle}</dd></div>
          <div><dt>Количество мест</dt><dd>{registration.seats_count}</dd></div>
          {resultOccurrence ? (
            <div><dt>Выбранная дата</dt><dd>{formatDateTimeRange(resultOccurrence.starts_at, resultOccurrence.ends_at, resultOccurrence.timezone)}</dd></div>
          ) : null}
        </dl>

        {accountNextStep === "none" ? <p className="muted-copy">Регистрация сохранена. Код подтверждения был отправлен на указанный email. Пароль и web-сессия не создавались.</p> : null}
        {accountNextStep === "sign_in" ? <p className="muted-copy">Регистрация сохранена. Для управления аккаунтом можно войти с существующим паролем.</p> : null}
        {accountNextStep === "request_set_password" && !passwordRequestSent ? (
          <div className="account-followup">
            <p className="muted-copy">Чтобы задать пароль, запросите одноразовый код. Ответ не раскрывает, существует ли аккаунт.</p>
            <button className="secondary-button" type="button" disabled={busyAction !== null} onClick={sendPasswordCode}>
              {busyAction === "request_password" ? "Отправляем…" : "Запросить код задания пароля"}
            </button>
          </div>
        ) : null}
        {showPasswordForm && !accountCompleted ? (
          <div className="account-followup" aria-labelledby="password-heading">
            <h3 id="password-heading">Задать пароль</h3>
            {accountNextStep === "request_set_password" ? (
              <div className="form-field">
                <label htmlFor="set-password-email-code">Код из письма</label>
                <input
                  ref={passwordCodeRef}
                  id="set-password-email-code"
                  value={requestedPasswordCode}
                  autoComplete="one-time-code"
                  maxLength={512}
                  onChange={(event) => setRequestedPasswordCode(event.target.value)}
                />
              </div>
            ) : null}
            <div className="form-field">
              <label htmlFor="new-password">Новый пароль</label>
              <input ref={newPasswordRef} id="new-password" type="password" minLength={8} maxLength={1024} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
            </div>
            <div className="form-field">
              <label htmlFor="repeat-password">Повтор нового пароля</label>
              <input ref={repeatPasswordRef} id="repeat-password" type="password" minLength={8} maxLength={1024} autoComplete="new-password" value={repeatPassword} onChange={(event) => setRepeatPassword(event.target.value)} />
            </div>
            {setPasswordExpiresAt ? <p className="flow-expiry">Код действует до {formatExpiry(setPasswordExpiresAt)}.</p> : null}
            <button className="primary-button" type="button" disabled={busyAction !== null} onClick={submitPassword}>
              {busyAction === "password" ? "Сохраняем…" : "Задать пароль"}
            </button>
          </div>
        ) : null}
        <div className="flow-live" aria-live="polite" aria-atomic="true">
          {notice ? <p className="form-notice" role="status">{notice}</p> : null}
          {passwordError ? <p className="form-error" role="alert">{passwordError}</p> : null}
        </div>
      </section>
    );
  }

  return (
    <form className="registration-form" noValidate onSubmit={(event) => event.preventDefault()}>
      <ParticipationOptions
        options={options}
        selections={selections}
        onSelectionChange={onOptionSelectionChange}
        onQuantityChange={onOptionQuantityChange}
        error={errors.options}
        focusRef={optionsRef}
      />

      <section className="surface section-card" aria-labelledby="seats-heading">
        <h2 id="seats-heading">Количество мест</h2>
        <div className="form-field seats-field">
          <label htmlFor="seats-count">Количество мест</label>
          <input
            id="seats-count"
            type="number"
            min={1}
            max={1000}
            step={1}
            inputMode="numeric"
            value={values.seatsCount}
            aria-invalid={Boolean(errors.seatsCount)}
            aria-describedby={errors.seatsCount ? "seats-count-error" : undefined}
            onChange={(event) => updateSeatsCount(event.target.value)}
            onBlur={() => {
              const error = validateSeatsCount(values.seatsCount);
              setErrors((current) => ({ ...current, seatsCount: error ?? undefined }));
            }}
          />
          {errors.seatsCount ? (
            <p className="field-error" id="seats-count-error" role="alert">{errors.seatsCount}</p>
          ) : null}
        </div>
      </section>

      <QuestionnaireFields
        fields={questions}
        values={questionnaireValues}
        errors={questionnaireErrors}
        onChange={onQuestionnaireChange}
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

      <section className="surface section-card" aria-labelledby="account-actions-heading">
        <h2 id="account-actions-heading">Как продолжить</h2>
        <div className="account-action-grid">
          <div className="account-action-card">
            <p>Подтвердите email и запишитесь на мероприятие. Пароль не нужен. Чтобы ваши записи не дублировались, мы сохраним одну техническую карточку. Управлять или удалить данные можно по коду из email.</p>
            <button
              className="primary-button"
              type="button"
              aria-pressed={values.accountChoice === "without_password"}
              disabled={busyAction !== null}
              onClick={() => void continueWithAccountChoice("without_password")}
            >
              {busyAction === "create" && values.accountChoice === "without_password" ? "Отправляем…" : "Продолжить без пароля"}
            </button>
          </div>
          <div className="account-action-card">
            <p>Задайте пароль один раз, чтобы в дальнейшем не вводить данные повторно и видеть свои регистрации в приложении и на сайте.</p>
            <button
              className="secondary-button"
              type="button"
              aria-pressed={values.accountChoice === "create_account"}
              disabled={busyAction !== null}
              onClick={() => void continueWithAccountChoice("create_account")}
            >
              {busyAction === "create" && values.accountChoice === "create_account" ? "Отправляем…" : "Создать аккаунт"}
            </button>
          </div>
        </div>
        <button
          className="text-button"
          type="button"
          disabled={busyAction !== null}
          onClick={() => setNotice("Можно продолжить регистрацию через подтверждение email без обязательного ввода пароля. Регистрация будет связана с существующим аккаунтом, а основные данные подтверждённого профиля не будут молча перезаписаны.")}
        >
          У меня уже есть аккаунт
        </button>
      </section>

      <div className="flow-live" aria-live="polite" aria-atomic="true">
        {notice ? <p className="form-notice" role="status">{notice}</p> : null}
        {flowError ? <p className="form-error" role="alert">{flowError}</p> : null}
      </div>
    </form>
  );
}

function EventPage({ data, requestedOccurrenceId }: {
  data: WebEventRegistrationFormResponse;
  requestedOccurrenceId: string | null;
}): ReactNode {
  const initialOccurrenceId = useMemo(() => {
    if (data.occurrence_selection_mode !== "user_select") {
      return data.default_occurrence_id;
    }
    return data.occurrences.find(
      (item) => item.id.toLowerCase() === requestedOccurrenceId,
    )?.id ?? null;
  }, [
    data.default_occurrence_id,
    data.occurrence_selection_mode,
    data.occurrences,
    requestedOccurrenceId,
  ]);
  const [selectedOccurrenceId, setSelectedOccurrenceId] = useState(initialOccurrenceId);
  useEffect(() => {
    setSelectedOccurrenceId((current) => {
      if (data.occurrence_selection_mode !== "user_select") {
        return data.default_occurrence_id;
      }
      const requested = data.occurrences.find(
        (item) => item.id.toLowerCase() === requestedOccurrenceId,
      )?.id;
      if (requested) return requested;
      return current && data.occurrences.some((item) => item.id === current)
        ? current
        : null;
    });
  }, [
    data.default_occurrence_id,
    data.occurrence_selection_mode,
    data.occurrences,
    requestedOccurrenceId,
  ]);
  const effectiveOccurrenceId = data.occurrence_selection_mode === "user_select"
    ? selectedOccurrenceId
    : data.default_occurrence_id;
  const selectedOccurrence = data.occurrences.find(
    (item) => item.id === effectiveOccurrenceId,
  ) ?? null;
  const needsOccurrenceSelection = data.occurrence_selection_mode === "user_select"
    && selectedOccurrence === null;
  const effectiveState = needsOccurrenceSelection
    ? null
    : selectedOccurrence?.registration_state ?? data.registration_state;
  const timeZone = selectedOccurrence?.timezone ?? data.event.timezone;
  const startsAt = selectedOccurrence?.starts_at ?? data.event.starts_at;
  const endsAt = selectedOccurrence?.ends_at ?? data.event.ends_at;
  const consentDocument = data.legal_documents.find((item) => item.document_type === "event_registration_consent");
  const privacyDocument = data.legal_documents.find((item) => item.document_type === "privacy_policy");

  const changeOccurrence = (id: string) => {
    setSelectedOccurrenceId(id);
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

          {data.occurrence_selection_mode === "user_select" ? (
            <OccurrenceSelector
              occurrences={data.occurrences}
              selectedId={selectedOccurrenceId}
              onChange={changeOccurrence}
            />
          ) : null}
        </div>

        <div className="form-column">
          {needsOccurrenceSelection ? (
            <section className="registration-status status-unavailable" aria-live="polite">
              <span aria-hidden="true" className="status-dot" />
              <strong>Сначала выберите дату участия</strong>
            </section>
          ) : effectiveState ? (
            <section className={`registration-status status-${effectiveState}`} aria-live="polite">
              <span aria-hidden="true" className="status-dot" />
              <strong>{STATUS_LABELS[effectiveState]}</strong>
            </section>
          ) : null}
          {effectiveState === "open" && consentDocument ? (
            <RegistrationForm
              key={data.event.id}
              eventId={data.event.id}
              eventTitle={data.event.title}
              occurrences={data.occurrences}
              selectedOccurrenceId={effectiveOccurrenceId}
              options={data.participation_options}
              questionnaireFormId={data.questionnaire_form_id}
              questions={data.questions}
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
  const [locationVersion, setLocationVersion] = useState(0);
  const route = useMemo(
    () => parseRoute(window.location.pathname, window.location.search),
    [locationVersion],
  );
  const routeKey = route.kind === "invalid" ? null : `${route.kind}:${route.value}`;
  const [page, setPage] = useState<PageState>({
    kind: "loading",
    routeKey,
  });
  const [attempt, setAttempt] = useState(0);
  const skipCanonicalRouteFetch = useRef<string | null>(null);
  const lastTriggeredStateCheck = useRef<string | null>(null);

  useEffect(() => {
    const handlePopState = () => setLocationVersion((value) => value + 1);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        setAttempt((value) => value + 1);
      }
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => document.removeEventListener("visibilitychange", refreshWhenVisible);
  }, []);

  useEffect(() => {
    if (route.kind === "invalid") {
      document.title = DEFAULT_TITLE;
      return;
    }
    if (skipCanonicalRouteFetch.current === routeKey) {
      skipCanonicalRouteFetch.current = null;
      return;
    }
    document.title = DEFAULT_TITLE;
    const controller = new AbortController();
    const requestRouteKey = `${route.kind}:${route.value}`;
    setPage((current) => (
      current.kind === "available" && current.routeKey === requestRouteKey
        ? current
        : { kind: "loading", routeKey: requestRouteKey }
    ));
    getWebEventRegistrationForm(route, controller.signal)
      .then((data) => {
        const canonicalRouteKey = `slug:${data.canonical_public_path.slice("/events/".length)}`;
        const replaced = replaceCanonicalEventPath(
          data.canonical_public_path,
          route.requestedOccurrenceId,
          data.occurrence_selection_mode,
          data.occurrences.map((occurrence) => occurrence.id),
        );
        if (replaced) {
          if (canonicalRouteKey !== requestRouteKey) {
            skipCanonicalRouteFetch.current = canonicalRouteKey;
          }
          setLocationVersion((value) => value + 1);
        }
        document.title = `${data.event.title} — Среди Своих`;
        setPage({ kind: "available", routeKey: canonicalRouteKey, data });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof RegistrationUnavailableError) {
          setPage({ kind: "registration_unavailable", routeKey: requestRouteKey });
        } else if (error instanceof PublicApiError) {
          setPage({ kind: "server_error", routeKey: requestRouteKey });
        } else {
          setPage({ kind: "network_error", routeKey: requestRouteKey });
        }
      });
    return () => controller.abort();
  }, [routeKey, attempt]);

  const nextRegistrationStateCheck = page.kind === "available"
    ? page.data.next_registration_state_check_at
    : null;
  const scheduledStateCheckKey = page.kind === "available"
    && nextRegistrationStateCheck !== null
    ? `${page.routeKey}:${nextRegistrationStateCheck}`
    : null;

  useEffect(() => {
    if (scheduledStateCheckKey === null
      || nextRegistrationStateCheck === null
      || lastTriggeredStateCheck.current === scheduledStateCheckKey) return;
    const targetTime = Date.parse(nextRegistrationStateCheck);
    if (!Number.isFinite(targetTime)) return;

    let timer: number | null = null;
    let cancelled = false;
    const schedule = () => {
      if (cancelled) return;
      const remaining = targetTime - Date.now();
      if (remaining <= 0) {
        lastTriggeredStateCheck.current = scheduledStateCheckKey;
        setAttempt((value) => value + 1);
        return;
      }
      timer = window.setTimeout(schedule, Math.min(remaining, 2_147_483_647));
    };
    schedule();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [nextRegistrationStateCheck, scheduledStateCheckKey]);

  if (route.kind === "invalid") {
    return <StaticStatePage title="Страница не найдена" />;
  }
  if (page.routeKey !== routeKey) return <LoadingPage />;
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
