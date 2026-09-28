import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";

import { Button } from "../ui/Button";
import { ApiClientError } from "../../services/apiClient";
import {
  createAdminEventRegistration,
  searchAdminRegistrationParticipants,
} from "../../services/adminRegistrationApiService";
import { listAdminEventParticipationOptions } from "../../services/adminParticipationOptionsService";
import type { ParticipationOption } from "../../types/participationOptions";
import type {
  AdminRegistrationParticipant,
  CreateAdminEventRegistrationRequest,
} from "../../types/registrations";

type ParticipantMode = "existing" | "new";

type OptionSelections = Record<string, number>;

type AddParticipantDialogProps = {
  eventId: string;
  eventTitle: string;
  occurrenceId: string | null;
  occurrenceLabel: string | null;
  occurrenceRequired: boolean;
  registrationMode: string;
  onClose: () => void;
  onSuccess: () => Promise<void> | void;
};

const INITIAL_SEATS_COUNT = 1;

function formatPrice(option: ParticipationOption): string | null {
  if (option.priceAmount === 0) return null;
  try {
    return new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency: option.priceCurrency,
      maximumFractionDigits: 2,
    }).format(option.priceAmount);
  } catch {
    return `${option.priceAmount} ${option.priceCurrency}`;
  }
}

function clampQuantity(option: ParticipationOption, value: number): number {
  if (!option.allowQuantity) return 1;
  if (!Number.isSafeInteger(value)) return option.minQuantity;
  return Math.min(option.maxQuantity, Math.max(option.minQuantity, value));
}

export function mapAddParticipantError(error: unknown): string {
  if (!(error instanceof ApiClientError)) {
    return "Не удалось сохранить регистрацию. Проверьте подключение и попробуйте ещё раз.";
  }
  switch (error.code) {
    case "admin_participant_phone_exists":
      return "Этот телефон уже есть в системе. Выберите участника из базы.";
    case "admin_participant_email_exists":
      return "Этот email уже есть в системе. Найдите участника в базе и выберите его явно.";
    case "admin_participant_identity_conflict":
      return "Данные относятся к разным профилям. Проверьте данные вручную и не создавайте новую запись.";
    case "admin_participant_unavailable":
      return "Этот участник сейчас недоступен для регистрации.";
    case "capacity_unavailable":
      return "Недостаточно свободных мест для выбранных вариантов. Измените выбор и попробуйте снова.";
    case "forbidden":
    case "not_found":
      return "У вас нет доступа к этому событию или участнику.";
    case "validation_error":
      return "Проверьте дату события, варианты участия и количество.";
    default:
      return error.status >= 500 || error.status === 0
        ? "Сервис временно недоступен. Попробуйте ещё раз."
        : "Не удалось сохранить регистрацию. Проверьте введённые данные.";
  }
}

export function buildAdminRegistrationRequest({
  comment,
  email,
  fullName,
  mode,
  occurrenceId,
  optionSelections,
  participant,
  phone,
  seatsCount,
}: {
  comment: string;
  email: string;
  fullName: string;
  mode: ParticipantMode;
  occurrenceId: string | null;
  optionSelections: OptionSelections;
  participant: AdminRegistrationParticipant | null;
  phone: string;
  seatsCount: number;
}): CreateAdminEventRegistrationRequest | null {
  const selectedOptions = Object.entries(optionSelections).map(([optionId, quantity]) => ({
    optionId,
    quantity,
  }));
  const identity = mode === "existing"
    ? participant ? { mode: "existing" as const, userId: participant.id } : null
    : fullName.trim() && phone.trim()
      ? {
        mode: "new" as const,
        fullName: fullName.trim(),
        phone: phone.trim(),
        email: email.trim() || null,
      }
      : null;
  if (!identity) return null;
  return {
    participant: identity,
    occurrenceId,
    optionSelections: selectedOptions,
    seatsCount,
    guestNames: [],
    comment: comment.trim() || null,
  };
}

