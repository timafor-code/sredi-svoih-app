import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";

import { EventForm } from "../components/events/EventForm";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { GlassCard } from "../components/ui/GlassCard";
import {
  getImportItem,
  ignoreImportItem,
  listImportItemsNeedingReview,
  publishImportItemAsDraft,
} from "../services/adminImportReviewService";
import type { AdminBadgeTone } from "../types/admin";
import type { AdminEvent, AdminEventMutationInput } from "../types/events";
import type {
  AdminImportDateQuality,
  AdminImportItemStatus,
  AdminPublishImportItemResult,
  AdminImportReviewItem,
  JsonObject,
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
  onEventCreated?: (event: AdminEvent) => void;
  onOpenEvent?: (event: AdminEvent) => void;
  onOpenEventsList?: () => void;
  refreshSignal?: number;
};

export function ImportReviewPage({
  onEventCreated,
  onOpenEvent,
  onOpenEventsList,
  refreshSignal = 0,
}: ImportReviewPageProps) {
  const [items, setItems] = useState<AdminImportReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [dateQualityFilter, setDateQualityFilter] = useState<DateQualityFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [limit, setLimit] = useState<ReviewLimit>(50);
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const [detailItem, setDetailItem] = useState<AdminImportReviewItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailReloadSignal, setDetailReloadSignal] = useState(0);

  const loadItems = useCallback(async (): Promise<boolean> => {
    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const nextItems = await listImportItemsNeedingReview(limit);
      setItems(nextItems);
      return true;
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Не удалось загрузить import items из Supabase.",
      );
      return false;
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    void loadItems();
  }, [loadItems, refreshSignal]);

  useEffect(() => {
    if (!detailItemId) {
      return;
    }

    let isCancelled = false;

    setDetailLoading(true);
    setDetailError(null);
    setDetailItem(null);

    getImportItem(detailItemId)
      .then((nextItem) => {
        if (!isCancelled) {
          setDetailItem(nextItem);
        }
      })
      .catch((nextError) => {
        if (!isCancelled) {
          setDetailError(
            nextError instanceof Error
              ? nextError.message
              : "Не удалось загрузить import item через admin_get_import_item.",
          );
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setDetailLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [detailItemId, detailReloadSignal]);

  const handleOpenDetail = useCallback((itemId: string) => {
    setSuccessMessage(null);
    setDetailItemId(itemId);
    setDetailReloadSignal((current) => current + 1);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setDetailItemId(null);
    setDetailItem(null);
    setDetailError(null);
  }, []);

  const handleRetryDetail = useCallback(() => {
    setDetailReloadSignal((current) => current + 1);
  }, []);

  const handleImportItemIgnored = useCallback(
    async (ignoredItem: AdminImportReviewItem) => {
      const ignoredTitle = getImportItemTitle(ignoredItem);

      handleCloseDetail();
      const reloaded = await loadItems();

      setSuccessMessage(
        reloaded
          ? `Import item «${ignoredTitle}» проигнорирован и скрыт из очереди проверки.`
          : `Import item «${ignoredTitle}» проигнорирован. Очередь не обновилась, попробуйте «Обновить очередь».`,
      );
    },
    [handleCloseDetail, loadItems],
  );

  const handleImportDraftCreated = useCallback(
    async (
      sourceItem: AdminImportReviewItem,
      result: AdminPublishImportItemResult,
    ) => {
      const linkedEventId = result.event?.id ?? result.linkedEventId;
      const eventTitle = result.event?.title ?? getImportItemTitle(sourceItem);

      if (result.event) {
        onEventCreated?.(result.event);
      }

      if (linkedEventId) {
        setDetailItem((current) =>
          current && current.id === sourceItem.id
            ? {
                ...current,
                linkedEventId,
                status: "linked",
              }
            : current,
        );
      }

      const reloaded = await loadItems();

      setSuccessMessage(
        reloaded
          ? `Событие «${eventTitle}» создано как draft/hidden через admin_publish_import_item. Import item обновлён в очереди.`
          : `Событие «${eventTitle}» создано как draft/hidden. Очередь не обновилась, попробуйте «Обновить очередь».`,
      );
    },
    [loadItems, onEventCreated],
  );

  useEffect(() => {
    if (!detailItemId) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        handleCloseDetail();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [detailItemId, handleCloseDetail]);

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

  const selectedListItem = useMemo(() => {
    if (!detailItemId) {
      return null;
    }

    return items.find((item) => item.id === detailItemId) ?? null;
  }, [detailItemId, items]);

  return (
    <div className="page-stack page-stack--import">
      <section className="page-header">
        <Badge tone="gold">review queue</Badge>
        <h1>Импорт с сайта</h1>
        <p>
          Проверка импорта. Из detail можно проигнорировать item или создать
          событие-черновик через отдельные RPC; публикация и запуск импорта остаются
          вне этой страницы.
        </p>
      </section>

      <GlassCard className="import-notice">
        <Badge tone="gold">human review</Badge>
        <div>
          <h2>Очередь ручной проверки</h2>
          <p>
            Список читается через RPC `admin_list_import_items_needing_review` с текущей
            Supabase-сессией. В detail можно скрыть item из очереди через
            `admin_ignore_import_item` или создать скрытый черновик через
            `admin_publish_import_item`. Созданное событие не публикуется автоматически.
          </p>
        </div>
      </GlassCard>

      {successMessage ? (
        <div className="import-review-status import-review-status--success" role="status">
          {successMessage}
        </div>
      ) : null}

      <GlassCard className="events-toolbar import-review-toolbar">
        <div className="events-toolbar__top">
          <div>
            <h2>Фильтры</h2>
            <p>Поиск работает по названию, ссылке источника, месту и заметкам парсера.</p>
          </div>
          <Button disabled={loading} onClick={() => void loadItems()}>
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
            <Button onClick={() => void loadItems()} variant="primary">
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
          <ImportReviewList items={filteredItems} onOpenDetail={handleOpenDetail} />
        )}
      </GlassCard>

      {detailItemId ? (
        <ImportItemDetailDrawer
          error={detailError}
          fallbackItem={selectedListItem}
          item={detailItem}
          loading={detailLoading}
          onClose={handleCloseDetail}
          onDraftCreated={handleImportDraftCreated}
          onIgnored={handleImportItemIgnored}
          onOpenEvent={onOpenEvent}
          onOpenEventsList={onOpenEventsList}
          onRetry={handleRetryDetail}
        />
      ) : null}
    </div>
  );
}

function ImportReviewList({
  items,
  onOpenDetail,
}: {
  items: AdminImportReviewItem[];
  onOpenDetail: (itemId: string) => void;
}) {
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
            <div className="import-review-item__actions">
              <div className="import-review-item__created">
                <span>created_at</span>
                <strong>{formatDateTime(item.createdAt)}</strong>
              </div>
              <Button onClick={() => onOpenDetail(item.id)} size="sm" variant="secondary">
                Подробнее
              </Button>
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

function ImportItemDetailDrawer({
  error,
  fallbackItem,
  item,
  loading,
  onClose,
  onDraftCreated,
  onIgnored,
  onOpenEvent,
  onOpenEventsList,
  onRetry,
}: {
  error: string | null;
  fallbackItem: AdminImportReviewItem | null;
  item: AdminImportReviewItem | null;
  loading: boolean;
  onClose: () => void;
  onDraftCreated: (
    item: AdminImportReviewItem,
    result: AdminPublishImportItemResult,
  ) => Promise<void> | void;
  onIgnored: (item: AdminImportReviewItem) => Promise<void> | void;
  onOpenEvent?: (event: AdminEvent) => void;
  onOpenEventsList?: () => void;
  onRetry: () => void;
}) {
  const titleId = useId();
  const reasonId = useId();
  const [isConfirmingIgnore, setIsConfirmingIgnore] = useState(false);
  const [ignoreReason, setIgnoreReason] = useState("");
  const [ignoreLoading, setIgnoreLoading] = useState(false);
  const [ignoreError, setIgnoreError] = useState<string | null>(null);
  const [isCreatingDraft, setIsCreatingDraft] = useState(false);
  const [draftSubmitting, setDraftSubmitting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftResult, setDraftResult] = useState<AdminPublishImportItemResult | null>(null);
  const displayItem = item ?? fallbackItem;
  const title = displayItem ? getImportItemTitle(displayItem) : "Import item";
  const isAdminIgnored = displayItem ? isAdminIgnoredImportItem(displayItem) : false;
  const isSafeIgnoredByImporter =
    displayItem?.status === "ignored" && !isAdminIgnored;

  useEffect(() => {
    setIsConfirmingIgnore(false);
    setIgnoreReason("");
    setIgnoreError(null);
    setIgnoreLoading(false);
    setIsCreatingDraft(false);
    setDraftSubmitting(false);
    setDraftError(null);
    setDraftResult(null);
  }, [item?.id]);

  const handleStartIgnore = useCallback(() => {
    setIsConfirmingIgnore(true);
    setIgnoreError(null);
    setIsCreatingDraft(false);
    setDraftError(null);
  }, []);

  const handleCancelIgnore = useCallback(() => {
    setIsConfirmingIgnore(false);
    setIgnoreReason("");
    setIgnoreError(null);
  }, []);

  const handleStartCreateDraft = useCallback(() => {
    setIsConfirmingIgnore(false);
    setIgnoreError(null);
    setDraftError(null);
    setDraftResult(null);
    setIsCreatingDraft(true);
  }, []);

  const handleCancelCreateDraft = useCallback(() => {
    if (!draftSubmitting) {
      setIsCreatingDraft(false);
      setDraftError(null);
    }
  }, [draftSubmitting]);

  const handleSubmitCreateDraft = useCallback(
    async (input: AdminEventMutationInput) => {
      if (!item || draftSubmitting) {
        return false;
      }

      setDraftSubmitting(true);
      setDraftError(null);

      try {
        const result = await publishImportItemAsDraft(item.id, {
          ...input,
          status: "draft",
          visibility: "hidden",
          manualOverride: true,
        });

        setDraftResult(result);
        setIsCreatingDraft(false);
        await onDraftCreated(item, result);
        return true;
      } catch (nextError) {
        setDraftError(
          nextError instanceof Error
            ? nextError.message
            : "Не удалось создать событие-черновик через admin_publish_import_item.",
        );
        return false;
      } finally {
        setDraftSubmitting(false);
      }
    },
    [draftSubmitting, item, onDraftCreated],
  );

  const handleConfirmIgnore = useCallback(async () => {
    if (!item || ignoreLoading) {
      return;
    }

    setIgnoreLoading(true);
    setIgnoreError(null);

    try {
      const ignoredItem = await ignoreImportItem(item.id, ignoreReason);

      setIsConfirmingIgnore(false);
      setIgnoreReason("");
      await onIgnored(ignoredItem);
    } catch (nextError) {
      setIgnoreError(
        nextError instanceof Error
          ? nextError.message
          : "Не удалось игнорировать import item через admin_ignore_import_item.",
      );
      setIgnoreLoading(false);
    }
  }, [ignoreLoading, ignoreReason, item, onIgnored]);

  return (
    <div
      className="import-detail-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !ignoreLoading && !draftSubmitting) {
          onClose();
        }
      }}
    >
      <aside
        aria-labelledby={titleId}
        aria-modal="true"
        className="import-detail-drawer"
        role="dialog"
      >
        <div className="import-detail-drawer__head">
          <div className="import-detail-drawer__title">
            <div className="badge-row">
              <Badge tone="gold">review detail</Badge>
              <Badge tone="glass">admin_get_import_item</Badge>
              {isAdminIgnored ? <Badge tone="muted">admin ignored</Badge> : null}
              {isSafeIgnoredByImporter ? (
                <Badge tone="gold">safe ignored by importer</Badge>
              ) : null}
            </div>
            <h2 id={titleId}>{title}</h2>
            <p>Полные данные загружаются через RPC `admin_get_import_item`.</p>
          </div>
          <Button disabled={ignoreLoading || draftSubmitting} onClick={onClose} variant="secondary">
            Закрыть
          </Button>
        </div>

        <div className="import-detail-drawer__body">
          {loading ? (
            <ImportReviewState
              description="Вызываем admin_get_import_item и ждём полные данные import item."
              title="Загрузка detail"
            />
          ) : error ? (
            <ImportReviewState description={error} title="Не удалось загрузить detail">
              <Button onClick={onRetry} variant="primary">
                Повторить
              </Button>
            </ImportReviewState>
          ) : item ? (
            <>
              <ImportItemDetailActions
                draftSubmitting={draftSubmitting}
                ignoreError={ignoreError}
                ignoreLoading={ignoreLoading}
                ignoreReason={ignoreReason}
                isCreatingDraft={isCreatingDraft}
                isConfirmingIgnore={isConfirmingIgnore}
                item={item}
                onCancelIgnore={handleCancelIgnore}
                onOpenEventsList={onOpenEventsList}
                onConfirmIgnore={handleConfirmIgnore}
                onIgnoreReasonChange={setIgnoreReason}
                onStartCreateDraft={handleStartCreateDraft}
                onStartIgnore={handleStartIgnore}
                reasonId={reasonId}
              />
              {draftResult ? (
                <ImportDraftCreatedState
                  onOpenEvent={onOpenEvent}
                  onOpenEventsList={onOpenEventsList}
                  result={draftResult}
                />
              ) : null}
              {isCreatingDraft && !draftResult ? (
                <ImportToEventDraftForm
                  item={item}
                  onCancel={handleCancelCreateDraft}
                  onSubmit={handleSubmitCreateDraft}
                  submitError={draftError}
                  submitting={draftSubmitting}
                />
              ) : null}
              <ImportItemDetailContent item={item} />
            </>
          ) : (
            <ImportReviewState
              description="RPC не вернул данные для выбранного import item."
              title="Detail пуст"
            />
          )}
        </div>
      </aside>
    </div>
  );
}

