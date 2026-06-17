import { useEffect, useMemo, useState } from "react";

import type { AdminEventOccurrence } from "../../types/eventOccurrences";
import type {
  AdminRegistrationCapacityAnalytics,
  AdminRegistrationCapacityBucket,
  AdminRegistrationCapacityBucketAggregate,
  AdminRegistrationCapacityBucketOptionBreakdown,
  AdminRegistrationCapacityOptionStat,
  AdminRegistrationCapacityTotals,
} from "../../types/registrationCapacity";
import type { AdminRegistrationEventSummary } from "../../types/registrations";
import { formatDateTime } from "./formatters";

type CapacityOverviewMode = "buckets" | "total" | "options" | "guests";
type CapacityPillTone = "default" | "hot" | "info" | "gold";
type BucketBreakdownView = "list" | "chart";

type CapacityBucketView = AdminRegistrationCapacityBucket & {
  effectiveCapacity: number | null;
  effectiveRemainingSeats: number | null;
  effectiveFillPercent: number | null;
  effectiveFreePercent: number | null;
  usesFallbackCapacity: boolean;
};

type CapacityQuickPill = {
  key: string;
  title: string;
  value: string;
  detail: string;
  fillPercent: number | null;
  tone: CapacityPillTone;
};

type BucketBreakdownEntry = {
  key: string;
  title: string;
  detail: string;
  marker: string | null;
  valueLabel: string;
  percentLabel: string;
  barPercent: number;
  chartValue: number;
  color: string;
  isFree: boolean;
  isNonSeat: boolean;
};

const CAPACITY_OVERVIEW_MODE_OPTIONS: Array<{
  value: CapacityOverviewMode;
  label: string;
}> = [
  { value: "buckets", label: "По слотам мест" },
  { value: "total", label: "Все места выбранной даты" },
  { value: "options", label: "По вариантам участия" },
  { value: "guests", label: "Уникальные гости" },
];

const HOT_FILL_PERCENT = 85;
const BUCKET_BREAKDOWN_COLORS = [
  "var(--gold)",
  "var(--green)",
  "var(--blue)",
  "var(--purple)",
  "#ff9ca2",
  "#54d6c4",
];
const BUCKET_BREAKDOWN_FREE_COLOR = "rgba(255, 255, 255, 0.32)";
const BUCKET_BREAKDOWN_NON_SEAT_COLOR = "rgba(107, 127, 212, 0.58)";

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
  const [mode, setMode] = useState<CapacityOverviewMode>("buckets");
  const [isExpanded, setIsExpanded] = useState(false);
  const isOccurrenceMissing = event.occurrenceCount > 0 && !selectedOccurrence;
  const buckets = analytics?.buckets ?? [];
  const hasBuckets = buckets.length > 0;
  const scopeLabel = formatCapacityScopeLabel(event, selectedOccurrence);
  const selectedModeLabel =
    CAPACITY_OVERVIEW_MODE_OPTIONS.find((entry) => entry.value === mode)?.label ??
    CAPACITY_OVERVIEW_MODE_OPTIONS[0].label;
  const optionStats = analytics?.optionStats ?? [];
  const bucketViews = useMemo(() => buckets.map(buildCapacityBucketView), [buckets]);
  const bucketAggregate = analytics?.bucketAggregate ?? null;
  const quickPills = useMemo(
    () =>
      analytics && !isOccurrenceMissing
        ? buildQuickPills({
            bucketAggregate,
            bucketViews,
            totals: analytics.totals,
          })
        : [],
    [analytics, bucketAggregate, bucketViews, isOccurrenceMissing],
  );

  useEffect(() => {
    setMode(hasBuckets ? "buckets" : "total");
    setIsExpanded(false);
  }, [event.eventId, hasBuckets, selectedOccurrence?.id]);

  return (
    <section
      aria-label="Места и регистрации"
      className={`registration-capacity-overview${isExpanded ? "" : " is-collapsed"}`}
    >
      <div className="cap-head">
        <button
          aria-controls="registration-capacity-detail"
          aria-expanded={isExpanded}
          className="cap-toggle"
          onClick={() => setIsExpanded((current) => !current)}
          type="button"
        >
          <span
            aria-hidden="true"
            className={`chev${isExpanded ? " chev--open" : ""}`}
          >
            ▾
          </span>
          <span>Места и регистрации</span>
          <span className="sub">{scopeLabel}</span>
        </button>

        <label className="cap-mode">
          <span>Режим</span>
          <select
            aria-label="Режим карточки мест и регистраций"
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

      {renderQuickPills({
        analyticsError,
        analyticsLoading,
        isOccurrenceMissing,
        quickPills,
      })}

      <div className="cap-detail" id="registration-capacity-detail">
        <div className="registration-capacity-detail-head">
          <span>Детализация</span>
          <strong>{selectedModeLabel}</strong>
        </div>
        {isOccurrenceMissing ? (
          renderSoftState("Выберите дату/сеанс, чтобы увидеть занятость мест.")
        ) : mode === "buckets" ? (
          renderBuckets({
            analyticsError,
            analyticsLoading,
            bucketViews,
            onOpenSeatingPlaceholder,
          })
        ) : mode === "total" ? (
          renderTotal({
            analytics,
            analyticsError,
            analyticsLoading,
            bucketAggregate,
            hasBuckets,
          })
        ) : mode === "options" ? (
          renderOptions({
            analyticsError,
            analyticsLoading,
            optionStats,
          })
        ) : (
          renderGuests({
            analytics,
            analyticsError,
            analyticsLoading,
          })
        )}
      </div>
    </section>
  );
}

