import { useEffect, useMemo, useState } from "react";

import type { AdminEventOccurrence } from "../../types/eventOccurrences";
import type {
  AdminRegistrationCapacityAnalytics,
  AdminRegistrationCapacityBucket,
} from "../../types/registrationCapacity";
import type { AdminRegistrationEventSummary } from "../../types/registrations";
import { formatDateTime } from "./formatters";

type CapacityOverviewMode = "total" | "options" | "buckets";

type CapacityBucketView = AdminRegistrationCapacityBucket & {
  effectiveCapacity: number | null;
  effectiveRemainingSeats: number | null;
  effectiveFillPercent: number | null;
  effectiveFreePercent: number | null;
  usesFallbackCapacity: boolean;
};

const CAPACITY_OVERVIEW_MODE_OPTIONS: Array<{
  value: CapacityOverviewMode;
  label: string;
}> = [
  { value: "total", label: "Все места выбранной даты" },
  { value: "options", label: "По вариантам участия" },
  { value: "buckets", label: "По слотам мест" },
];

export function RegistrationCapacityBucketsOverview({
  analytics,
  analyticsError,
  analyticsLoading,
  event,
  onOpenSeatingPlaceholder,
  selectedOccurrence,
}: {
  analytics: AdminRegistrationCapacityAnalytics | null;
  analyticsError: string | null;
  analyticsLoading: boolean;
  event: AdminRegistrationEventSummary;
  onOpenSeatingPlaceholder: (bucket: AdminRegistrationCapacityBucket) => void;
  selectedOccurrence: AdminEventOccurrence | null;
}) {
  const [mode, setMode] = useState<CapacityOverviewMode>("total");
  const isOccurrenceMissing = event.occurrenceCount > 0 && !selectedOccurrence;
  const buckets = analytics?.buckets ?? [];
  const hasBuckets = buckets.length > 0;
  const selectedModeLabel =
    CAPACITY_OVERVIEW_MODE_OPTIONS.find((entry) => entry.value === mode)?.label ??
    CAPACITY_OVERVIEW_MODE_OPTIONS[0].label;
  const occupiedSeats = analytics?.totals.activeSeatsCount ?? 0;
  const optionStats = analytics?.optionStats ?? [];
  const legacyCapacity =
    analytics?.totals.capacity ?? selectedOccurrence?.capacity ?? event.capacity ?? null;
  const legacySafeCapacity = Math.max(0, legacyCapacity ?? 0);
  const legacyFillPercent =
    analytics?.totals.fillPercent ??
    (legacyCapacity !== null && legacySafeCapacity > 0
      ? Math.min(100, Math.round((occupiedSeats / legacySafeCapacity) * 100))
      : null);
  const legacyRemainingSeats =
    analytics?.totals.remainingSeats ??
    (legacyCapacity !== null ? Math.max(0, legacySafeCapacity - occupiedSeats) : null);
  const legacyFreePercent =
    analytics?.totals.freePercent ??
    (legacyCapacity !== null && legacySafeCapacity > 0 && legacyRemainingSeats !== null
      ? Math.max(0, 100 - (legacyFillPercent ?? 0))
      : null);
  const bucketViews = useMemo(
    () => buckets.map((bucket) => buildCapacityBucketView(bucket, legacyCapacity)),
    [buckets, legacyCapacity],
  );
  const fallbackBucketAggregate = useMemo(
    () => buildCapacityBucketAggregate(bucketViews),
    [bucketViews],
  );
  const bucketAggregate = analytics?.bucketAggregate ?? fallbackBucketAggregate;

  useEffect(() => {
    setMode(hasBuckets ? "buckets" : "total");
  }, [event.eventId, hasBuckets, selectedOccurrence?.id]);

  const renderLegacyTotal = () => {
    if (analyticsLoading) {
      return (
        <div className="registration-capacity-soft-state">
          Загружаем данные занятости мест...
        </div>
      );
    }

    if (analyticsError) {
      return (
        <div className="registration-capacity-soft-state registration-capacity-soft-state--error">
          <strong>Не удалось загрузить данные занятости мест.</strong>
          <span>{analyticsError}</span>
        </div>
      );
    }

    return (
      <div className="registration-capacity-total">
        <div className="registration-capacity-total__main">
          <span>Зарегистрировалось</span>
          <strong>
            {legacyCapacity !== null
              ? `${occupiedSeats} из ${legacySafeCapacity} мест`
              : `${occupiedSeats} мест`}
          </strong>
          <small>
            {legacyCapacity !== null && legacyRemainingSeats !== null
              ? `Осталось ${legacyRemainingSeats} мест`
              : "Лимит мест не задан"}
          </small>
        </div>

        <RegistrationCapacityMeter
          fillPercent={legacyFillPercent}
          label={
            legacyFillPercent !== null
              ? `${legacyFillPercent}% заполнено`
              : "Лимит мест не задан"
          }
          secondaryLabel={
            legacyFreePercent !== null && legacyRemainingSeats !== null
              ? `${legacyRemainingSeats} (${legacyFreePercent}%) свободно`
              : null
          }
        />

        <div className="registration-capacity-total__free">
          <span>Свободные места</span>
          <strong>
            {legacyRemainingSeats !== null && legacyFreePercent !== null
              ? `${legacyRemainingSeats} (${legacyFreePercent}%)`
              : "Лимит не задан"}
          </strong>
          <small>
            {legacyRemainingSeats !== null
              ? `Осталось ${legacyRemainingSeats} мест`
              : "Без расчёта процента"}
          </small>
        </div>
      </div>
    );
  };

  const renderBucketAggregate = () => (
    <>
      <div className="registration-capacity-total">
        <div className="registration-capacity-total__main">
          <span>Занято по слотам</span>
          <strong>
            {bucketAggregate.knownCapacity > 0 && !bucketAggregate.hasUnlimitedBuckets
              ? `${bucketAggregate.occupiedSeats} из ${bucketAggregate.knownCapacity} мест`
              : `${bucketAggregate.occupiedSeats} мест`}
          </strong>
          <small>
            {bucketAggregate.knownCapacity > 0
              ? `Осталось ${bucketAggregate.remainingSeats} мест в слотах с лимитом`
              : "Лимит мест не задан"}
          </small>
        </div>

        <RegistrationCapacityMeter
          fillPercent={bucketAggregate.fillPercent}
          label={
            bucketAggregate.fillPercent !== null
              ? `${bucketAggregate.fillPercent}% заполнено`
              : "Лимит мест не задан"
          }
          secondaryLabel={
            bucketAggregate.freePercent !== null
              ? `${bucketAggregate.remainingSeats} (${bucketAggregate.freePercent}%) свободно`
              : null
          }
        />

        <div className="registration-capacity-total__free">
          <span>Свободные места</span>
          <strong>
            {bucketAggregate.knownCapacity > 0 && bucketAggregate.freePercent !== null
              ? `${bucketAggregate.remainingSeats} (${bucketAggregate.freePercent}%)`
              : "Лимит не задан"}
          </strong>
          <small>
            {bucketAggregate.knownCapacity > 0
              ? `По ${bucketAggregate.limitedBucketCount} слотам с лимитом`
              : "Без расчёта процента"}
          </small>
        </div>
      </div>

      {bucketAggregate.hasUnlimitedBuckets ? (
        <p className="registration-capacity-helper">
          Есть слоты без лимита, общий процент рассчитан только по слотам с лимитом.
        </p>
      ) : null}
    </>
  );

  const renderTotal = () => {
    if (hasBuckets) {
      return renderBucketAggregate();
    }

    return (
      <>
        {analyticsLoading ? (
          <div className="registration-capacity-soft-state">
            Загружаем слоты мест...
          </div>
        ) : analyticsError ? (
          <div className="registration-capacity-soft-state registration-capacity-soft-state--error">
            <strong>Не удалось загрузить слоты мест.</strong>
            <span>{analyticsError}</span>
          </div>
        ) : null}
        {renderLegacyTotal()}
      </>
    );
  };

  const renderBuckets = () => {
    if (analyticsLoading) {
      return (
        <div className="registration-capacity-soft-state">
          Загружаем слоты мест...
        </div>
      );
    }

    if (analyticsError) {
      return (
        <div className="registration-capacity-soft-state registration-capacity-soft-state--error">
          <strong>Не удалось загрузить слоты мест.</strong>
          <span>{analyticsError}</span>
        </div>
      );
    }

    if (bucketViews.length === 0) {
      return (
        <div className="registration-capacity-soft-state">
          Слоты мест для выбранной даты не найдены. Используется общий overview.
        </div>
      );
    }

    return (
      <div className="registration-capacity-buckets">
        {bucketViews.map((bucket) => {
          const hasCapacity = bucket.effectiveCapacity !== null;
          const title = bucket.title || "Слот мест";
          const bucketKey = bucket.key || bucket.capacityUnitId;

          return (
            <div className="registration-capacity-bucket-row" key={bucket.capacityUnitId}>
              <div className="registration-capacity-bucket-row__head">
                <div className="registration-capacity-bucket-row__title">
                  <strong>{title}</strong>
                  <span>{bucketKey}</span>
                </div>
                <div className="registration-capacity-bucket-row__count">
                  <strong>
                    {hasCapacity
                      ? `${bucket.occupiedSeats} из ${bucket.effectiveCapacity} мест`
                      : `${bucket.occupiedSeats} мест`}
                  </strong>
                  <span>
                    {hasCapacity && bucket.effectiveRemainingSeats !== null
                      ? `Осталось ${bucket.effectiveRemainingSeats}`
                      : "Лимит не задан"}
                  </span>
                </div>
                <button
                  className="registration-capacity-bucket-row__seat-button"
                  onClick={() => onOpenSeatingPlaceholder(bucket)}
                  title="Схема рассадки будет добавлена в следующем PR"
                  type="button"
                >
                  Схема рассадки
                </button>
              </div>

              <RegistrationCapacityMeter
                fillPercent={bucket.effectiveFillPercent}
                label={
                  bucket.effectiveFillPercent !== null
                    ? `${bucket.effectiveFillPercent}% заполнено`
                    : "Лимит не задан"
                }
                secondaryLabel={
                  bucket.effectiveFreePercent !== null && bucket.effectiveRemainingSeats !== null
                    ? `${bucket.effectiveRemainingSeats} (${bucket.effectiveFreePercent}%) свободно`
                    : null
                }
              />

              <div className="registration-capacity-bucket-row__meta">
                {bucket.optionTitles.length > 0 ? (
                  <span>Варианты: {bucket.optionTitles.join(", ")}</span>
                ) : null}
                {bucket.reservationsCount > 0 ? (
                  <span>{bucket.reservationsCount} резерв.</span>
                ) : null}
                {bucket.usesFallbackCapacity ? (
                  <span>лимит взят из выбранной даты/события</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderOptions = () => {
    if (analyticsLoading) {
      return (
        <div className="registration-capacity-soft-state">
          Загружаем варианты участия...
        </div>
      );
    }

    if (analyticsError) {
      return (
        <div className="registration-capacity-soft-state registration-capacity-soft-state--error">
          <strong>Не удалось загрузить варианты участия.</strong>
          <span>{analyticsError}</span>
        </div>
      );
    }

    return (
      <>
        <div className="registration-capacity-options">
          {optionStats.length > 0 ? (
            optionStats.map((option) => {
              const doesNotOccupySeats =
                option.isDonation || option.countsTowardCapacity === false;

              return (
                <div className="registration-capacity-option-row" key={getCapacityOptionKey(option)}>
                  <div>
                    <strong>{option.title}</strong>
                    {doesNotOccupySeats ? <span>места не занимает</span> : null}
                  </div>
                  <span>{option.quantity} шт.</span>
                  <span>{option.seatsCount} мест</span>
                </div>
              );
            })
          ) : (
            <div className="registration-capacity-options__empty">
              В загруженных заявках нет выбранных вариантов участия.
            </div>
          )}
        </div>
        <p className="registration-capacity-helper">
          Фактическая занятость мест считается по слотам мест.
        </p>
      </>
    );
  };

  return (
    <section className="registration-capacity-overview" aria-label="Занятость мест">
      <div className="registration-capacity-overview__head">
        <div>
          <span>{formatCapacityScopeLabel(event, selectedOccurrence)}</span>
          <strong>{selectedModeLabel}</strong>
        </div>
        <label className="registration-capacity-overview__mode">
          <span>Статистика</span>
          <select
            onChange={(selectEvent) =>
              setMode(selectEvent.target.value as CapacityOverviewMode)
            }
            value={mode}
          >
            {CAPACITY_OVERVIEW_MODE_OPTIONS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {isOccurrenceMissing ? (
        <div className="registration-capacity-soft-state">
          Выберите дату/сеанс, чтобы увидеть занятость мест.
        </div>
      ) : mode === "buckets" ? (
        renderBuckets()
      ) : mode === "total" ? (
        renderTotal()
      ) : (
        renderOptions()
      )}
    </section>
  );
}

function formatCapacityScopeLabel(
  event: AdminRegistrationEventSummary,
  selectedOccurrence: AdminEventOccurrence | null,
): string {
  if (selectedOccurrence) {
    const titleSuffix = selectedOccurrence.title ? ` · ${selectedOccurrence.title}` : "";
    return `${formatDateTime(selectedOccurrence.startsAt)}${titleSuffix}`;
  }

  return event.startsAt ? formatDateTime(event.startsAt) : "Дата события";
}

function buildCapacityBucketView(
  bucket: AdminRegistrationCapacityBucket,
  fallbackCapacity: number | null,
): CapacityBucketView {
  const effectiveCapacity =
    bucket.effectiveCapacity !== undefined
      ? bucket.effectiveCapacity
      : bucket.capacity !== null
        ? Math.max(0, bucket.capacity)
        : fallbackCapacity;
  const safeEffectiveCapacity =
    effectiveCapacity !== null ? Math.max(0, effectiveCapacity) : null;
  const effectiveRemainingSeats =
    bucket.effectiveRemainingSeats !== undefined
      ? bucket.effectiveRemainingSeats
      : safeEffectiveCapacity !== null
        ? Math.max(0, safeEffectiveCapacity - bucket.occupiedSeats)
        : null;
  const effectiveFillPercent =
    bucket.effectiveFillPercent !== undefined
      ? bucket.effectiveFillPercent
      : safeEffectiveCapacity !== null && safeEffectiveCapacity > 0
        ? Math.min(100, Math.round((bucket.occupiedSeats / safeEffectiveCapacity) * 100))
        : null;
  const effectiveFreePercent =
    bucket.effectiveFreePercent !== undefined
      ? bucket.effectiveFreePercent
      : effectiveFillPercent !== null
        ? Math.max(0, 100 - effectiveFillPercent)
        : null;

  return {
    ...bucket,
    effectiveCapacity: safeEffectiveCapacity,
    effectiveRemainingSeats,
    effectiveFillPercent,
    effectiveFreePercent,
    usesFallbackCapacity:
      bucket.usesFallbackCapacity ?? (bucket.capacity === null && fallbackCapacity !== null),
  };
}

function buildCapacityBucketAggregate(buckets: CapacityBucketView[]) {
  const occupiedSeats = buckets.reduce((total, bucket) => total + bucket.occupiedSeats, 0);
  const limitedBuckets = buckets.filter((bucket) => bucket.effectiveCapacity !== null);
  const knownCapacity = limitedBuckets.reduce(
    (total, bucket) => total + (bucket.effectiveCapacity ?? 0),
    0,
  );
  const knownOccupiedSeats = limitedBuckets.reduce(
    (total, bucket) => total + bucket.occupiedSeats,
    0,
  );
  const remainingSeats = limitedBuckets.reduce(
    (total, bucket) => total + (bucket.effectiveRemainingSeats ?? 0),
    0,
  );
  const fillPercent =
    knownCapacity > 0
      ? Math.min(100, Math.round((knownOccupiedSeats / knownCapacity) * 100))
      : null;
  const freePercent = fillPercent !== null ? Math.max(0, 100 - fillPercent) : null;

  return {
    occupiedSeats,
    knownCapacity,
    remainingSeats,
    fillPercent,
    freePercent,
    limitedBucketCount: limitedBuckets.length,
    hasUnlimitedBuckets: limitedBuckets.length < buckets.length,
  };
}

function RegistrationCapacityMeter({
  fillPercent,
  label,
  secondaryLabel,
}: {
  fillPercent: number | null;
  label: string;
  secondaryLabel: string | null;
}) {
  return (
    <div className="registration-capacity-meter">
      <div
        aria-valuemax={fillPercent !== null ? 100 : undefined}
        aria-valuemin={fillPercent !== null ? 0 : undefined}
        aria-valuenow={fillPercent ?? undefined}
        className="registration-capacity-meter__track"
        role={fillPercent !== null ? "progressbar" : undefined}
      >
        <span style={{ width: `${fillPercent ?? 0}%` }} />
      </div>
      <div className="registration-capacity-meter__labels">
        <span>{label}</span>
        {secondaryLabel ? <span>{secondaryLabel}</span> : null}
      </div>
    </div>
  );
}

function getCapacityOptionKey(option: {
  optionId: string | null;
  title: string;
  optionType: string;
  isDonation: boolean;
  countsTowardCapacity: boolean;
}): string {
  return [
    option.optionId ?? option.title,
    option.optionType,
    option.isDonation ? "donation" : "seat",
    option.countsTowardCapacity ? "capacity" : "no-capacity",
  ].join("|");
}
