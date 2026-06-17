import type { ReactNode } from "react";

import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import type { AdminEventRegistrationRow, AdminRegistrationEventSummary } from "../../types/registrations";
import {
  formatDateTime,
  formatMoney,
  formatOccurrenceLabel,
  formatPaymentStatus,
  formatRegistrationAmount,
  getInitials,
  getRegistrationStatusLabel,
  getRegistrationStatusTone,
  isSimulatedPaymentId,
} from "./formatters";
import { RegistrationsState } from "./RegistrationsState";
import type { ActionInFlight, RegistrationAction } from "./types";

export function RegistrationDetailPanel({
  actionInFlight,
  actions,
  event,
  onAction,
  registration,
}: {
  actionInFlight: ActionInFlight | null;
  actions: RegistrationAction[];
  event: AdminRegistrationEventSummary | null;
  onAction: (registration: AdminEventRegistrationRow, action: RegistrationAction) => void;
  registration: AdminEventRegistrationRow | null;
}) {
  if (!registration || !event) {
    return (
      <RegistrationsState
        description="Выберите строку в таблице, чтобы открыть контакты, опции и историю статусов."
        title="Заявка не выбрана"
      />
    );
  }

  return (
    <div className="registration-detail">
      <div className="registration-detail__profile">
        <span className="registration-avatar registration-avatar--large" aria-hidden="true">
          {getInitials(registration.participantDisplayName)}
        </span>
        <h2>{registration.participantDisplayName}</h2>
        <div className="badge-row">
          <Badge tone={getRegistrationStatusTone(registration.status)}>
            {getRegistrationStatusLabel(registration.status)}
          </Badge>
          <Badge tone="glass">{registration.seatsCount} мест</Badge>
        </div>
      </div>

      <DetailSection title="Контакты">
        <DetailRow label="Email" value={registration.email ?? "Не указан"} />
        <DetailRow label="Телефон" value={registration.phone ?? "Не указан"} />
        <DetailRow label="User ID" value={registration.userId} />
      </DetailSection>

      <DetailSection title="Событие и сеанс">
        <DetailRow label="Событие" value={event.title} />
        <DetailRow label="Дата" value={formatOccurrenceLabel(registration, event)} />
        <DetailRow
          label="Сеанс"
          value={registration.occurrenceTitle ?? "Без отдельного сеанса"}
        />
      </DetailSection>

      <DetailSection title="Опции участия">
        {registration.selectedOptions.length > 0 ? (
          <div className="registration-options-list">
            {registration.selectedOptions.map((option) => (
              <div className="registration-option-row" key={option.id || option.title}>
                <div>
                  <strong>{option.title}</strong>
                  <span>
                    {option.isDonation ? "Пожертвование" : option.optionType} × {option.quantity}
                  </span>
                </div>
                <div>
                  <strong>{formatMoney(option.totalAmount, option.currency)}</strong>
                  <span>{option.isDonation ? "не место" : `${option.seatsCount} мест`}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="registration-detail__muted">Опции не выбраны.</p>
        )}
      </DetailSection>

      <DetailSection title="Гости и комментарий">
        {registration.guestNames.length > 0 ? (
          <div className="registration-guest-list">
            {registration.guestNames.map((guestName) => (
              <span key={guestName}>{guestName}</span>
            ))}
          </div>
        ) : (
          <p className="registration-detail__muted">Гости не указаны.</p>
        )}
        <DetailRow label="Комментарий" value={registration.comment ?? "Нет комментария"} />
      </DetailSection>

      <DetailSection title="Оплата">
        <DetailRow label="Статус" value={formatPaymentStatus(registration.paymentStatus)} />
        {isSimulatedPaymentId(registration.paymentId) ? (
          <div className="registration-detail-row">
            <span>Тип оплаты</span>
            <strong>
              <Badge tone="gold">Тестовая оплата</Badge>
            </strong>
          </div>
        ) : null}
        <DetailRow label="Сумма" value={formatRegistrationAmount(registration)} />
        <DetailRow label="Payment ID" value={registration.paymentId ?? "Не указан"} />
      </DetailSection>

      <DetailSection title="История">
        <DetailRow label="Зарегистрирован" value={formatDateTime(registration.registeredAt)} />
        <DetailRow label="Подтверждён" value={formatDateTime(registration.confirmedAt)} />
        <DetailRow label="Отменён/отклонён" value={formatDateTime(registration.cancelledAt)} />
      </DetailSection>

      <DetailSection title="Действия">
        <div className="registration-detail-actions">
          {actions.map((action) => {
            const isCurrentStatus = registration.status === action.status;
            const isLoading =
              actionInFlight?.registrationId === registration.id &&
              actionInFlight.status === action.status;

            return (
              <Button
                disabled={Boolean(actionInFlight) || isCurrentStatus}
                key={`${action.kind}-${action.status}`}
                onClick={() => onAction(registration, action)}
                size="sm"
                variant={action.variant ?? "secondary"}
              >
                {isLoading ? action.loadingLabel : action.label}
              </Button>
            );
          })}
        </div>
      </DetailSection>
    </div>
  );
}

function DetailSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="registration-detail-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="registration-detail-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