function ImportItemDetailActions({
  draftSubmitting,
  ignoreError,
  ignoreLoading,
  ignoreReason,
  isCreatingDraft,
  isConfirmingIgnore,
  item,
  onCancelIgnore,
  onConfirmIgnore,
  onIgnoreReasonChange,
  onOpenEventsList,
  onStartCreateDraft,
  onStartIgnore,
  reasonId,
}: {
  draftSubmitting: boolean;
  ignoreError: string | null;
  ignoreLoading: boolean;
  ignoreReason: string;
  isCreatingDraft: boolean;
  isConfirmingIgnore: boolean;
  item: AdminImportReviewItem;
  onCancelIgnore: () => void;
  onConfirmIgnore: () => void;
  onIgnoreReasonChange: (reason: string) => void;
  onOpenEventsList?: () => void;
  onStartCreateDraft: () => void;
  onStartIgnore: () => void;
  reasonId: string;
}) {
  const adminReview = getAdminReviewMetadata(item);
  const isAdminIgnored = Boolean(adminReview.ignoredAt);
  const isSafeIgnoredByImporter = item.status === "ignored" && !isAdminIgnored;
  const linkedEventId = item.linkedEventId ?? item.importReview?.draftEventId ?? null;
  const title = getImportItemTitle(item);

  if (isAdminIgnored) {
    return (
      <section className="import-detail-actions import-detail-actions--ignored">
        <div className="import-detail-actions__head">
          <div>
            <h3>Элемент уже проигнорирован</h3>
            <p>Эти данные пришли из `raw_payload.adminReview`.</p>
          </div>
          <Badge tone="muted">ignored</Badge>
        </div>
        <div className="import-detail-grid">
          <ImportReviewField
            label="adminReview.ignoredAt"
            value={formatDateTimeDetail(adminReview.ignoredAt)}
          />
          <ImportReviewField
            label="adminReview.ignoredBy"
            value={adminReview.ignoredBy ?? "Не указано"}
          />
          <ImportReviewField
            label="adminReview.ignoreReason"
            value={adminReview.ignoreReason ?? "Не указано"}
            wide
          />
        </div>
      </section>
    );
  }

  if (linkedEventId || item.status === "linked") {
    return (
      <section className="import-detail-actions import-detail-actions--linked">
        <div className="import-detail-actions__head">
          <div>
            <h3>Событие уже создано</h3>
            <p>Import item уже связан с записью в events. Повторное создание недоступно.</p>
          </div>
          <Badge tone="green">linked</Badge>
        </div>
        <div className="import-detail-grid">
          <ImportReviewField
            label="linkedEventId"
            value={linkedEventId ?? "linked_event_id не вернулся"}
            wide
          />
        </div>
        {onOpenEventsList ? (
          <div className="import-ignore-actions">
            <Button onClick={onOpenEventsList} variant="secondary">
              Открыть список событий
            </Button>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="import-detail-actions">
      <div className="import-detail-actions__head">
        <div>
          <h3>Действия</h3>
          <p>
            Можно создать событие как скрытый черновик или скрыть item из очереди
            проверки без создания события.
          </p>
          {isSafeIgnoredByImporter ? (
            <div className="badge-row">
              <Badge tone="gold">safe ignored by importer</Badge>
              <Badge tone="glass">требует проверки</Badge>
            </div>
          ) : null}
        </div>
        <div className="import-detail-actions__buttons">
          <Button
            disabled={ignoreLoading || draftSubmitting}
            onClick={onStartCreateDraft}
            variant="primary"
          >
            {isCreatingDraft ? "Форма открыта" : "Создать событие"}
          </Button>
          <Button
            disabled={ignoreLoading || draftSubmitting}
            onClick={onStartIgnore}
            variant={isConfirmingIgnore ? "ghost" : "secondary"}
          >
            Игнорировать
          </Button>
        </div>
      </div>

      {isConfirmingIgnore ? (
        <div className="import-ignore-confirm">
          <div className="import-ignore-confirm__summary">
            <strong>{title}</strong>
            <span>
              sourceUrl:{" "}
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
            </span>
            <p>
              Элемент будет скрыт из очереди проверки. Событие в events создано не будет.
            </p>
          </div>

          <label className="import-ignore-field" htmlFor={reasonId}>
            <span>Причина</span>
            <textarea
              disabled={ignoreLoading}
              id={reasonId}
              onChange={(event) => onIgnoreReasonChange(event.target.value)}
              placeholder="Дубликат / не событие / устарело / не нужно публиковать"
              value={ignoreReason}
            />
          </label>

          {ignoreError ? (
            <div className="form-error" role="alert">
              {ignoreError}
            </div>
          ) : null}

          <div className="import-ignore-actions">
            <Button disabled={ignoreLoading} onClick={onCancelIgnore} variant="secondary">
              Отмена
            </Button>
            <Button disabled={ignoreLoading} onClick={onConfirmIgnore} variant="primary">
              {ignoreLoading ? "Игнорируем..." : "Игнорировать"}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

type ImportDraftPrefill = {
  event: AdminEvent;
  hasStartsAt: boolean;
  paidHint: boolean;
  registrationUrlSource: "rawPayload" | "sourceUrl" | null;
};

function ImportDraftCreatedState({
  onOpenEvent,
  onOpenEventsList,
  result,
}: {
  onOpenEvent?: (event: AdminEvent) => void;
  onOpenEventsList?: () => void;
  result: AdminPublishImportItemResult;
}) {
  const event = result.event;
  const linkedEventId = event?.id ?? result.linkedEventId;

  return (
    <section className="import-draft-success">
      <div className="import-draft-success__head">
        <div>
          <h3>Событие создано как черновик</h3>
          <p>
            Перед публикацией проверьте дату, описание, регистрацию и видимость.
          </p>
        </div>
        <div className="badge-row">
          <Badge tone="gold">{event?.status ?? "draft"}</Badge>
          <Badge tone="muted">{event?.visibility ?? "hidden"}</Badge>
        </div>
      </div>

      <div className="import-detail-grid">
        {event ? <ImportReviewField label="title" value={event.title} /> : null}
        <ImportReviewField label="linkedEventId" value={linkedEventId ?? "Не указано"} />
      </div>

      <div className="import-ignore-actions">
        {event && onOpenEvent ? (
          <Button onClick={() => onOpenEvent(event)} variant="primary">
            Открыть событие
          </Button>
        ) : null}
        {onOpenEventsList ? (
          <Button onClick={onOpenEventsList} variant={event && onOpenEvent ? "secondary" : "primary"}>
            Открыть список событий
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function ImportToEventDraftForm({
  item,
  onCancel,
  onSubmit,
  submitError,
  submitting,
}: {
  item: AdminImportReviewItem;
  onCancel: () => void;
  onSubmit: (input: AdminEventMutationInput) => Promise<boolean>;
  submitError: string | null;
  submitting: boolean;
}) {
  const prefill = useMemo(() => buildImportDraftPrefill(item), [item]);

  return (
    <section className="import-draft-form-panel">
      <div className="import-draft-form-panel__head">
        <div>
          <Badge tone="gold">draft / hidden</Badge>
          <h3>Создать событие из импорта</h3>
        </div>
      </div>

      <EventForm
        cancelLabel="Вернуться к detail"
        forceDraftHidden
        initialEvent={prefill.event}
        mode="create"
        notice={<ImportDraftFormNotice prefill={prefill} />}
        onCancel={onCancel}
        onSubmit={onSubmit}
        submitError={submitError}
        submitLabel="Сохранить как черновик"
        submitting={submitting}
        submittingLabel="Создаём черновик..."
      />
    </section>
  );
}

function ImportDraftFormNotice({ prefill }: { prefill: ImportDraftPrefill }) {
  return (
    <div className="import-draft-notices">
      <div className="import-draft-notice">
        <strong>Событие будет создано как черновик и скрыто от пользователей.</strong>
        <p>
          Перед публикацией проверьте дату, описание, регистрацию и видимость.
          Варианты участия и расчёт суммы будут добавлены отдельным PR.
        </p>
      </div>

      {!prefill.hasStartsAt ? (
        <div className="import-draft-notice import-draft-notice--warning">
          <strong>Дата не распознана.</strong>
          <p>Заполните дату и время начала вручную перед сохранением черновика.</p>
        </div>
      ) : null}

      {prefill.registrationUrlSource === "sourceUrl" ? (
        <div className="import-draft-notice import-draft-notice--info">
          <strong>Registration URL взят из sourceUrl import item.</strong>
          <p>Проверьте, что эта ссылка действительно ведёт на внешнюю регистрацию.</p>
        </div>
      ) : null}

      {prefill.paidHint ? (
        <div className="import-draft-notice import-draft-notice--warning">
          <strong>Похоже на платное событие.</strong>
          <p>
            Internal paid не выбирается автоматически. Сейчас можно создать черновик
            без вариантов участия.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function ImportItemDetailContent({ item }: { item: AdminImportReviewItem }) {
  const review = item.importReview;
  const rawDetails = getRawPayloadDetails(item.rawPayload);
  const needsReview = review?.needsReview ?? review?.reviewNeeded ?? null;

  return (
    <>
      <section className="import-detail-section">
        <h3>Основное</h3>
        <div className="import-detail-grid">
          <ImportReviewField
            label="Title"
            value={rawDetails.title ?? item.parsedTitle ?? "Не указано"}
          />
          <ImportReviewField label="Parsed title" value={item.parsedTitle || "Не указано"} />
          <ImportReviewField label="Status" value={item.status ?? "unknown"} />
          <ImportReviewField
            label="dateConfidence"
            value={review?.dateConfidence ?? "Не указано"}
          />
          <ImportReviewField label="dateStatus" value={review?.dateStatus ?? "Не указано"} />
          <ImportReviewField label="needsReview" value={formatBooleanValue(needsReview)} />
          <ImportReviewField label="Reason" value={review?.reason ?? "Не указано"} wide />
          <ImportReviewField label="Notes" value={review?.notes ?? "Не указано"} wide />
        </div>
      </section>

      <section className="import-detail-section">
        <h3>Дата и место</h3>
        <div className="import-detail-grid">
          <ImportReviewField label="rawDateText" value={review?.rawDateText ?? "Не указано"} />
          <ImportReviewField label="rawTimeText" value={review?.rawTimeText ?? "Не указано"} />
          <ImportReviewField
            label="suggestedStartsAt"
            value={formatDateTimeDetail(review?.suggestedStartsAt ?? null)}
          />
          <ImportReviewField
            label="parsedStartsAt"
            value={formatDateTimeDetail(item.parsedStartsAt)}
          />
          <ImportReviewField
            label="parsedLocation"
            value={item.parsedLocation || "Не указано"}
            wide
          />
        </div>
      </section>

      <section className="import-detail-section">
        <h3>Источник</h3>
        <div className="import-detail-grid">
          <ImportReviewField label="sourceName" value={item.sourceName || "Не указано"} />
          <ImportReviewField label="externalId" value={item.externalId || "Не указано"} />
          <ImportReviewField label="createdAt" value={formatDateTimeDetail(item.createdAt)} />
          {item.linkedEventId ? (
            <ImportReviewField label="linkedEventId" value={item.linkedEventId} />
          ) : null}
          <ImportReviewField label="sourceUrl" wide>
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
      </section>

      <section className="import-detail-section">
        <h3>Raw payload fields</h3>
        {rawDetails.imageUrl ? (
          <figure className="import-detail-image">
            <img
              alt={item.parsedTitle || "Import item image"}
              loading="lazy"
              src={rawDetails.imageUrl}
            />
            <figcaption>
              <a
                className="import-review-link"
                href={rawDetails.imageUrl}
                rel="noreferrer"
                target="_blank"
              >
                {rawDetails.imageUrl}
              </a>
            </figcaption>
          </figure>
        ) : null}
        <div className="import-detail-grid">
          <ImportReviewField label="registrationUrl" wide>
            {rawDetails.registrationUrl ? (
              <a
                className="import-review-link"
                href={rawDetails.registrationUrl}
                rel="noreferrer"
                target="_blank"
              >
                {rawDetails.registrationUrl}
              </a>
            ) : (
              "Не указано"
            )}
          </ImportReviewField>
          <ImportReviewField
            label="Description"
            value={rawDetails.description ?? "Не указано"}
            wide
          />
          <ImportReviewField
            label="Short description"
            value={rawDetails.shortDescription ?? "Не указано"}
            wide
          />
        </div>
      </section>
    </>
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

function getImportItemTitle(item: AdminImportReviewItem): string {
  const rawDetails = getRawPayloadDetails(item.rawPayload);

  return rawDetails.title || item.parsedTitle || "Без названия";
}

function buildImportDraftPrefill(item: AdminImportReviewItem): ImportDraftPrefill {
  const rawDetails = getRawPayloadDetails(item.rawPayload);
  const title = cleanString(item.parsedTitle) ?? rawDetails.title ?? "Без названия";
  const startsAt =
    normalizeDateCandidate(item.importReview?.suggestedStartsAt) ??
    normalizeDateCandidate(item.parsedStartsAt);
  const registrationUrl = rawDetails.registrationUrl ?? item.sourceUrl;
  const registrationUrlSource = rawDetails.registrationUrl
    ? "rawPayload"
    : item.sourceUrl
      ? "sourceUrl"
      : null;
  const event: AdminEvent = {
    id: `import-draft-${item.id}`,
    communityId: item.communityId ?? "",
    title,
    subtitle: rawDetails.subtitle,
    description: rawDetails.description,
    shortDescription: rawDetails.shortDescription,
    startsAt,
    endsAt: rawDetails.endsAt,
    timezone: rawDetails.timezone ?? "Europe/Moscow",
    locationName: cleanString(item.parsedLocation) ?? rawDetails.location,
    address: rawDetails.address,
    imageUrl: rawDetails.imageUrl,
    category: inferImportCategory(title),
    audience: null,
    visibility: "hidden",
    status: "draft",
    sourceType: "website_scrape",
    sourceUrl: item.sourceUrl,
    sourceExternalId: item.externalId,
    manualOverride: true,
    registrationMode: registrationUrl ? "external_link" : "none",
    registrationUrl,
    capacity: null,
    waitlistEnabled: false,
    requiresApproval: false,
    priceAmount: null,
    priceCurrency: "RUB",
    createdAt: item.createdAt,
    updatedAt: item.createdAt,
    publishedAt: null,
  };

  return {
    event,
    hasStartsAt: Boolean(startsAt),
    paidHint: hasPaidImportHint(item, rawDetails),
    registrationUrlSource,
  };
}

function inferImportCategory(title: string): string {
  const normalizedTitle = title.toLocaleLowerCase("ru");

  if (/шаб+ат/.test(normalizedTitle)) {
    return "shabbat";
  }

  if (/лекци|урок|курс/.test(normalizedTitle)) {
    return "lecture";
  }

  if (/экскурс/.test(normalizedTitle)) {
    return "tour";
  }

  return "community";
}

function hasPaidImportHint(
  item: AdminImportReviewItem,
  rawDetails: ReturnType<typeof getRawPayloadDetails>,
): boolean {
  const searchableText = [
    rawDetails.title,
    item.parsedTitle,
    rawDetails.subtitle,
    rawDetails.shortDescription,
    rawDetails.description,
    item.importReview?.notes,
    item.importReview?.reason,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("ru");

  return /платн|стоимост|руб|₽|билет|оплат|donat|donation/.test(searchableText);
}

function cleanString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeDateCandidate(value: string | null | undefined): string | null {
  const normalized = cleanString(value);

  if (!normalized) {
    return null;
  }

  const date = new Date(normalized);

  return Number.isNaN(date.getTime()) ? null : normalized;
}

function getAdminReviewMetadata(item: AdminImportReviewItem): {
  ignoredAt: string | null;
  ignoredBy: string | null;
  ignoreReason: string | null;
} {
  return {
    ignoredAt: readRawPayloadString(item.rawPayload, [["adminReview", "ignoredAt"]]),
    ignoredBy: readRawPayloadString(item.rawPayload, [["adminReview", "ignoredBy"]]),
    ignoreReason: readRawPayloadString(item.rawPayload, [["adminReview", "ignoreReason"]]),
  };
}

function isAdminIgnoredImportItem(item: AdminImportReviewItem): boolean {
  return Boolean(getAdminReviewMetadata(item).ignoredAt);
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

function isJsonObject(value: JsonValue | null | undefined): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getRawPayloadDetails(rawPayload: JsonValue): {
  address: string | null;
  description: string | null;
  endsAt: string | null;
  imageUrl: string | null;
  location: string | null;
  registrationUrl: string | null;
  shortDescription: string | null;
  subtitle: string | null;
  timezone: string | null;
  title: string | null;
} {
  const subtitle = readRawPayloadString(rawPayload, [
    ["subtitle"],
    ["subTitle"],
    ["detail", "subtitle"],
    ["detail", "subTitle"],
    ["parsed", "subtitle"],
    ["parsed", "subTitle"],
    ["card", "subtitle"],
    ["card", "subTitle"],
  ]);

  return {
    address: readRawPayloadString(rawPayload, [
      ["address"],
      ["detail", "address"],
      ["parsed", "address"],
      ["card", "address"],
    ]),
    description: readRawPayloadString(rawPayload, [
      ["description"],
      ["text"],
      ["detail", "description"],
      ["detail", "text"],
      ["parsed", "description"],
      ["parsed", "text"],
      ["card", "description"],
      ["card", "text"],
    ]),
    endsAt: readRawPayloadString(rawPayload, [
      ["endsAt"],
      ["ends_at"],
      ["endAt"],
      ["end_at"],
      ["detail", "endsAt"],
      ["detail", "ends_at"],
      ["parsed", "endsAt"],
      ["parsed", "ends_at"],
    ]),
    imageUrl: readRawPayloadString(rawPayload, [
      ["imageUrl"],
      ["image_url"],
      ["image"],
      ["detail", "imageUrl"],
      ["detail", "image_url"],
      ["detail", "image"],
      ["parsed", "imageUrl"],
      ["parsed", "image_url"],
      ["parsed", "image"],
      ["card", "imageUrl"],
      ["card", "image_url"],
      ["card", "image"],
    ]),
    location: readRawPayloadString(rawPayload, [
      ["location"],
      ["locationName"],
      ["location_name"],
      ["place"],
      ["venue"],
      ["detail", "location"],
      ["detail", "locationName"],
      ["detail", "location_name"],
      ["detail", "place"],
      ["detail", "venue"],
      ["parsed", "location"],
      ["parsed", "locationName"],
      ["parsed", "location_name"],
      ["card", "location"],
      ["card", "locationName"],
      ["card", "location_name"],
    ]),
    registrationUrl: readRawPayloadString(rawPayload, [
      ["registrationUrl"],
      ["registration_url"],
      ["detail", "registrationUrl"],
      ["detail", "registration_url"],
      ["parsed", "registrationUrl"],
      ["parsed", "registration_url"],
      ["card", "registrationUrl"],
      ["card", "registration_url"],
    ]),
    shortDescription:
      readRawPayloadString(rawPayload, [
        ["shortDescription"],
        ["short_description"],
        ["excerpt"],
        ["detail", "shortDescription"],
        ["detail", "short_description"],
        ["detail", "excerpt"],
        ["parsed", "shortDescription"],
        ["parsed", "short_description"],
        ["parsed", "excerpt"],
        ["card", "shortDescription"],
        ["card", "short_description"],
        ["card", "excerpt"],
      ]) ?? subtitle,
    subtitle,
    timezone: readRawPayloadString(rawPayload, [
      ["timezone"],
      ["timeZone"],
      ["detail", "timezone"],
      ["detail", "timeZone"],
      ["parsed", "timezone"],
      ["parsed", "timeZone"],
    ]),
    title: readRawPayloadString(rawPayload, [
      ["title"],
      ["detail", "title"],
      ["parsed", "title"],
      ["card", "title"],
    ]),
  };
}

function readRawPayloadString(rawPayload: JsonValue, paths: string[][]): string | null {
  for (const path of paths) {
    const value = readJsonPath(rawPayload, path);

    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
  }

  return null;
}

function readJsonPath(rawPayload: JsonValue, path: string[]): JsonValue | undefined {
  let current: JsonValue | undefined = rawPayload;

  for (const segment of path) {
    if (!isJsonObject(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

function formatBooleanValue(value: boolean | null | undefined): string {
  if (value === null || value === undefined) {
    return "Не указано";
  }

  return value ? "true" : "false";
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

function formatDateTimeDetail(value: string | null | undefined): string {
  if (!value) {
    return "Не указано";
  }

  const formatted = formatDateTime(value);

  return formatted === value ? value : `${formatted} (${value})`;
}

function formatRawPayloadPreview(value: JsonValue): string {
  const serialized = formatRawPayloadFull(value);
  return serialized.length > 1400 ? `${serialized.slice(0, 1400)}\n...` : serialized;
}

function formatRawPayloadFull(value: JsonValue): string {
  try {
    return JSON.stringify(value, null, 2);
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
