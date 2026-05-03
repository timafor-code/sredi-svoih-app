import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { GlassCard } from "../components/ui/GlassCard";
import { listImportItemsNeedingReview } from "../services/adminImportReviewService";
import type { AdminBadgeTone } from "../types/admin";
import type {
  AdminImportDateQuality,
  AdminImportItemStatus,
  AdminImportReviewItem,
  JsonValue,
} from "../types/importReview";

type DateQualityFilter = "all" | AdminImportDateQuality;
type StatusFilter = "all" | AdminImportItemStatus;
type ReviewLimit = 50 | 100;

const DATE_QUALITY_FILTERS: Array<{ value: DateQualityFilter; label: string }> = [
  { value: "all", label: "Все" },
  { value: "confident", label: "confident" },
  { value: "partial", label: "partial" },
  { value: "recurring_rule", label: "recurring_rule" },
  { value: "none", label: "none" },
];

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Все" },
  { value: "new", label: "new" },
  { value: "linked", label: "linked" },
  { value: "ignored", label: "ignored" },
  { value: "error", label: "error" },
];

const REVIEW_LIMITS: ReviewLimit[] = [50, 100];

type ImportReviewPageProps = {
  refreshSignal?: number;
};

export function ImportReviewPage({ refreshSignal = 0 }: ImportReviewPageProps) {
  const [items, setItems] = useState<AdminImportReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [dateQualityFilter, setDateQualityFilter] = useState<DateQualityFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [limit, setLimit] = useState<ReviewLimit>(50);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const nextItems = await listImportItemsNeedingReview(limit);
      setItems(nextItems);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Не удалось загрузить import items из Supabase.",
      );
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    void loadItems();
  }, [loadItems, refreshSignal]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ru");

    return items.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) {
        return false;
      }

      if (dateQualityFilter !== "all") {
        const dateQuality = getDateQuality(item);

        if (dateQualityFilter === "none") {
          if (dateQuality && dateQuality !== "none") {
            return false;
          }
        } else if (dateQuality !== dateQualityFilter) {
          return false;
        }
      }

      if (!normalizedQuery) {
        return true;
      }

      const searchableText = [
        item.parsedTitle,
        item.sourceUrl,
        item.parsedLocation,
        item.importReview?.reason,
        item.importReview?.rawDateText,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("ru");

      return searchableText.includes(normalizedQuery);
    });
  }, [dateQualityFilter, items, query, statusFilter]);

  const hasActiveFilters =
    query.trim().length > 0 || dateQualityFilter !== "all" || statusFilter !== "all";

  return (
    <div className="page-stack page-stack--import">
      <section className="page-header">
        <Badge tone="red">read-only</Badge>
        <h1>Импорт с сайта</h1>
        <p>
          Проверка импорта. Публикация и игнорирование будут добавлены отдельным PR. Запуск
          импорта из админки будет добавлен отдельным backend PR.
        </p>
      </section>

      <GlassCard className="import-notice">
        <Badge tone="gold">human review</Badge>
        <div>
          <h2>Очередь ручной проверки</h2>
          <p>
            Список читается через RPC `admin_list_import_items_needing_review` с текущей
            Supabase-сессией. Действий publish, ignore и edit на этой странице нет.
            Сейчас для локальной проверки запустите importer из PowerShell, затем нажмите
            «Обновить очередь».
          </p>
        </div>
      </GlassCard>

      <GlassCard className="events-toolbar import-review-toolbar">
        <div className="events-toolbar__top">
          <div>
            <h2>Фильтры</h2>
            <p>Поиск работает по названию, ссылке источника, месту и заметкам парсера.</p>
          </div>
          <Button disabled={loading} onClick={loadItems}>
            {loading ? "Обновляем..." : "Обновить очередь"}
          </Button>
        </div>

        <div className="events-filters import-review-filters" aria-label="Фильтры импорта">
          <label className="filter-field">
            <span>Поиск</span>
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Название, ссылка, место"
              type="search"
              value={query}
            />
          </label>

          <label className="filter-field">
            <span>Date quality</span>
            <select
              onChange={(event) =>
                setDateQualityFilter(event.target.value as DateQualityFilter)
              }
              value={dateQualityFilter}
            >
              {DATE_QUALITY_FILTERS.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
          </label>

          <label className="filter-field">
            <span>Статус</span>
            <select
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              value={statusFilter}
            >
              {STATUS_FILTERS.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
          </label>

          <label className="filter-field">
            <span>Limit</span>
            <select
              onChange={(event) => setLimit(Number(event.target.value) as ReviewLimit)}
              value={limit}
            >
              {REVIEW_LIMITS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>
      </GlassCard>

      <GlassCard className="table-panel import-review-panel" elevated>
        <div className="table-panel__header">
          <h2>Items на проверку</h2>
          <div className="events-summary">
            <span>
              Показано {filteredItems.length} из {items.length}
            </span>
            <Badge tone="glass">Supabase RPC</Badge>
          </div>
        </div>

        {loading ? (
          <ImportReviewState
            description="Вызываем admin_list_import_items_needing_review и ждём ответ Supabase."
            title="Загрузка import items"
          />
        ) : error ? (
          <ImportReviewState description={error} title="Не удалось загрузить импорт">
            <Button onClick={loadItems} variant="primary">
              Повторить
            </Button>
          </ImportReviewState>
        ) : filteredItems.length === 0 ? (
          <ImportReviewState
            description={
              items.length === 0
                ? "RPC вернул пустой список. Это может означать, что сейчас нет items на ручную проверку или backend не возвращает доступные записи для текущей роли."
                : "Измените поисковый запрос или фильтры."
            }
            title={items.length === 0 ? "Очередь проверки пуста" : "Нет совпадений"}
          >
            {hasActiveFilters ? (
              <Button
                onClick={() => {
                  setQuery("");
                  setDateQualityFilter("all");
                  setStatusFilter("all");
                }}
              >
                Сбросить фильтры
              </Button>
            ) : null}
          </ImportReviewState>
        ) : (
          <ImportReviewList items={filteredItems} />
        )}
      </GlassCard>
    </div>
  );
}

function ImportReviewList({ items }: { items: AdminImportReviewItem[] }) {
  return (
    <div className="import-review-list" aria-label="Import items needing review">
      {items.map((item) => (
        <article className="import-review-item" key={item.id}>
          <div className="import-review-item__head">
            <div className="import-review-item__title">
              <div className="badge-row">
                <Badge tone={getStatusTone(item.status)}>{item.status ?? "unknown"}</Badge>
                <Badge tone={getDateQualityTone(getDateQuality(item))}>
                  {getDateQuality(item) ?? "date quality unknown"}
                </Badge>
                {item.linkedEventId ? <Badge tone="green">linked</Badge> : null}
              </div>
              <h3>{item.parsedTitle || "Без названия"}</h3>
            </div>
            <div className="import-review-item__created">
              <span>created_at</span>
              <strong>{formatDateTime(item.createdAt)}</strong>
            </div>
          </div>

          <div className="import-review-grid">
            <ImportReviewField label="Parsed date" value={formatDateTime(item.parsedStartsAt)} />
            <ImportReviewField label="Location" value={item.parsedLocation || "Не указано"} />
            <ImportReviewField label="Reason / notes" value={getReviewNotes(item)} wide />
            <ImportReviewField label="Source URL" wide>
              {item.sourceUrl ? (
                <a
                  className="import-review-link"
                  href={item.sourceUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  {item.sourceUrl}
                </a>
              ) : (
                "Не указано"
              )}
            </ImportReviewField>
          </div>

          <details className="import-review-meta">
            <summary>Raw/import metadata</summary>
            <div className="import-review-meta__grid">
              <MetadataPair label="id" value={item.id} />
              <MetadataPair label="source_id" value={item.sourceId} />
              <MetadataPair label="run_id" value={item.runId} />
              <MetadataPair label="external_id" value={item.externalId} />
              <MetadataPair label="source_name" value={item.sourceName} />
              <MetadataPair label="community_id" value={item.communityId} />
              <MetadataPair label="linked_event_id" value={item.linkedEventId} />
              <MetadataPair label="parserVersion" value={item.importReview?.parserVersion ?? null} />
              <MetadataPair label="rawDateText" value={item.importReview?.rawDateText ?? null} />
              <MetadataPair label="rawTimeText" value={item.importReview?.rawTimeText ?? null} />
              <MetadataPair
                label="suggestedStartsAt"
                value={item.importReview?.suggestedStartsAt ?? null}
              />
              <MetadataPair
                label="assumedYear"
                value={
                  item.importReview?.assumedYear === null ||
                  item.importReview?.assumedYear === undefined
                    ? null
                    : String(item.importReview.assumedYear)
                }
              />
            </div>
            <pre>{formatRawPayloadPreview(item.rawPayload)}</pre>
          </details>
        </article>
      ))}
    </div>
  );
}

function ImportReviewField({
  children,
  label,
  value,
  wide = false,
}: {
  children?: ReactNode;
  label: string;
  value?: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "import-review-field import-review-field--wide" : "import-review-field"}>
      <span>{label}</span>
      <strong>{children ?? value ?? "Не указано"}</strong>
    </div>
  );
}

function MetadataPair({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <span>{label}</span>
      <code>{value || "null"}</code>
    </div>
  );
}

function ImportReviewState({
  children,
  description,
  title,
}: {
  children?: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <div className="events-state" role="status">
      <h3>{title}</h3>
      <p>{description}</p>
      {children ? <div className="events-state__actions">{children}</div> : null}
    </div>
  );
}

function getDateQuality(item: AdminImportReviewItem): string | null {
  return item.importReview?.dateConfidence ?? null;
}

function getReviewNotes(item: AdminImportReviewItem): string {
  const review = item.importReview;
  const notes = [review?.reason, review?.notes, review?.draftSkipReason]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ");

  return notes || "Не указано";
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "Не указано";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatRawPayloadPreview(value: JsonValue): string {
  try {
    const serialized = JSON.stringify(value, null, 2);
    return serialized.length > 1400 ? `${serialized.slice(0, 1400)}\n...` : serialized;
  } catch {
    return "Не удалось отобразить raw_payload.";
  }
}

function getStatusTone(status: string | null): AdminBadgeTone {
  if (status === "linked") {
    return "green";
  }

  if (status === "new") {
    return "gold";
  }

  if (status === "error") {
    return "red";
  }

  return "muted";
}

function getDateQualityTone(dateQuality: string | null): AdminBadgeTone {
  if (dateQuality === "confident") {
    return "green";
  }

  if (dateQuality === "partial") {
    return "gold";
  }

  if (dateQuality === "recurring_rule") {
    return "blue";
  }

  if (dateQuality === "none") {
    return "red";
  }

  return "muted";
}