export function AddParticipantDialog({
  eventId,
  eventTitle,
  occurrenceId,
  occurrenceLabel,
  occurrenceRequired,
  registrationMode,
  onClose,
  onSuccess,
}: AddParticipantDialogProps) {
  const [mode, setMode] = useState<ParticipantMode>("existing");
  const [search, setSearch] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [participants, setParticipants] = useState<AdminRegistrationParticipant[]>([]);
  const [selectedParticipant, setSelectedParticipant] = useState<AdminRegistrationParticipant | null>(null);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [comment, setComment] = useState("");
  const [seatsCount, setSeatsCount] = useState(String(INITIAL_SEATS_COUNT));
  const [options, setOptions] = useState<ParticipationOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [optionSelections, setOptionSelections] = useState<OptionSelections>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, submitting]);

  useEffect(() => {
    let active = true;
    setOptionsLoading(true);
    setOptionsError(null);
    void listAdminEventParticipationOptions(eventId)
      .then((nextOptions) => {
        if (active) setOptions(nextOptions.filter((option) => option.isActive));
      })
      .catch(() => {
        if (active) setOptionsError("Не удалось загрузить варианты участия.");
      })
      .finally(() => {
        if (active) setOptionsLoading(false);
      });
    return () => { active = false; };
  }, [eventId]);

  useEffect(() => {
    if (mode !== "existing" || !search.trim()) {
      setParticipants([]);
      setSearchLoading(false);
      setSearchError(null);
      return undefined;
    }
    const controller = new AbortController();
    const delay = window.setTimeout(() => {
      setSearchLoading(true);
      setSearchError(null);
      void searchAdminRegistrationParticipants(eventId, search.trim(), controller.signal)
        .then((nextParticipants) => {
          if (!controller.signal.aborted) setParticipants(nextParticipants);
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            setParticipants([]);
            setSearchError(mapAddParticipantError(error));
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearchLoading(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(delay);
      controller.abort();
    };
  }, [eventId, mode, search]);

  const activeOptions = useMemo(
    () => [...options].sort((left, right) => left.sortOrder - right.sortOrder),
    [options],
  );
  const usesCalculatedSeats = registrationMode === "internal_paid" && activeOptions.length > 0;
  const calculatedSeats = activeOptions.reduce((total, option) => {
    const quantity = optionSelections[option.id];
    return total + (quantity && !option.isDonation && option.countsTowardCapacity ? quantity : 0);
  }, 0);
  const parsedSeatsCount = Number(seatsCount);
  const resolvedSeatsCount = usesCalculatedSeats ? calculatedSeats : parsedSeatsCount;

  const switchMode = (nextMode: ParticipantMode) => {
    if (submitting || nextMode === mode) return;
    setMode(nextMode);
    setSubmitError(null);
    setSearchError(null);
    if (nextMode === "existing") {
      setFullName("");
      setPhone("");
      setEmail("");
    } else {
      setParticipants([]);
      setSelectedParticipant(null);
      setSearch("");
    }
  };

  const toggleOption = (option: ParticipationOption, checked: boolean) => {
    setOptionSelections((current) => {
      const next = { ...current };
      if (checked) next[option.id] = clampQuantity(option, option.minQuantity);
      else delete next[option.id];
      return next;
    });
    setSubmitError(null);
  };

  const setOptionQuantity = (option: ParticipationOption, rawValue: string) => {
    const value = Number(rawValue);
    setOptionSelections((current) => ({ ...current, [option.id]: clampQuantity(option, value) }));
    setSubmitError(null);
  };

  const selectParticipant = (participant: AdminRegistrationParticipant) => {
    setSelectedParticipant(participant);
    setSubmitError(null);
  };

  const requestClose = () => {
    if (!submitting) onClose();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    if (occurrenceRequired && !occurrenceId) {
      setSubmitError("Сначала выберите дату события на странице регистраций.");
      return;
    }
    if (!Number.isInteger(resolvedSeatsCount) || resolvedSeatsCount < 1 || resolvedSeatsCount > 1000) {
      setSubmitError(usesCalculatedSeats
        ? "Выбранные варианты должны занимать хотя бы одно место."
        : "Количество мест должно быть целым числом от 1 до 1000.");
      return;
    }
    const request = buildAdminRegistrationRequest({
      comment,
      email,
      fullName,
      mode,
      occurrenceId,
      optionSelections,
      participant: selectedParticipant,
      phone,
      seatsCount: resolvedSeatsCount,
    });
    if (!request) {
      setSubmitError(mode === "existing"
        ? "Найдите и явно выберите участника из базы."
        : "Заполните ФИО и телефон.");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      await createAdminEventRegistration(eventId, request);
      await onSuccess();
      onClose();
    } catch (error) {
      const nextError = mapAddParticipantError(error);
      setSubmitError(nextError);
      if (error instanceof ApiClientError && error.code === "admin_participant_phone_exists") {
        setMode("existing");
        setSelectedParticipant(null);
        setSearch(phone.trim());
      }
      if (error instanceof ApiClientError && error.code === "admin_participant_email_exists") {
        setMode("existing");
        setSelectedParticipant(null);
        setSearch(email.trim());
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="add-participant-dialog-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget) requestClose();
    }}>
      <section aria-labelledby="add-participant-dialog-title" aria-modal="true" className="add-participant-dialog" role="dialog">
        <header className="add-participant-dialog__head">
          <div>
            <span>Регистрация на событие</span>
            <h2 id="add-participant-dialog-title">Добавить участника</h2>
            <p>{eventTitle}</p>
          </div>
          <button aria-label="Закрыть добавление участника" className="registration-detail-modal__close" disabled={submitting} onClick={requestClose} ref={closeRef} type="button">×</button>
        </header>
        <form className="add-participant-dialog__body" onSubmit={handleSubmit}>
          <div className="add-participant-context">
            <span>Дата события</span>
            <strong>{occurrenceLabel ?? "Для события не требуется отдельная дата"}</strong>
          </div>
          <div className="add-participant-modes" role="tablist" aria-label="Способ выбора участника">
            <button aria-selected={mode === "existing"} className={mode === "existing" ? "is-active" : undefined} disabled={submitting} onClick={() => switchMode("existing")} role="tab" type="button">Из базы</button>
            <button aria-selected={mode === "new"} className={mode === "new" ? "is-active" : undefined} disabled={submitting} onClick={() => switchMode("new")} role="tab" type="button">Новый участник</button>
          </div>

          {mode === "existing" ? (
            <section className="add-participant-section" aria-label="Поиск участника">
              <label className="add-participant-field">
                <span>Поиск</span>
                <input autoComplete="off" disabled={submitting} onChange={(event) => { setSearch(event.target.value); setSelectedParticipant(null); }} placeholder="ФИО, телефон или email" ref={searchRef} type="search" value={search} />
              </label>
              {searchLoading ? <p className="add-participant-state">Ищем участников…</p> : null}
              {searchError ? <p className="form-error" role="alert">{searchError}</p> : null}
              {search.trim() && !searchLoading && !searchError && participants.length === 0 ? <p className="add-participant-state">Участники не найдены.</p> : null}
              {participants.length > 0 ? <div className="add-participant-results" role="listbox" aria-label="Результаты поиска">
                {participants.map((participant) => <button aria-selected={selectedParticipant?.id === participant.id} className={selectedParticipant?.id === participant.id ? "is-selected" : undefined} disabled={submitting} key={participant.id} onClick={() => selectParticipant(participant)} role="option" type="button">
                  <strong>{participant.displayName}</strong>
                  <span>{[participant.phone, participant.email].filter(Boolean).join(" · ") || "Контакты не указаны"}</span>
                </button>)}
              </div> : null}
              {selectedParticipant ? <p className="add-participant-selected">Выбран: <strong>{selectedParticipant.displayName}</strong></p> : null}
            </section>
          ) : (
            <section className="add-participant-section add-participant-fields" aria-label="Новый участник">
              <label className="add-participant-field"><span>ФИО</span><input autoComplete="name" disabled={submitting} onChange={(event) => setFullName(event.target.value)} value={fullName} /></label>
              <label className="add-participant-field"><span>Телефон</span><input autoComplete="tel" disabled={submitting} onChange={(event) => setPhone(event.target.value)} type="tel" value={phone} /></label>
              <label className="add-participant-field"><span>Email <em>необязательно</em></span><input autoComplete="email" disabled={submitting} onChange={(event) => setEmail(event.target.value)} type="email" value={email} /></label>
            </section>
          )}

          <section className="add-participant-section" aria-labelledby="add-participant-options-title">
            <h3 id="add-participant-options-title">Варианты участия</h3>
            {optionsLoading ? <p className="add-participant-state">Загружаем варианты…</p> : null}
            {optionsError ? <p className="form-error" role="alert">{optionsError}</p> : null}
            {!optionsLoading && !optionsError && activeOptions.length === 0 ? <p className="add-participant-state">Для события нет настроенных вариантов участия.</p> : null}
            <div className="add-participant-options">
              {activeOptions.map((option) => {
                const quantity = optionSelections[option.id];
                const price = formatPrice(option);
                return <div className="add-participant-option" key={option.id}>
                  <label><input checked={quantity !== undefined} disabled={submitting} onChange={(event) => toggleOption(option, event.target.checked)} type="checkbox" /><span><strong>{option.title}</strong>{option.description ? <small>{option.description}</small> : null}{price ? <em>{price}</em> : null}</span></label>
                  {option.allowQuantity && quantity !== undefined ? <label className="add-participant-quantity"><span>Количество</span><input disabled={submitting} max={option.maxQuantity} min={option.minQuantity} onChange={(event) => setOptionQuantity(option, event.target.value)} step={1} type="number" value={quantity} /></label> : null}
                </div>;
              })}
            </div>
          </section>

          {usesCalculatedSeats ? <p className="add-participant-state">Мест по выбранным вариантам: {calculatedSeats}</p> : <label className="add-participant-field add-participant-field--compact"><span>Количество мест</span><input disabled={submitting} inputMode="numeric" max={1000} min={1} onChange={(event) => setSeatsCount(event.target.value)} step={1} type="number" value={seatsCount} /></label>}
          <label className="add-participant-field"><span>Комментарий <em>необязательно</em></span><textarea disabled={submitting} onChange={(event) => setComment(event.target.value)} rows={3} value={comment} /></label>
          {submitError ? <p className="form-error" role="alert">{submitError}</p> : null}
          <footer className="add-participant-dialog__actions"><Button disabled={submitting} onClick={requestClose} variant="ghost">Отмена</Button><Button disabled={submitting || optionsLoading || Boolean(optionsError)} type="submit" variant="primary">{submitting ? "Сохраняем…" : "Зарегистрировать"}</Button></footer>
        </form>
      </section>
    </div>,
    document.body,
  );
}
