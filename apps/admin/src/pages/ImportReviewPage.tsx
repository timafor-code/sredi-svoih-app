import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";

import { EventForm } from "../components/events/EventForm";
import {
  AdminImportRunHistory,
  formatAdminImportRunStatusLabel,
  getAdminImportRunStatusTone,
} from "../components/import/AdminImportRunHistory";
import { AdminWebsiteImportRunner } from "../components/import/AdminWebsiteImportRunner";
import {
  getImportDedupeStatusLabel,
  ImportDedupeBadge,
} from "../components/import/ImportDedupeBadge";
import { listAdminEventCategories } from "../services/eventCategoriesService";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { GlassCard } from "../components/ui/GlassCard";
import {
  getImportItem,
  ignoreImportItem,
  listImportItemsNeedingReview,
  publishImportItemAsDraft,
} from "../services/adminImportReviewService";
import { listAdminImportRuns } from "../services/adminWebsiteImportService";
import type { AdminBadgeTone } from "../types/admin";
import { getEventStatusLabel, getEventVisibilityLabel } from "../types/events";
import type { AdminEvent, AdminEventMutationInput } from "../types/events";
import type { AdminEventCategory } from "../types/eventCategories";
import {
  ADMIN_IMPORT_DEDUPE_MATCHED_BY,
  ADMIN_IMPORT_DEDUPE_STATUSES,
} from "../types/importDedupe";
import type { AdminImportDedupe } from "../types/importDedupe";
import {
  ADMIN_IMPORT_DATE_QUALITIES,
  ADMIN_IMPORT_ITEM_STATUSES,
} from "../types/importReview";
import type {
  AdminImportDateQuality,
  AdminImportItemStatus,
  AdminPublishImportItemResult,
  AdminImportReviewItem,
  JsonObject,
  JsonValue,
} from "../types/importReview";
import type { AdminImportRun } from "../types/websiteImport";

type DateQualityFilter = "all" | AdminImportDateQuality;
type StatusFilter = "all" | AdminImportItemStatus;
type ReviewLimit = 50 | 100;
type ImportDetailInitialMode = "details" | "draft";

const RECENT_STARTED_IMPORT_RUN_MS = 30 * 60 * 1000;
const COMPACT_LIST_DELETE_REASON = "Удалено из очереди проверки из compact list";

const DATE_QUALITY_LABELS: Record<AdminImportDateQuality, string> = {
  confident: "Уверенная",
  partial: "Частичная",
  recurring_rule: "Повтор",
  none: "Нет даты",
};

const IMPORT_STATUS_LABELS: Record<AdminImportItemStatus, string> = {
  new: "Новое",
  linked: "Связано",
  ignored: "Удалён из очереди",
  error: "Ошибка",
};

