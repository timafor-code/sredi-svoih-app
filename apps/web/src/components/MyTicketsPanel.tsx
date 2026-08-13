import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getMyRegistrations, PublicApiError } from "../api";
import { formatDateTimeRange } from "../format";
import {
  getRegistrationEndsAt,
  getRegistrationStartsAt,
  getRegistrationTimezone,
  groupMyRegistrations,
  type MyRegistrationPeriod,
} from "../registrationGroups";
import type {
  MyRegistration,
  MyRegistrationPaymentStatus,
  MyRegistrationStatus,
} from "../types";

const REGISTRATION_STATUS_LABELS: Record<MyRegistrationStatus, string> = {
  confirmed: "Подтверждено",
  pending: "Ожидает подтверждения",
  waitlisted: "В листе ожидания",
  cancelled: "Запись отменена",
  rejected: "Заявка отклонена",
  attended: "Посещение отмечено",
  no_show: "Не посетили",
};

const PAYMENT_STATUS_LABELS: Record<MyRegistrationPaymentStatus, string> = {
  not_required: "Оплата не требуется",
  pending: "Оплата ожидается",
  succeeded: "Оплачено",
  paid: "Оплачено",
  refunded: "Возврат",
  failed: "Оплата не прошла",
  cancelled: "Оплата отменена",
};

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency: currency.toUpperCase(),
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString("ru-RU")} ${currency.toUpperCase()}`;
  }
}

function formatGuests(guests: unknown[]): string | null {
  const names = guests
    .filter((guest): guest is string => typeof guest === "string")
    .map((guest) => guest.trim())
    .filter(Boolean);
  return names.length > 0 ? names.join(", ") : null;
}

function TicketCard({ registration }: { registration: MyRegistration }): ReactNode {
  const timeZone = getRegistrationTimezone(registration);
  const location = [registration.event.location_name, registration.event.address]
    .filter(Boolean)
    .join(", ");
  const guests = formatGuests(registration.guest_names);
  const total = registration.total_amount === null || registration.total_currency === null
    ? "Бесплатно"
    : formatMoney(registration.total_amount, registration.total_currency);

  return (
    <article className="ticket-card">
      <div className="ticket-card-heading">
        <div>
          <h3>{registration.event.title}</h3>
          {registration.occurrence?.title ? <p>{registration.occurrence.title}</p> : null}
        </div>
        <div className="ticket-badges" aria-label="Статусы регистрации">
          <span className={`ticket-badge registration-${registration.status}`}>
            {REGISTRATION_STATUS_LABELS[registration.status]}
          </span>
          <span className={`ticket-badge payment-${registration.payment_status}`}>
            {PAYMENT_STATUS_LABELS[registration.payment_status]}
          </span>
        </div>
      </div>

      <dl className="ticket-details">
        <div>
          <dt>Дата и время</dt>
          <dd>{formatDateTimeRange(
            getRegistrationStartsAt(registration),
            getRegistrationEndsAt(registration),
            timeZone,
          )}</dd>
        </div>
        {location ? <div><dt>Место</dt><dd>{location}</dd></div> : null}
        <div><dt>Мест</dt><dd>{registration.seats_count}</dd></div>
        {guests ? <div><dt>Гости</dt><dd>{guests}</dd></div> : null}
      </dl>

      {registration.selected_options.length > 0 ? (
        <div className="ticket-options" aria-label="Выбранные варианты участия">
          <h4>Варианты участия</h4>
          <ul>
            {registration.selected_options.map((option) => (
              <li key={option.id}>
                <div>
                  <strong>{option.title_snapshot} × {option.quantity}</strong>
                  {option.description_snapshot ? <span>{option.description_snapshot}</span> : null}
                  {option.counts_toward_capacity && option.seats_count > 0 ? (
                    <span>Мест по варианту: {option.seats_count}</span>
                  ) : null}
                  {option.is_donation && !option.counts_toward_capacity ? (
                    <span>Пожертвование — места не добавляет</span>
                  ) : null}
                </div>
                <span>{formatMoney(option.total_amount, option.currency)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <dl className="ticket-totals">
        <div><dt>Итого</dt><dd>{total}</dd></div>
        <div><dt>Оплата</dt><dd>{PAYMENT_STATUS_LABELS[registration.payment_status]}</dd></div>
        <div>
          <dt>Дата регистрации</dt>
          <dd>{formatDateTimeRange(registration.registered_at, null, timeZone)}</dd>
        </div>
      </dl>
    </article>
  );
}

export function MyTicketsPanel({
  accessToken,
  revision,
  onClose,
  onUnauthorized,
}: {
  accessToken: string;
  revision: number;
  onClose: () => void;
  onUnauthorized: () => void;
}): ReactNode {
  const panelRef = useRef<HTMLElement>(null);
  const onUnauthorizedRef = useRef(onUnauthorized);
  const [period, setPeriod] = useState<MyRegistrationPeriod>("active");
  const [registrations, setRegistrations] = useState<MyRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryRevision, setRetryRevision] = useState(0);

  useEffect(() => {
    onUnauthorizedRef.current = onUnauthorized;
  }, [onUnauthorized]);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setLoading(true);
    setError(false);

    getMyRegistrations(accessToken, controller.signal)
      .then((items) => {
        if (!current) return;
        setRegistrations(items);
        setLoading(false);
      })
      .catch((requestError: unknown) => {
        if (!current || controller.signal.aborted) return;
        setRegistrations([]);
        setLoading(false);
        if (requestError instanceof PublicApiError && requestError.status === 401) {
          onUnauthorizedRef.current();
          return;
        }
        setError(true);
      });

    return () => {
      current = false;
      controller.abort();
    };
  }, [accessToken, retryRevision, revision]);

  const groups = useMemo(() => groupMyRegistrations(registrations), [registrations]);
  const visibleRegistrations = groups[period];

  return (
    <section
      ref={panelRef}
      className="surface my-tickets-panel"
      aria-labelledby="my-tickets-heading"
      tabIndex={-1}
    >
      <div className="my-tickets-heading-row">
        <div>
          <p className="eyebrow">Аккаунт</p>
          <h2 id="my-tickets-heading">Мои билеты</h2>
        </div>
        <button className="text-button my-tickets-close" type="button" onClick={onClose}>
          Назад к регистрации
        </button>
      </div>

      <div className="ticket-tabs" role="tablist" aria-label="Период регистраций">
        {(["active", "past"] as const).map((value) => (
          <button
            key={value}
            className={period === value ? "ticket-tab is-active" : "ticket-tab"}
            type="button"
            role="tab"
            aria-selected={period === value}
            aria-controls="ticket-list-panel"
            onClick={() => setPeriod(value)}
          >
            {value === "active" ? "Актуальные" : "Прошедшие"}
          </button>
        ))}
      </div>

      <div id="ticket-list-panel" role="tabpanel" aria-live="polite" aria-busy={loading}>
        {loading ? <p className="tickets-state" role="status">Загружаем ваши регистрации…</p> : null}
        {!loading && error ? (
          <div className="tickets-state tickets-error" role="alert">
            <p>Не удалось загрузить регистрации. Попробуйте ещё раз.</p>
            <button className="secondary-button" type="button" onClick={() => setRetryRevision((value) => value + 1)}>
              Повторить
            </button>
          </div>
        ) : null}
        {!loading && !error && visibleRegistrations.length === 0 ? (
          <p className="tickets-state">У вас пока нет регистраций.</p>
        ) : null}
        {!loading && !error && visibleRegistrations.length > 0 ? (
          <div className="ticket-list">
            {visibleRegistrations.map((registration) => (
              <TicketCard key={registration.id} registration={registration} />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