function renderQuickPills({
  analyticsError,
  analyticsLoading,
  isOccurrenceMissing,
  quickPills,
}: {
  analyticsError: string | null;
  analyticsLoading: boolean;
  isOccurrenceMissing: boolean;
  quickPills: CapacityQuickPill[];
}) {
  if (isOccurrenceMissing) {
    return (
      <div className="cap-quick">
        {renderSoftState("Выберите дату/сеанс, чтобы увидеть занятость мест.")}
      </div>
    );
  }

  if (analyticsLoading && quickPills.length === 0) {
    return (
      <div className="cap-quick">
        {renderSoftState("Загружаем данные занятости мест...")}
      </div>
    );
  }

  if (analyticsError && quickPills.length === 0) {
    return (
      <div className="cap-quick">
        {renderSoftState(
          "Не удалось загрузить данные занятости мест.",
          analyticsError,
          true,
        )}
      </div>
    );
  }

  if (quickPills.length === 0) {
    return (
      <div className="cap-quick">
        {renderSoftState("Данные по местам пока не найдены.")}
      </div>
    );
  }

  return (
    <div className="cap-quick" aria-label="Краткая занятость мест">
      {quickPills.map((pill) => (
        <div
          className={`cap-pill cap-pill--${pill.tone}`}
          key={pill.key}
          title={`${pill.title}: ${pill.value}`}
        >
          <div className="cap-pill__l">
            <span>{pill.title}</span>
            <b>{pill.value}</b>
          </div>
          {pill.fillPercent !== null ? (
            <div
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={pill.fillPercent}
              className="cap-pill__bar"
              role="progressbar"
            >
              <span style={{ width: `${pill.fillPercent}%` }} />
            </div>
          ) : (
            <div className="cap-pill__hint">{pill.detail}</div>
          )}
          {pill.fillPercent !== null ? (
            <div className="cap-pill__hint">{pill.detail}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function renderTotal({
  analytics,
  analyticsError,
  analyticsLoading,
  bucketAggregate,
  hasBuckets,
}: {
  analytics: AdminRegistrationCapacityAnalytics | null;
  analyticsError: string | null;
  analyticsLoading: boolean;
  bucketAggregate: AdminRegistrationCapacityBucketAggregate | null;
  hasBuckets: boolean;
}) {
  if (analyticsLoading && !analytics) {
    return renderSoftState("Загружаем общую занятость мест...");
  }

  if (analyticsError && !analytics) {
    return renderSoftState(
      "Не удалось загрузить общую занятость мест.",
      analyticsError,
      true,
    );
  }

  if (!analytics) {
    return renderSoftState("Данные по местам пока не найдены.");
  }

  const summary = hasBuckets
    ? buildBucketAggregateSummary(bucketAggregate)
    : buildTotalsSummary(analytics.totals);

  return (
    <>
      <div className="registration-capacity-total">
        <div className="registration-capacity-total__main">
          <span>Занято по выбранной дате</span>
          <strong>{summary.occupiedLabel}</strong>
          <small>{summary.scopeHint}</small>
        </div>

        <RegistrationCapacityMeter
          fillPercent={summary.fillPercent}
          label={summary.fillLabel}
          secondaryLabel={summary.secondaryLabel}
        />

        <div className="registration-capacity-total__free">
          <span>Свободные места</span>
          <strong>{summary.remainingLabel}</strong>
          <small>{summary.capacityLabel}</small>
        </div>
      </div>

      {summary.note ? <p className="registration-capacity-helper">{summary.note}</p> : null}
    </>
  );
}

function renderBuckets({
  analyticsError,
  analyticsLoading,
  bucketViews,
  onOpenSeatingPlaceholder,
}: {
  analyticsError: string | null;
  analyticsLoading: boolean;
  bucketViews: CapacityBucketView[];
  onOpenSeatingPlaceholder: (bucket: AdminRegistrationCapacityBucket) => void;
}) {
  if (analyticsLoading && bucketViews.length === 0) {
    return renderSoftState("Загружаем слоты мест...");
  }

  if (analyticsError && bucketViews.length === 0) {
    return renderSoftState("Не удалось загрузить слоты мест.", analyticsError, true);
  }

  if (bucketViews.length === 0) {
    return renderSoftState(
      "Слоты мест для выбранной даты не найдены. Используется общий обзор.",
    );
  }

  return (
    <div className="registration-capacity-buckets">
      {bucketViews.map((bucket) => {
        const title = bucket.title || "Слот мест";
        const bucketKey = bucket.code || bucket.key || bucket.capacityUnitId;
        const capacityLabel = formatCapacityLimit(bucket.effectiveCapacity);
        const occupiedLabel =
          bucket.effectiveCapacity !== null
            ? `${bucket.occupiedSeats} из ${bucket.effectiveCapacity} мест`
            : `${bucket.occupiedSeats} мест`;
        const remainingLabel =
          bucket.effectiveRemainingSeats !== null
            ? `Свободно ${bucket.effectiveRemainingSeats}`
            : "Без лимита";

        return (
          <div className="registration-capacity-bucket-row" key={bucket.capacityUnitId}>
            <div className="registration-capacity-bucket-row__head">
              <div className="registration-capacity-bucket-row__title">
                <strong>{title}</strong>
                {bucketKey ? <span>{bucketKey}</span> : null}
              </div>
              <div className="registration-capacity-bucket-row__count">
                <strong>{occupiedLabel}</strong>
                <span>{remainingLabel}</span>
              </div>
              <button
                className="registration-capacity-bucket-row__seat-button"
                onClick={() => onOpenSeatingPlaceholder(bucket)}
                title="Редактор рассадки будет добавлен отдельным PR"
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
                  : "Без лимита"
              }
              secondaryLabel={
                bucket.effectiveFreePercent !== null && bucket.effectiveRemainingSeats !== null
                  ? `${bucket.effectiveRemainingSeats} (${bucket.effectiveFreePercent}%) свободно`
                  : null
              }
            />

            <div className="registration-capacity-bucket-row__meta">
              <span>Лимит: {capacityLabel}</span>
              <span>{bucket.reservationsCount} резерв.</span>
              {bucket.usesFallbackCapacity ? (
                <span>лимит взят из выбранной даты/события</span>
              ) : null}
            </div>

            <BucketBreakdown bucket={bucket} />
          </div>
        );
      })}
    </div>
  );
}

function BucketBreakdown({ bucket }: { bucket: CapacityBucketView }) {
  const [view, setView] = useState<BucketBreakdownView>("list");
  const { entries, note, summary } = buildBucketBreakdown(bucket);
  const chartGradient = buildBucketBreakdownGradient(entries);
  const canShowChart = chartGradient !== null;
  const activeView = canShowChart ? view : "list";

  return (
    <div className="bucket-breakdown">
      <div className="bucket-breakdown__label">
        <span>Из чего сложилось</span>
        <span className="bucket-breakdown__summary">{summary}</span>
        {canShowChart ? (
          <button
            aria-label={
              activeView === "list"
                ? "Показать breakdown диаграммой"
                : "Показать breakdown списком"
            }
            className="bd-toggle"
            onClick={() =>
              setView((currentView) => (currentView === "list" ? "chart" : "list"))
            }
            title={activeView === "list" ? "Диаграмма" : "Список"}
            type="button"
          >
            <span aria-hidden="true">{activeView === "list" ? "◔" : "☰"}</span>
          </button>
        ) : null}
      </div>

      {entries.length === 0 ? (
        <p className="bucket-breakdown__empty">
          В analytics RPC нет breakdown по вариантам для этого слота.
        </p>
      ) : activeView === "chart" && chartGradient ? (
        <BucketBreakdownChart entries={entries} gradient={chartGradient} />
      ) : (
        <BucketBreakdownList entries={entries} />
      )}

      {note ? <p className="bucket-breakdown__note">{note}</p> : null}
    </div>
  );
}

function BucketBreakdownList({ entries }: { entries: BucketBreakdownEntry[] }) {
  return (
    <div className="bucket-breakdown__list">
      {entries.map((entry) => (
        <div
          className={`brow${entry.isFree ? " brow--free" : ""}${
            entry.isNonSeat ? " brow--muted" : ""
          }`}
          key={entry.key}
        >
          <span
            aria-hidden="true"
            className="brow__dot"
            style={{ backgroundColor: entry.color }}
          />
          <span className="brow__name">
            <strong>{entry.title}</strong>
            <span>{entry.detail}</span>
            {entry.marker ? <em>{entry.marker}</em> : null}
          </span>
          <span className="brow__val">
            {entry.valueLabel}
            <small>{entry.percentLabel}</small>
          </span>
          <span className="brow__bar" aria-hidden="true">
            <span
              style={{ backgroundColor: entry.color, width: `${entry.barPercent}%` }}
            />
          </span>
        </div>
      ))}
    </div>
  );
}

function BucketBreakdownChart({
  entries,
  gradient,
}: {
  entries: BucketBreakdownEntry[];
  gradient: string;
}) {
  return (
    <div className="bd-pie">
      <div
        aria-label="Диаграмма занятых и свободных мест слота"
        className="bd-pie__chart"
        role="img"
        style={{ background: gradient }}
      />
      <div className="bd-pie__legend">
        {entries.map((entry) => (
          <span
            className={`bd-leg${entry.isNonSeat ? " bd-leg--muted" : ""}`}
            key={entry.key}
          >
            <i aria-hidden="true" style={{ backgroundColor: entry.color }} />
            <span>{entry.marker ? `${entry.title} · ${entry.marker}` : entry.title}</span>
            <b>{entry.valueLabel}</b>
            <span className="pct">{entry.percentLabel}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function renderOptions({
  analyticsError,
  analyticsLoading,
  optionStats,
}: {
  analyticsError: string | null;
  analyticsLoading: boolean;
  optionStats: AdminRegistrationCapacityOptionStat[];
}) {
  if (analyticsLoading && optionStats.length === 0) {
    return renderSoftState("Загружаем варианты участия...");
  }

  if (analyticsError && optionStats.length === 0) {
    return renderSoftState(
      "Не удалось загрузить варианты участия.",
      analyticsError,
      true,
    );
  }

  if (optionStats.length === 0) {
    return renderSoftState(
      "В загруженных заявках нет выбранных вариантов участия.",
    );
  }

  return (
    <>
      <div className="registration-capacity-options">
        {optionStats.map((option) => {
          const doesNotOccupySeats =
            option.isDonation || option.countsTowardCapacity === false;

          return (
            <div
              className={`registration-capacity-option-row${
                doesNotOccupySeats ? " registration-capacity-option-row--muted" : ""
              }`}
              key={getCapacityOptionKey(option)}
            >
              <div>
                <strong>{option.title}</strong>
                {option.isDonation ? <span>донат</span> : null}
                {doesNotOccupySeats ? <span>не занимает место</span> : null}
              </div>
              <span>
                {option.registrationsCount} заявок / {option.quantity} шт.
              </span>
              <span>{doesNotOccupySeats ? "не занимает место" : `${option.seatsCount} мест`}</span>
            </div>
          );
        })}
      </div>
      <p className="registration-capacity-helper">
        Занятость мест берётся из analytics RPC и capacity reservations; донаты и варианты
        без capacity не смешиваются с местами без маркировки.
      </p>
    </>
  );
}

function renderGuests({
  analytics,
  analyticsError,
  analyticsLoading,
}: {
  analytics: AdminRegistrationCapacityAnalytics | null;
  analyticsError: string | null;
  analyticsLoading: boolean;
}) {
  if (analyticsLoading && !analytics) {
    return renderSoftState("Загружаем гостей и донаты...");
  }

  if (analyticsError && !analytics) {
    return renderSoftState(
      "Не удалось загрузить гостей и донаты.",
      analyticsError,
      true,
    );
  }

  if (!analytics) {
    return renderSoftState("Данные по уникальным гостям пока не найдены.");
  }

  const totals = analytics.totals;
  const donationOptions = analytics.donationOptions;
  const donationCount = totals.sponsorsDonationsCount || totals.donationsCount;

  return (
    <>
      <div className="registration-capacity-stats">
        <CapacityStat
          hint="Уникальные зарегистрированные участники и гости"
          label="Уникальные люди"
          value={formatNumber(totals.uniquePeopleCount)}
        />
        <CapacityStat
          hint="Гости без дублей по имени в активных заявках"
          label="Уникальные гости"
          value={formatNumber(totals.uniqueGuestsCount)}
        />
        <CapacityStat
          hint="Гости, которые занимают места в нескольких слотах"
          label="Гости в нескольких слотах"
          value={formatNumber(totals.multiMealGuestsCount)}
        />
        <CapacityStat
          hint={`${totals.donationQuantity} шт. / ${totals.donationRegistrationsCount} заявок`}
          label="Спонсоры/донаты"
          value={formatNumber(donationCount)}
        />
        <CapacityStat
          hint="Активные места в выбранной дате"
          label="Занято мест"
          value={formatNumber(totals.activeSeatsCount)}
        />
      </div>

      {donationOptions.length > 0 ? (
        <div className="registration-capacity-options">
          {donationOptions.map((option) => (
            <div
              className="registration-capacity-option-row registration-capacity-option-row--muted"
              key={getCapacityOptionKey(option)}
            >
              <div>
                <strong>{option.title}</strong>
                <span>донат</span>
                <span>не занимает место</span>
              </div>
              <span>
                {option.registrationsCount} заявок / {option.quantity} шт.
              </span>
              <span>не занимает место</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="registration-capacity-helper">
          Донаты или спонсорские варианты в выбранной дате не найдены.
        </p>
      )}
    </>
  );
}

function CapacityStat({
  hint,
  label,
  value,
}: {
  hint: string;
  label: string;
  value: string;
}) {
  return (
    <div className="registration-capacity-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}

function renderSoftState(message: string, detail?: string, isError = false) {
  return (
    <div
      className={`registration-capacity-soft-state${
        isError ? " registration-capacity-soft-state--error" : ""
      }`}
    >
      <strong>{message}</strong>
      {detail ? <span>{detail}</span> : null}
    </div>
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
): CapacityBucketView {
  const effectiveCapacity = normalizeCapacity(
    bucket.effectiveCapacity !== undefined ? bucket.effectiveCapacity : bucket.capacity,
  );
  const effectiveRemainingSeats =
    bucket.effectiveRemainingSeats !== undefined
      ? normalizeCapacity(bucket.effectiveRemainingSeats)
      : bucket.remainingSeats !== null
        ? normalizeCapacity(bucket.remainingSeats)
        : bucket.freeSeats !== undefined
          ? normalizeCapacity(bucket.freeSeats)
          : null;

  return {
    ...bucket,
    effectiveCapacity,
    effectiveRemainingSeats,
    effectiveFillPercent: normalizePercent(
      bucket.effectiveFillPercent !== undefined
        ? bucket.effectiveFillPercent
        : bucket.fillPercent,
    ),
    effectiveFreePercent: normalizePercent(bucket.effectiveFreePercent ?? null),
    usesFallbackCapacity: bucket.usesFallbackCapacity ?? false,
  };
}

function buildQuickPills({
  bucketAggregate,
  bucketViews,
  totals,
}: {
  bucketAggregate: AdminRegistrationCapacityBucketAggregate | null;
  bucketViews: CapacityBucketView[];
  totals: AdminRegistrationCapacityTotals;
}): CapacityQuickPill[] {
  const bucketPills = bucketViews.map((bucket) => {
    const fillPercent = normalizePercent(bucket.effectiveFillPercent);
    const capacity = bucket.effectiveCapacity;
    const value =
      capacity !== null ? `${bucket.occupiedSeats}/${capacity}` : `${bucket.occupiedSeats}`;
    const detail =
      capacity !== null
        ? `${formatRemainingSeats(bucket.effectiveRemainingSeats)} · ${formatPercent(fillPercent)}`
        : "без лимита";

    return {
      key: bucket.capacityUnitId,
      title: bucket.title || bucket.key || "Слот мест",
      value,
      detail,
      fillPercent,
      tone:
        fillPercent !== null && fillPercent >= HOT_FILL_PERCENT
          ? "hot"
          : ("default" as CapacityPillTone),
    };
  });

  const totalPill =
    bucketViews.length === 0
      ? [
          {
            key: "total-seats",
            title: "Занято мест",
            value:
              totals.capacity !== null
                ? `${totals.activeSeatsCount}/${totals.capacity}`
                : `${totals.activeSeatsCount}`,
            detail:
              totals.capacity !== null
                ? `${formatRemainingSeats(totals.remainingSeats)} · ${formatPercent(
                    totals.fillPercent,
                  )}`
                : "без лимита",
            fillPercent: normalizePercent(totals.fillPercent),
            tone:
              totals.fillPercent !== null && totals.fillPercent >= HOT_FILL_PERCENT
                ? "hot"
                : ("default" as CapacityPillTone),
          },
        ]
      : [
          {
            key: "bucket-total",
            title: "Все слоты",
            value: buildBucketTotalValue(bucketAggregate),
            detail: bucketAggregate?.hasUnlimitedBuckets
              ? "есть слоты без лимита"
              : `${formatRemainingSeats(bucketAggregate?.remainingSeats ?? null)} · ${formatPercent(
                  bucketAggregate?.fillPercent ?? null,
                )}`,
            fillPercent: normalizePercent(bucketAggregate?.fillPercent ?? null),
            tone:
              bucketAggregate?.fillPercent !== null &&
              bucketAggregate?.fillPercent !== undefined &&
              bucketAggregate.fillPercent >= HOT_FILL_PERCENT
                ? "hot"
                : ("default" as CapacityPillTone),
          },
        ];

  return [
    ...bucketPills,
    ...totalPill,
    {
      key: "unique-guests",
      title: "Уникальные гости",
      value: formatNumber(totals.uniquePeopleCount),
      detail: `${totals.uniqueGuestsCount} гостей`,
      fillPercent: null,
      tone: "info",
    },
    {
      key: "multi-meal-guests",
      title: "Несколько слотов",
      value: formatNumber(totals.multiMealGuestsCount),
      detail: "гости в нескольких слотах",
      fillPercent: null,
      tone: "gold",
    },
  ];
}

function buildBucketAggregateSummary(
  aggregate: AdminRegistrationCapacityBucketAggregate | null,
) {
  if (!aggregate) {
    return {
      occupiedLabel: "0 мест",
      scopeHint: "Слоты мест пока не найдены",
      fillPercent: null,
      fillLabel: "Нет данных по лимиту",
      secondaryLabel: null,
      remainingLabel: "нет данных",
      capacityLabel: "Вместимость не найдена",
      note: null,
    };
  }

  if (aggregate.hasUnlimitedBuckets) {
    const hasKnownCapacity = aggregate.knownCapacity > 0;

    return {
      occupiedLabel: `${aggregate.occupiedSeats} мест`,
      scopeHint: hasKnownCapacity
        ? `${aggregate.knownCapacity} мест в слотах с лимитом`
        : "Все слоты без лимита",
      fillPercent: hasKnownCapacity ? normalizePercent(aggregate.fillPercent) : null,
      fillLabel:
        hasKnownCapacity && aggregate.fillPercent !== null
          ? `${aggregate.fillPercent}% заполнено в слотах с лимитом`
          : "Общий лимит: без лимита",
      secondaryLabel: hasKnownCapacity
        ? `${aggregate.remainingSeats} свободно в слотах с лимитом`
        : null,
      remainingLabel: hasKnownCapacity
        ? `${aggregate.remainingSeats} с лимитом`
        : "без лимита",
      capacityLabel: hasKnownCapacity
        ? `${aggregate.knownCapacity} мест с лимитом + без лимита`
        : "Общая вместимость: без лимита",
      note: "Есть слоты без лимита, поэтому общий процент считается только по слотам с заданным лимитом.",
    };
  }

  return {
    occupiedLabel:
      aggregate.knownCapacity > 0
        ? `${aggregate.occupiedSeats} из ${aggregate.knownCapacity} мест`
        : `${aggregate.occupiedSeats} мест`,
    scopeHint:
      aggregate.limitedBucketCount > 0
        ? `По ${aggregate.limitedBucketCount} слотам с лимитом`
        : "Лимит мест не задан",
    fillPercent: normalizePercent(aggregate.fillPercent),
    fillLabel:
      aggregate.fillPercent !== null
        ? `${aggregate.fillPercent}% заполнено`
        : "Общий лимит: без лимита",
    secondaryLabel:
      aggregate.freePercent !== null
        ? `${aggregate.remainingSeats} (${aggregate.freePercent}%) свободно`
        : null,
    remainingLabel:
      aggregate.knownCapacity > 0 ? `${aggregate.remainingSeats}` : "без лимита",
    capacityLabel:
      aggregate.knownCapacity > 0
        ? `Общая вместимость: ${aggregate.knownCapacity}`
        : "Общая вместимость: без лимита",
    note: null,
  };
}

function buildTotalsSummary(totals: AdminRegistrationCapacityTotals) {
  const hasCapacity = totals.capacity !== null;

  return {
    occupiedLabel: hasCapacity
      ? `${totals.activeSeatsCount} из ${totals.capacity} мест`
      : `${totals.activeSeatsCount} мест`,
    scopeHint: "По активным заявкам выбранной даты",
    fillPercent: normalizePercent(totals.fillPercent),
    fillLabel:
      totals.fillPercent !== null
        ? `${totals.fillPercent}% заполнено`
        : "Общий лимит: без лимита",
    secondaryLabel:
      totals.freePercent !== null && totals.remainingSeats !== null
        ? `${totals.remainingSeats} (${totals.freePercent}%) свободно`
        : null,
    remainingLabel:
      totals.remainingSeats !== null ? `${totals.remainingSeats}` : "без лимита",
    capacityLabel: hasCapacity
      ? `Общая вместимость: ${totals.capacity}`
      : "Общая вместимость: без лимита",
    note: null,
  };
}

function buildBucketTotalValue(
  aggregate: AdminRegistrationCapacityBucketAggregate | null,
): string {
  if (!aggregate) {
    return "0";
  }

  if (aggregate.knownCapacity > 0 && !aggregate.hasUnlimitedBuckets) {
    return `${aggregate.occupiedSeats}/${aggregate.knownCapacity}`;
  }

  return `${aggregate.occupiedSeats}`;
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
  const safeFillPercent = normalizePercent(fillPercent);

  return (
    <div className="registration-capacity-meter">
      <div
        aria-valuemax={safeFillPercent !== null ? 100 : undefined}
        aria-valuemin={safeFillPercent !== null ? 0 : undefined}
        aria-valuenow={safeFillPercent ?? undefined}
        className="registration-capacity-meter__track"
        role={safeFillPercent !== null ? "progressbar" : undefined}
      >
        <span style={{ width: `${safeFillPercent ?? 0}%` }} />
      </div>
      <div className="registration-capacity-meter__labels">
        <span>{label}</span>
        {secondaryLabel ? <span>{secondaryLabel}</span> : null}
      </div>
    </div>
  );
}

function normalizeCapacity(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, value);
}

function normalizePercent(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatCapacityLimit(capacity: number | null): string {
  return capacity !== null ? `${capacity} мест` : "без лимита";
}

function formatRemainingSeats(remainingSeats: number | null): string {
  return remainingSeats !== null ? `${remainingSeats} свободно` : "без лимита";
}

function formatPercent(fillPercent: number | null): string {
  return fillPercent !== null ? `${fillPercent}%` : "без лимита";
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
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

function buildBucketBreakdown(bucket: CapacityBucketView): {
  entries: BucketBreakdownEntry[];
  note: string | null;
  summary: string;
} {
  const occupiedSeats = Math.max(0, bucket.occupiedSeats);
  const remainingSeats = bucket.effectiveRemainingSeats;
  const optionBreakdown = bucket.optionBreakdown ?? [];
  const seatedBreakdownSeats = optionBreakdown.reduce((total, option) => {
    if (option.isDonation || option.countsTowardCapacity === false) {
      return total;
    }

    return total + Math.max(0, option.seatsCount);
  }, 0);
  const entries = optionBreakdown.map((option, index) =>
    buildBucketOptionBreakdownEntry(option, index, occupiedSeats),
  );

  if (seatedBreakdownSeats < occupiedSeats) {
    entries.push(
      buildBucketFallbackOccupiedEntry(occupiedSeats - seatedBreakdownSeats, occupiedSeats),
    );
  }

  if (remainingSeats !== null) {
    entries.push(buildBucketFreeEntry(bucket));
  }

  const summary = formatBucketBreakdownSummary(bucket);
  const note =
    optionBreakdown.length === 0
      ? bucket.optionTitles.length > 0
        ? `RPC не вернул option breakdown; варианты слота: ${bucket.optionTitles.join(", ")}.`
        : "RPC не вернул option breakdown для этого слота."
      : null;

  return {
    entries,
    note,
    summary,
  };
}

function buildBucketOptionBreakdownEntry(
  option: AdminRegistrationCapacityBucketOptionBreakdown,
  index: number,
  occupiedSeats: number,
): BucketBreakdownEntry {
  const isNonSeat = option.isDonation || option.countsTowardCapacity === false;
  const seatsCount = isNonSeat ? 0 : Math.max(0, option.seatsCount);
  const contributionPercent =
    isNonSeat || occupiedSeats > 0
      ? normalizePercent(occupiedSeats > 0 ? (seatsCount / occupiedSeats) * 100 : 0)
      : null;
  const marker = option.isDonation
    ? "донат · не занимает место"
    : option.countsTowardCapacity === false
      ? "не занимает место"
      : null;
  const color = isNonSeat
    ? BUCKET_BREAKDOWN_NON_SEAT_COLOR
    : BUCKET_BREAKDOWN_COLORS[index % BUCKET_BREAKDOWN_COLORS.length];

  return {
    key: `${getCapacityBucketOptionKey(option)}|${index}`,
    title: option.title,
    detail: `${formatNumber(option.registrationsCount)} заявок / ${formatNumber(
      option.quantity,
    )} шт.`,
    marker,
    valueLabel: isNonSeat ? "0 мест" : `${formatNumber(seatsCount)} мест`,
    percentLabel: formatContributionPercent(contributionPercent),
    barPercent: contributionPercent ?? 0,
    chartValue: seatsCount,
    color,
    isFree: false,
    isNonSeat,
  };
}

function buildBucketFallbackOccupiedEntry(
  seatsCount: number,
  occupiedSeats: number,
): BucketBreakdownEntry {
  const contributionPercent =
    occupiedSeats > 0 ? normalizePercent((seatsCount / occupiedSeats) * 100) : null;

  return {
    key: "unmatched-occupied",
    title: "Места без детализации",
    detail: "есть в занятости слота, но без option breakdown",
    marker: null,
    valueLabel: `${formatNumber(seatsCount)} мест`,
    percentLabel: formatContributionPercent(contributionPercent),
    barPercent: contributionPercent ?? 0,
    chartValue: seatsCount,
    color: "rgba(255, 255, 255, 0.42)",
    isFree: false,
    isNonSeat: false,
  };
}

function buildBucketFreeEntry(bucket: CapacityBucketView): BucketBreakdownEntry {
  const remainingSeats = bucket.effectiveRemainingSeats ?? 0;
  const freePercent =
    bucket.effectiveFreePercent ??
    (bucket.effectiveCapacity !== null && bucket.effectiveCapacity > 0
      ? normalizePercent((remainingSeats / bucket.effectiveCapacity) * 100)
      : null);

  return {
    key: "free-seats",
    title: "Свободно",
    detail:
      bucket.effectiveCapacity !== null
        ? `из лимита ${formatNumber(bucket.effectiveCapacity)} мест`
        : "лимит не задан",
    marker: null,
    valueLabel: `${formatNumber(remainingSeats)} мест`,
    percentLabel: freePercent !== null ? `${freePercent}% свободно` : "без лимита",
    barPercent: freePercent ?? 0,
    chartValue: bucket.effectiveCapacity !== null ? remainingSeats : 0,
    color: BUCKET_BREAKDOWN_FREE_COLOR,
    isFree: true,
    isNonSeat: false,
  };
}

function formatBucketBreakdownSummary(bucket: CapacityBucketView): string {
  const occupiedLabel =
    bucket.effectiveCapacity !== null
      ? `Занято ${formatNumber(bucket.occupiedSeats)} из ${formatNumber(
          bucket.effectiveCapacity,
        )}`
      : `Занято ${formatNumber(bucket.occupiedSeats)}`;
  const fillLabel =
    bucket.effectiveFillPercent !== null
      ? `${bucket.effectiveFillPercent}% заполнено`
      : "без лимита";
  const freeLabel =
    bucket.effectiveRemainingSeats !== null
      ? `${formatNumber(bucket.effectiveRemainingSeats)} свободно`
      : "без лимита";

  return `${occupiedLabel} · ${fillLabel} · ${freeLabel}`;
}

function formatContributionPercent(percent: number | null): string {
  return percent !== null ? `${percent}%` : "нет занятых мест";
}

function buildBucketBreakdownGradient(entries: BucketBreakdownEntry[]): string | null {
  const chartEntries = entries.filter((entry) => entry.chartValue > 0);
  const total = chartEntries.reduce((sum, entry) => sum + entry.chartValue, 0);

  if (total <= 0) {
    return null;
  }

  let cursor = 0;
  const segments = chartEntries.map((entry) => {
    const start = cursor;
    const end = cursor + (entry.chartValue / total) * 360;
    cursor = end;

    return `${entry.color} ${start.toFixed(2)}deg ${end.toFixed(2)}deg`;
  });

  return `conic-gradient(${segments.join(", ")})`;
}

function getCapacityBucketOptionKey(
  option: AdminRegistrationCapacityBucketOptionBreakdown,
): string {
  return [
    option.optionId ?? option.title,
    option.isDonation ? "donation" : "seat",
    option.countsTowardCapacity ? "capacity" : "no-capacity",
  ].join("|");
}