const DATE_QUALITY_FILTERS: Array<{ value: DateQualityFilter; label: string }> = [
  { value: "all", label: "Все" },
  ...ADMIN_IMPORT_DATE_QUALITIES.map((dateQuality) => ({
    value: dateQuality,
    label: formatDateQualityLabel(dateQuality),
  })),
];

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Все" },
  ...ADMIN_IMPORT_ITEM_STATUSES.map((status) => ({
    value: status,
    label: formatImportStatusLabel(status),
  })),
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
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [deletingItemIds, setDeletingItemIds] = useState<string[]>([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const [detailInitialMode, setDetailInitialMode] =
    useState<ImportDetailInitialMode>("details");
  const [detailItem, setDetailItem] = useState<AdminImportReviewItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailReloadSignal, setDetailReloadSignal] = useState(0);
  const [isImportHistoryOpen, setIsImportHistoryOpen] = useState(false);
  const [importRuns, setImportRuns] = useState<AdminImportRun[]>([]);
  const [importRunsLoading, setImportRunsLoading] = useState(true);
  const [importRunsError, setImportRunsError] = useState<string | null>(null);

  const loadItems = useCallback(async (): Promise<boolean> => {
    setLoading(true);
    setError(null);
    setSuccessMessage(null);
    setActionError(null);

    try {
      const nextItems = await listImportItemsNeedingReview(limit);
      setItems(nextItems);
      return true;
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Не удалось загрузить элементы импорта из Supabase.",
      );
      return false;
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    void loadItems();
  }, [loadItems, refreshSignal]);

  const loadImportRuns = useCallback(async (): Promise<boolean> => {
    setImportRunsLoading(true);
    setImportRunsError(null);

    try {
      const nextRuns = await listAdminImportRuns({ limit: 10 });
      setImportRuns(nextRuns);
      return true;
    } catch (nextError) {
      setImportRunsError(
        nextError instanceof Error
          ? nextError.message
          : "Не удалось загрузить журнал запусков импорта из Supabase.",
      );
      return false;
    } finally {
      setImportRunsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadImportRuns();
  }, [loadImportRuns, refreshSignal]);

  const handleImportFinished = useCallback(async (): Promise<boolean> => {
    const [itemsReloaded] = await Promise.all([loadItems(), loadImportRuns()]);

    return itemsReloaded;
  }, [loadImportRuns, loadItems]);

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
              : "Не удалось загрузить элемент импорта через admin_get_import_item.",
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

  const handleOpenDetail = useCallback(
    (itemId: string, mode: ImportDetailInitialMode = "details") => {
      setSuccessMessage(null);
      setActionError(null);
      setDetailInitialMode(mode);
      setDetailItemId(itemId);
      setDetailReloadSignal((current) => current + 1);
    },
    [],
  );

  const handleOpenDraft = useCallback((itemId: string) => {
    handleOpenDetail(itemId, "draft");
  }, [handleOpenDetail]);

  const handleOpenDetailView = useCallback((itemId: string) => {
    handleOpenDetail(itemId, "details");
  }, [handleOpenDetail]);

  const handleCloseDetail = useCallback(() => {
    setDetailItemId(null);
    setDetailInitialMode("details");
    setDetailItem(null);
    setDetailError(null);
  }, []);

  const handleRetryDetail = useCallback(() => {
    setDetailReloadSignal((current) => current + 1);
  }, []);

  const handleToggleItemSelection = useCallback((itemId: string, checked: boolean) => {
    setSelectedItemIds((current) => {
      if (checked) {
        return current.includes(itemId) ? current : [...current, itemId];
      }

      return current.filter((currentItemId) => currentItemId !== itemId);
    });
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedItemIds([]);
  }, []);

  const handleDeleteImportItemFromList = useCallback(
    async (item: AdminImportReviewItem) => {
      const title = getImportItemTitle(item);
      const confirmed = window.confirm(
        `Удалить «${title}» из очереди проверки? Строка event_import_items не будет физически удалена.`,
      );

      if (!confirmed) {
        return;
      }

      setSuccessMessage(null);
      setActionError(null);
      setDeletingItemIds((current) =>
        current.includes(item.id) ? current : [...current, item.id],
      );

      try {
        await ignoreImportItem(item.id, COMPACT_LIST_DELETE_REASON);
        setSelectedItemIds((current) =>
          current.filter((currentItemId) => currentItemId !== item.id),
        );

        const reloaded = await loadItems();

        setSuccessMessage(
          reloaded
            ? `Элемент импорта «${title}» удалён из очереди проверки.`
            : `Элемент импорта «${title}» удалён из очереди проверки. Очередь не обновилась, попробуйте «Обновить очередь».`,
        );
      } catch (nextError) {
        setActionError(
          nextError instanceof Error
            ? nextError.message
            : "Не удалось удалить элемент импорта из очереди проверки через admin_ignore_import_item.",
        );
      } finally {
        setDeletingItemIds((current) =>
          current.filter((currentItemId) => currentItemId !== item.id),
        );
      }
    },
    [loadItems],
  );

  const handleDeleteSelectedImportItems = useCallback(async () => {
    if (bulkDeleting || selectedItemIds.length === 0) {
      return;
    }

    const selectedItems = items.filter((item) => selectedItemIds.includes(item.id));
    const selectedCount = selectedItems.length;

    if (selectedCount === 0) {
      setSelectedItemIds([]);
      return;
    }

    const confirmed = window.confirm(
      `Удалить выбранные элементы из очереди проверки (${selectedCount})? Строки event_import_items не будут физически удалены.`,
    );

    if (!confirmed) {
      return;
    }

    setBulkDeleting(true);
    setSuccessMessage(null);
    setActionError(null);

    const removedIds: string[] = [];
    const failedMessages: string[] = [];

    for (const item of selectedItems) {
      try {
        await ignoreImportItem(item.id, COMPACT_LIST_DELETE_REASON);
        removedIds.push(item.id);
      } catch (nextError) {
        const message =
          nextError instanceof Error
            ? nextError.message
            : "неизвестная ошибка admin_ignore_import_item";

        failedMessages.push(`${getImportItemTitle(item)}: ${message}`);
      }
    }

    setSelectedItemIds((current) =>
      current.filter((itemId) => !removedIds.includes(itemId)),
    );

    const reloaded = removedIds.length > 0 ? await loadItems() : true;

    if (removedIds.length > 0) {
      setSuccessMessage(
        reloaded
          ? `Удалено из очереди проверки: ${removedIds.length}.`
          : `Удалено из очереди проверки: ${removedIds.length}. Очередь не обновилась, попробуйте «Обновить очередь».`,
      );
    }

    if (failedMessages.length > 0) {
      setActionError(
        `Не удалось удалить из очереди: ${failedMessages.length}. Успешно: ${removedIds.length}. ${failedMessages
          .slice(0, 2)
          .join(" ")}`,
      );
    }

    setBulkDeleting(false);
  }, [bulkDeleting, items, loadItems, selectedItemIds]);

  const handleImportItemIgnored = useCallback(
    async (ignoredItem: AdminImportReviewItem) => {
      const ignoredTitle = getImportItemTitle(ignoredItem);

      handleCloseDetail();
      const reloaded = await loadItems();

      setSuccessMessage(
        reloaded
          ? `Элемент импорта «${ignoredTitle}» удалён из очереди проверки.`
          : `Элемент импорта «${ignoredTitle}» удалён из очереди проверки. Очередь не обновилась, попробуйте «Обновить очередь».`,
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
          ? `Событие «${eventTitle}» создано как черновик и скрыто через admin_publish_import_item. Элемент импорта обновлён в очереди.`
          : `Событие «${eventTitle}» создано как черновик и скрыто. Очередь не обновилась, попробуйте «Обновить очередь».`,
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

  useEffect(() => {
    if (!isImportHistoryOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsImportHistoryOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isImportHistoryOpen]);

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

      const dedupe = getImportDedupe(item);
      const searchableText = [
        item.parsedTitle,
        item.sourceUrl,
        item.parsedLocation,
        item.importReview?.reason,
        item.importReview?.rawDateText,
        dedupe?.status,
        dedupe?.reason,
        dedupe?.sourceExternalId,
        dedupe?.canonicalSourceUrl,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("ru");

      return searchableText.includes(normalizedQuery);
    });
  }, [dateQualityFilter, items, query, statusFilter]);

  const hasActiveFilters =
    query.trim().length > 0 || dateQualityFilter !== "all" || statusFilter !== "all";

  useEffect(() => {
    const itemIds = new Set(items.map((item) => item.id));

    setSelectedItemIds((current) => {
      const next = current.filter((itemId) => itemIds.has(itemId));

      return next.length === current.length ? current : next;
    });
  }, [items]);

  const selectedListItem = useMemo(() => {
    if (!detailItemId) {
      return null;
    }

    return items.find((item) => item.id === detailItemId) ?? null;
  }, [detailItemId, items]);

  const recentStartedRun = useMemo(
    () => importRuns.find(isRecentStartedImportRun) ?? null,
    [importRuns],
  );

  const latestImportRun = importRuns[0] ?? null;
  const selectedItemIdSet = useMemo(() => new Set(selectedItemIds), [selectedItemIds]);

  return (
    <div className="page-stack page-stack--import">
      <section className="page-header">
        <Badge tone="gold">Очередь проверки</Badge>
        <h1>Импорт с сайта</h1>
        <p>
          Проверка импорта. Из деталей можно удалить элемент из очереди или создать
          событие-черновик через отдельные RPC; публикация остаётся отдельным ручным
          действием.
        </p>
      </section>

      <ImportRunHistorySummary
        error={importRunsError}
        latestRun={latestImportRun}
        loading={importRunsLoading}
        onOpen={() => setIsImportHistoryOpen(true)}
      />

      {importRunsLoading ? (
        <ImportRunnerBlocked loading run={null} />
      ) : recentStartedRun ? (
        <ImportRunnerBlocked loading={false} run={recentStartedRun} />
      ) : (
        <AdminWebsiteImportRunner onImportFinished={handleImportFinished} />
      )}

      {successMessage ? (
        <div className="import-review-status import-review-status--success" role="status">
          {successMessage}
        </div>
      ) : null}

      {actionError ? (
        <div className="import-review-status import-review-status--error" role="alert">
          {actionError}
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
            <span>Качество даты</span>
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
            <span>Лимит</span>
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
          <h2>Элементы на проверку</h2>
          <div className="events-summary">
            <span>
              Показано {filteredItems.length} из {items.length}
            </span>
            <Badge tone="glass">Supabase RPC</Badge>
          </div>
        </div>

        <ImportReviewBulkActions
          deleting={bulkDeleting}
          onClear={handleClearSelection}
          onDelete={() => void handleDeleteSelectedImportItems()}
          selectedCount={selectedItemIds.length}
        />

        {loading ? (
          <ImportReviewState
            description="Вызываем admin_list_import_items_needing_review и ждём ответ Supabase."
            title="Загрузка элементов импорта"
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
          <ImportReviewList
            deletingItemIds={deletingItemIds}
            disabled={bulkDeleting}
            items={filteredItems}
            onDeleteItem={(item) => void handleDeleteImportItemFromList(item)}
            onOpenDetail={handleOpenDetailView}
            onOpenDraft={handleOpenDraft}
            onToggleSelection={handleToggleItemSelection}
            selectedItemIds={selectedItemIdSet}
          />
        )}
      </GlassCard>

      {detailItemId ? (
        <ImportItemDetailDrawer
          error={detailError}
          fallbackItem={selectedListItem}
          initialMode={detailInitialMode}
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

      {isImportHistoryOpen ? (
        <ImportRunHistoryModal
          error={importRunsError}
          loading={importRunsLoading}
          onClose={() => setIsImportHistoryOpen(false)}
          onRefresh={() => void loadImportRuns()}
          runs={importRuns}
        />
      ) : null}
    </div>
  );
}

function ImportRunnerBlocked({
  loading,
  run,
}: {
  loading: boolean;
  run: AdminImportRun | null;
}) {
  const statusText = loading
    ? "Проверяем журнал запусков перед новым импортом."
    : `Есть незавершённый import run${run?.sourceName ? `: ${run.sourceName}` : ""}.`;

  return (
    <GlassCard className="admin-import-runner admin-import-runner--blocked">
      <div className="admin-import-runner__head">
        <div className="admin-import-runner__title">
          <div className="badge-row">
            <Badge tone="gold">{loading ? "Проверяем history" : "Import run started"}</Badge>
            <Badge tone="glass">Edge Function</Badge>
          </div>
          <h2>Запуск импорта сайта</h2>
          <p>
            {statusText} Новый запуск станет доступен после обновления статуса в журнале.
          </p>
        </div>
        <Button disabled variant="gold">
          {loading ? "Проверяем журнал..." : "Импорт уже запущен"}
        </Button>
      </div>

      {!loading && run ? (
        <div className="admin-import-runner__status admin-import-runner__status--pending">
          <strong>Текущий запуск начался {formatDateTime(run.startedAt)}</strong>
          <span>Run ID: {run.id}</span>
        </div>
      ) : null}
    </GlassCard>
  );
}

function ImportRunHistorySummary({
  error,
  latestRun,
  loading,
  onOpen,
}: {
  error: string | null;
  latestRun: AdminImportRun | null;
  loading: boolean;
  onOpen: () => void;
}) {
  return (
    <GlassCard className="import-history-compact">
      <div className="import-history-compact__main">
        <div className="badge-row">
          <Badge tone="glass">Журнал импорта</Badge>
          {loading ? (
            <Badge tone="gold">Последний: проверяем</Badge>
          ) : error ? (
            <Badge tone="red">Журнал недоступен</Badge>
          ) : latestRun ? (
            <Badge tone={getAdminImportRunStatusTone(latestRun.status)}>
              Последний: {formatAdminImportRunStatusLabel(latestRun.status)}
            </Badge>
          ) : (
            <Badge tone="muted">Последний: нет запусков</Badge>
          )}
        </div>
        <span>
          {latestRun
            ? `${latestRun.sourceName ? `${latestRun.sourceName} · ` : ""}${formatDateTime(latestRun.startedAt)}`
            : "Последние запуски доступны в модальном окне."}
        </span>
      </div>
      <Button onClick={onOpen} size="sm" variant="secondary">
        Журнал импорта
      </Button>
    </GlassCard>
  );
}

function ImportRunHistoryModal({
  error,
  loading,
  onClose,
  onRefresh,
  runs,
}: {
  error: string | null;
  loading: boolean;
  onClose: () => void;
  onRefresh: () => void;
  runs: AdminImportRun[];
}) {
  const titleId = useId();

  return (
    <div
      className="import-history-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="import-history-modal"
        role="dialog"
      >
        <div className="import-history-modal__head">
          <div>
            <span>Журнал импорта</span>
            <h2 id={titleId}>Последние запуски</h2>
          </div>
          <button
            aria-label="Закрыть журнал импорта"
            className="import-history-modal__close"
            onClick={onClose}
            type="button"
          >
            X
          </button>
        </div>
        <div className="import-history-modal__body">
          <AdminImportRunHistory
            error={error}
            loading={loading}
            onRefresh={onRefresh}
            runs={runs}
          />
        </div>
      </section>
    </div>
  );
}

function ImportReviewBulkActions({
  deleting,
  onClear,
  onDelete,
  selectedCount,
}: {
  deleting: boolean;
  onClear: () => void;
  onDelete: () => void;
  selectedCount: number;
}) {
  if (selectedCount === 0) {
    return null;
  }

  return (
    <div className="import-review-bulk-actions" role="status">
      <strong>Выбрано {selectedCount}</strong>
      <div>
        <Button disabled={deleting} onClick={onDelete} size="sm" variant="secondary">
          {deleting ? "Удаляем..." : "Удалить выбранные из очереди"}
        </Button>
        <Button disabled={deleting} onClick={onClear} size="sm" variant="ghost">
          Снять выбор
        </Button>
      </div>
    </div>
  );
}

function ImportReviewList({
  deletingItemIds,
  disabled,
  items,
  onDeleteItem,
  onOpenDetail,
  onOpenDraft,
  onToggleSelection,
  selectedItemIds,
}: {
  deletingItemIds: string[];
  disabled: boolean;
  items: AdminImportReviewItem[];
  onDeleteItem: (item: AdminImportReviewItem) => void;
  onOpenDetail: (itemId: string) => void;
  onOpenDraft: (itemId: string) => void;
  onToggleSelection: (itemId: string, checked: boolean) => void;
  selectedItemIds: Set<string>;
}) {
  return (
    <div className="import-review-list" aria-label="Элементы импорта на проверку">
      {items.map((item) => {
        const isSelected = selectedItemIds.has(item.id);
        const isDeleting = deletingItemIds.includes(item.id);
        const sourceDomain = getImportItemSourceDomain(item);

        return (
          <article
            className={
              isSelected
                ? "import-review-item import-review-item--selected"
                : "import-review-item"
            }
            key={item.id}
          >
            <label className="import-review-item__check">
              <input
                aria-label={`Выбрать ${getImportItemTitle(item)}`}
                checked={isSelected}
                disabled={disabled || isDeleting}
                onChange={(event) => onToggleSelection(item.id, event.target.checked)}
                type="checkbox"
              />
            </label>

            <ImportReviewItemThumbnail item={item} />

            <div className="import-review-item__main">
              <div className="badge-row">
                <Badge tone={getStatusTone(item.status)}>
                  {formatImportStatusLabel(item.status)}
                </Badge>
                <Badge tone={getDateQualityTone(getDateQuality(item))}>
                  {formatDateQualityLabel(getDateQuality(item))}
                </Badge>
                <ImportDedupeBadge dedupe={getImportDedupe(item)} />
                {item.linkedEventId ? <Badge tone="green">Связано</Badge> : null}
              </div>
              <h3>{getImportItemTitle(item)}</h3>
              {sourceDomain ? <span>{sourceDomain}</span> : null}
            </div>

            <div className="import-review-item__actions">
              <Button
                disabled={disabled || isDeleting}
                onClick={() => onOpenDraft(item.id)}
                size="sm"
                variant="primary"
              >
                Редактировать
              </Button>
              <Button
                disabled={disabled || isDeleting}
                onClick={() => onOpenDetail(item.id)}
                size="sm"
                variant="secondary"
              >
                Подробнее
              </Button>
              <Button
                disabled={disabled || isDeleting}
                onClick={() => onDeleteItem(item)}
                size="sm"
                variant="ghost"
              >
                {isDeleting ? "Удаляем..." : "Удалить"}
              </Button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function ImportReviewItemThumbnail({ item }: { item: AdminImportReviewItem }) {
  const rawDetails = getRawPayloadDetails(item.rawPayload);
  const title = getImportItemTitle(item);

  if (!rawDetails.imageUrl) {
    return (
      <div className="import-review-thumb import-review-thumb--empty" aria-label="Изображения нет">
        <span>Нет фото</span>
      </div>
    );
  }

  return (
    <a
      className="import-review-thumb"
      href={rawDetails.imageUrl}
      rel="noreferrer"
      target="_blank"
    >
      <img alt={title} loading="lazy" src={rawDetails.imageUrl} />
    </a>
  );
}

function isRecentStartedImportRun(run: AdminImportRun): boolean {
  if (run.status !== "started") {
    return false;
  }

  const startedAt = new Date(run.startedAt).getTime();

  if (Number.isNaN(startedAt)) {
    return true;
  }

  return Date.now() - startedAt <= RECENT_STARTED_IMPORT_RUN_MS;
}

function ImportItemDetailDrawer({
  error,
  fallbackItem,
  initialMode,
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
  initialMode: ImportDetailInitialMode;
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
  const title = displayItem ? getImportItemTitle(displayItem) : "Элемент импорта";
  const isAdminIgnored = displayItem ? isAdminIgnoredImportItem(displayItem) : false;
  const isSafeIgnoredByImporter =
    displayItem?.status === "ignored" && !isAdminIgnored;

  useEffect(() => {
    setIsConfirmingIgnore(false);
    setIgnoreReason("");
    setIgnoreError(null);
    setIgnoreLoading(false);
    setIsCreatingDraft(initialMode === "draft");
    setDraftSubmitting(false);
    setDraftError(null);
    setDraftResult(null);
  }, [initialMode, item?.id]);

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
          : "Не удалось удалить элемент импорта из очереди через admin_ignore_import_item.",
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
              <Badge tone="gold">Детали проверки</Badge>
              <Badge tone="glass">admin_get_import_item</Badge>
              <ImportDedupeBadge dedupe={displayItem ? getImportDedupe(displayItem) : null} />
              {isAdminIgnored ? <Badge tone="muted">Удалён из очереди админом</Badge> : null}
              {isSafeIgnoredByImporter ? (
                <Badge tone="gold">Скрыт импортёром</Badge>
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
              description="Вызываем admin_get_import_item и ждём полные данные элемента импорта."
              title="Загрузка деталей"
            />
          ) : error ? (
            <ImportReviewState description={error} title="Не удалось загрузить детали">
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
              description="RPC не вернул данные для выбранного элемента импорта."
              title="Детали пусты"
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
  const dedupe = getImportDedupe(item);

  if (isAdminIgnored) {
    return (
      <section className="import-detail-actions import-detail-actions--ignored">
        <div className="import-detail-actions__head">
          <div>
            <h3>Элемент уже удалён из очереди</h3>
            <p>Эти данные пришли из `raw_payload.adminReview`.</p>
          </div>
          <Badge tone="muted">Удалён из очереди</Badge>
        </div>
        <div className="import-detail-grid">
          <ImportReviewField
            label="Когда удалён"
            value={formatDateTimeDetail(adminReview.ignoredAt)}
          />
          <ImportReviewField
            label="Кем удалён"
            value={adminReview.ignoredBy ?? "Не указано"}
          />
          <ImportReviewField
            label="Причина"
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
            <p>Элемент импорта уже связан с записью в events. Повторное создание недоступно.</p>
          </div>
          <Badge tone="green">Связано</Badge>
        </div>
        <div className="import-detail-grid">
          <ImportReviewField
            label="ID события"
            value={linkedEventId ?? "ID связанного события не вернулся"}
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
      <ImportDedupeActionNotice dedupe={dedupe} />
      <div className="import-detail-actions__head">
        <div>
          <h3>Действия</h3>
          <p>
            Можно создать событие как скрытый черновик или скрыть элемент из очереди
            проверки без создания события.
          </p>
          {isSafeIgnoredByImporter ? (
            <div className="badge-row">
              <Badge tone="gold">Скрыт импортёром</Badge>
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
            Удалить из очереди
          </Button>
        </div>
      </div>

      {isConfirmingIgnore ? (
        <div className="import-ignore-confirm">
          <div className="import-ignore-confirm__summary">
            <strong>{title}</strong>
            <span>
              Ссылка источника:{" "}
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
              {ignoreLoading ? "Удаляем..." : "Удалить из очереди"}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ImportDedupeActionNotice({ dedupe }: { dedupe: AdminImportDedupe | null }) {
  if (!dedupe) {
    return null;
  }

  if (dedupe.status === "possible_duplicate") {
    return (
      <div className="import-dedupe-warning import-dedupe-warning--possible" role="alert">
        <strong>Возможный дубль — проверьте перед созданием события.</strong>
        <p>{formatDedupeReason(dedupe)}</p>
      </div>
    );
  }

  if (dedupe.status === "duplicate") {
    return (
      <div className="import-dedupe-warning import-dedupe-warning--duplicate" role="alert">
        <strong>Дубль — новое событие не нужно публиковать автоматически.</strong>
        <p>{formatDedupeReason(dedupe)}</p>
      </div>
    );
  }

  if (dedupe.status === "manual_override_skipped") {
    return (
      <div className="import-dedupe-warning import-dedupe-warning--manual" role="status">
        <strong>Существующее событие защищено ручной правкой.</strong>
        <p>
          Import item пропущен, чтобы не перетереть manual override.{" "}
          {formatDedupeReason(dedupe)}
        </p>
      </div>
    );
  }

  if (dedupe.status === "error") {
    return (
      <div className="import-dedupe-warning import-dedupe-warning--error" role="alert">
        <strong>Ошибка контроля дублей.</strong>
        <p>{formatDedupeReason(dedupe)}</p>
      </div>
    );
  }

  return null;
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
          <Badge tone="gold">{getEventStatusLabel(event?.status ?? "draft")}</Badge>
          <Badge tone="muted">{getEventVisibilityLabel(event?.visibility ?? "hidden")}</Badge>
        </div>
      </div>

      <div className="import-detail-grid">
        {event ? <ImportReviewField label="Название" value={event.title} /> : null}
        <ImportReviewField label="ID события" value={linkedEventId ?? "Не указано"} />
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
  const communityId = item.communityId ?? "";
  const [categories, setCategories] = useState<AdminEventCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);

  const loadCategories = useCallback(async () => {
    if (!communityId) {
      setCategories([]);
      setCategoriesLoading(false);
      setCategoriesError(null);
      return;
    }

    setCategoriesLoading(true);
    setCategoriesError(null);

    try {
      const nextCategories = await listAdminEventCategories(communityId);
      setCategories(nextCategories);
    } catch (error) {
      setCategories([]);
      setCategoriesError(
        error instanceof Error
          ? error.message
          : "?? ??????? ????????? ????????? ???????.",
      );
    } finally {
      setCategoriesLoading(false);
    }
  }, [communityId]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  return (
    <section className="import-draft-form-panel">
      <div className="import-draft-form-panel__head">
        <div>
          <Badge tone="gold">Черновик / скрыто</Badge>
          <h3>Создать событие из импорта</h3>
        </div>
      </div>

      <EventForm
        categories={categories}
        categoriesError={categoriesError}
        categoriesLoading={categoriesLoading}
        cancelLabel="Вернуться к деталям"
        forceDraftHidden
        initialEvent={prefill.event}
        mode="create"
        notice={<ImportDraftFormNotice prefill={prefill} />}
        onCancel={onCancel}
        onSubmit={onSubmit}
        showEventKind={false}
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
          Варианты участия можно настроить после создания черновика события.
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
          <strong>Ссылка регистрации взята из sourceUrl элемента импорта.</strong>
          <p>Проверьте, что эта ссылка действительно ведёт на внешнюю регистрацию.</p>
        </div>
      ) : null}

      {prefill.paidHint ? (
        <div className="import-draft-notice import-draft-notice--warning">
          <strong>Похоже на платное событие.</strong>
          <p>
            Платная внутренняя регистрация не выбирается автоматически. Сейчас можно создать черновик
            без вариантов участия и настроить их после создания.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function ImportItemDetailContent({ item }: { item: AdminImportReviewItem }) {
  const review = item.importReview;
  const dedupe = getImportDedupe(item);
  const rawDetails = getRawPayloadDetails(item.rawPayload);
  const needsReview = review?.needsReview ?? review?.reviewNeeded ?? null;

  return (
    <>
      <ImportDedupePanel dedupe={dedupe} />

      <section className="import-detail-section">
        <h3>Основное</h3>
        <div className="import-detail-grid">
          <ImportReviewField
            label="Название"
            value={rawDetails.title ?? item.parsedTitle ?? "Не указано"}
          />
          <ImportReviewField label="Распознанное название" value={item.parsedTitle || "Не указано"} />
          <ImportReviewField label="Статус" value={formatImportStatusLabel(item.status)} />
          <ImportReviewField
            label="Уверенность даты"
            value={formatDateQualityLabel(review?.dateConfidence)}
          />
          <ImportReviewField label="Статус даты" value={review?.dateStatus ?? "Не указано"} />
          <ImportReviewField label="Требует проверки" value={formatBooleanValue(needsReview)} />
          <ImportReviewField label="Причина" value={review?.reason ?? "Не указано"} wide />
          <ImportReviewField label="Заметки" value={review?.notes ?? "Не указано"} wide />
        </div>
      </section>

      <section className="import-detail-section">
        <h3>Дата и место</h3>
        <div className="import-detail-grid">
          <ImportReviewField label="Исходная дата" value={review?.rawDateText ?? "Не указано"} />
          <ImportReviewField label="Исходное время" value={review?.rawTimeText ?? "Не указано"} />
          <ImportReviewField
            label="Предложенное начало"
            value={formatDateTimeDetail(review?.suggestedStartsAt ?? null)}
          />
          <ImportReviewField
            label="Распознанное начало"
            value={formatDateTimeDetail(item.parsedStartsAt)}
          />
          <ImportReviewField
            label="Распознанное место"
            value={item.parsedLocation || "Не указано"}
            wide
          />
        </div>
      </section>

      <section className="import-detail-section">
        <h3>Источник</h3>
        <div className="import-detail-grid">
          <ImportReviewField label="Название источника" value={item.sourceName || "Не указано"} />
          <ImportReviewField label="Внешний ID" value={item.externalId || "Не указано"} />
          <ImportReviewField label="Создано" value={formatDateTimeDetail(item.createdAt)} />
          {item.linkedEventId ? (
            <ImportReviewField label="ID события" value={item.linkedEventId} />
          ) : null}
          <ImportReviewField label="Ссылка источника" wide>
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
        <h3>Поля raw payload</h3>
        {rawDetails.imageUrl ? (
          <figure className="import-detail-image">
            <img
              alt={item.parsedTitle || "Изображение элемента импорта"}
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
          <ImportReviewField label="Ссылка регистрации" wide>
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
            label="Описание"
            value={rawDetails.description ?? "Не указано"}
            wide
          />
          <ImportReviewField
            label="Краткое описание"
            value={rawDetails.shortDescription ?? "Не указано"}
            wide
          />
        </div>
        <details className="import-review-meta import-review-meta--detail">
          <summary>Raw payload</summary>
          <pre>{formatRawPayloadFull(item.rawPayload)}</pre>
        </details>
      </section>
    </>
  );
}

function ImportDedupePanel({ dedupe }: { dedupe: AdminImportDedupe | null }) {
  return (
    <section className="import-dedupe-panel">
      <div className="import-dedupe-panel__head">
        <h3>Контроль дублей</h3>
        <ImportDedupeBadge dedupe={dedupe} />
      </div>

      {!dedupe ? (
        <div className="import-dedupe-warning import-dedupe-warning--unchecked" role="status">
          <strong>Не проверено.</strong>
          <p>
            В `raw_payload.importReview.dedupe` нет объекта dedupe. Старые import items
            могут оставаться в таком состоянии до следующей проверки.
          </p>
        </div>
      ) : (
        <>
          <ImportDedupeActionNotice dedupe={dedupe} />
          <div className="import-dedupe-panel__grid">
            <ImportDedupeRow label="Статус" value={getImportDedupeStatusLabel(dedupe.status)} />
            <ImportDedupeRow label="matchedBy" value={formatDedupeMatchedBy(dedupe)} />
            <ImportDedupeRow label="manualOverride" value={formatBooleanValue(dedupe.manualOverride)} />
            <ImportDedupeRow label="checkedAt" value={formatDateTimeDetail(dedupe.checkedAt)} />
            <ImportDedupeRow label="reason" value={formatDedupeReason(dedupe)} wide />
            <ImportDedupeRow
              label="matchedEventId"
              value={dedupe.matchedEventId ?? "Не указано"}
            />
            <ImportDedupeRow
              label="matchedImportItemId"
              value={dedupe.matchedImportItemId ?? "Не указано"}
            />
            <ImportDedupeRow
              label="sourceExternalId"
              value={dedupe.sourceExternalId ?? "Не указано"}
            />
            <ImportDedupeRow label="canonicalSourceUrl" wide>
              {dedupe.canonicalSourceUrl ? (
                <a
                  className="import-review-link"
                  href={dedupe.canonicalSourceUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  {dedupe.canonicalSourceUrl}
                </a>
              ) : (
                "Не указано"
              )}
            </ImportDedupeRow>
            <ImportDedupeRow label="contentHash" value={dedupe.contentHash ?? "Не указано"} wide />
            <ImportDedupeRow label="version" value={String(dedupe.version)} />
          </div>
        </>
      )}
    </section>
  );
}

function ImportDedupeRow({
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
    <div className={wide ? "import-dedupe-row import-dedupe-row--wide" : "import-dedupe-row"}>
      <span>{label}</span>
      <strong>{children ?? value ?? "Не указано"}</strong>
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

function getImportItemSourceDomain(item: AdminImportReviewItem): string | null {
  if (!item.sourceUrl) {
    return item.sourceName ?? null;
  }

  try {
    const host = new URL(item.sourceUrl).hostname.replace(/^www\./, "");

    return host || item.sourceName || item.sourceUrl;
  } catch {
    return item.sourceName || item.sourceUrl;
  }
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
    eventKind: "single",
    title,
    subtitle: rawDetails.subtitle,
    description: rawDetails.description,
    shortDescription: rawDetails.shortDescription,
    startsAt,
    endsAt: rawDetails.endsAt,
    isPermanent: false,
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

function getImportDedupe(item: AdminImportReviewItem): AdminImportDedupe | null {
  return normalizeImportDedupeValue(readJsonPath(item.rawPayload, ["importReview", "dedupe"]));
}

function normalizeImportDedupeValue(value: JsonValue | undefined): AdminImportDedupe | null {
  if (!isJsonObject(value) || !isImportDedupeStatus(value.status)) {
    return null;
  }

  const version = normalizeDedupeVersion(value.version);

  if (version !== 1) {
    return null;
  }

  return {
    version: 1,
    status: value.status,
    reason: normalizeDedupeString(value.reason),
    matchedBy: normalizeDedupeMatchedBy(value.matchedBy),
    matchedEventId: normalizeDedupeString(value.matchedEventId),
    matchedImportItemId: normalizeDedupeString(value.matchedImportItemId),
    manualOverride: normalizeDedupeBoolean(value.manualOverride) ?? false,
    contentHash: normalizeDedupeString(value.contentHash),
    canonicalSourceUrl: normalizeDedupeString(value.canonicalSourceUrl),
    sourceExternalId: normalizeDedupeString(value.sourceExternalId),
    checkedAt: normalizeDedupeString(value.checkedAt),
  };
}

function isImportDedupeStatus(value: JsonValue | undefined): value is AdminImportDedupe["status"] {
  return (
    typeof value === "string" &&
    (ADMIN_IMPORT_DEDUPE_STATUSES as readonly string[]).includes(value)
  );
}

function normalizeDedupeMatchedBy(value: JsonValue | undefined): AdminImportDedupe["matchedBy"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is AdminImportDedupe["matchedBy"][number] =>
      typeof item === "string" &&
      (ADMIN_IMPORT_DEDUPE_MATCHED_BY as readonly string[]).includes(item),
  );
}

function normalizeDedupeString(value: JsonValue | undefined): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return null;
}

function normalizeDedupeBoolean(value: JsonValue | undefined): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["true", "1", "yes"].includes(normalized)) {
      return true;
    }

    if (["false", "0", "no"].includes(normalized)) {
      return false;
    }
  }

  return null;
}

function normalizeDedupeVersion(value: JsonValue | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function formatDedupeReason(dedupe: AdminImportDedupe): string {
  return dedupe.reason?.trim() || "Причина не указана.";
}

function formatDedupeMatchedBy(dedupe: AdminImportDedupe): string {
  return dedupe.matchedBy.length > 0 ? dedupe.matchedBy.join(", ") : "Нет совпадений";
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

  return value ? "Да" : "Нет";
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

function formatRawPayloadFull(value: JsonValue): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "Не удалось отобразить raw_payload.";
  }
}

function isImportStatus(value: string): value is AdminImportItemStatus {
  return (ADMIN_IMPORT_ITEM_STATUSES as readonly string[]).includes(value);
}

function formatImportStatusLabel(status: string | null | undefined): string {
  if (!status) {
    return "Неизвестно";
  }

  return isImportStatus(status) ? IMPORT_STATUS_LABELS[status] : status;
}

function isDateQuality(value: string): value is AdminImportDateQuality {
  return (ADMIN_IMPORT_DATE_QUALITIES as readonly string[]).includes(value);
}

function formatDateQualityLabel(dateQuality: string | null | undefined): string {
  if (!dateQuality) {
    return "Качество даты неизвестно";
  }

  return isDateQuality(dateQuality) ? DATE_QUALITY_LABELS[dateQuality] : dateQuality;
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
