import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { GlassCard } from "../components/ui/GlassCard";
import { getAdminApiProvider } from "../services/apiClient";
import {
  createAdminEventCategory,
  deleteAdminEventCategory,
  listAdminEventCategories,
  listEventCategoryUsageCounts,
  updateAdminEventCategory,
} from "../services/eventCategoriesService";
import { useAdminAuth } from "../store/useAdminAuth";
import type {
  AdminEventCategory,
  AdminEventCategoryMutationInput,
} from "../types/eventCategories";
import type { AdminBadgeTone } from "../types/admin";

type DialogMode = "create" | "edit";

type DialogState = {
  mode: DialogMode;
  category: AdminEventCategory | null;
};

type FormState = {
  slug: string;
  title: string;
  description: string;
  color: string;
  icon: string;
  sortOrder: string;
  isActive: boolean;
};

type FormErrors = Partial<Record<keyof FormState | "form", string>>;

const DEFAULT_COLOR = "#7B68EE";
const DEFAULT_ICON = "✡️";
const DEFAULT_SORT_ORDER = "100";

const SLUG_REGEX = /^[a-z0-9][a-z0-9_]{1,63}$/;
const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

const COMMUNITY_ID_ERROR =
  "Не удалось определить communityId текущей активной membership.";

export function CategoriesPage() {
  const auth = useAdminAuth();
  const communityId = auth.membership?.community_id ?? null;
  const categoriesProvider = getAdminApiProvider("events");
  const isCategoriesApiProvider = categoriesProvider === "api";
  const categoriesProviderLabel = isCategoriesApiProvider ? "API" : "Supabase";
  const categoriesProviderTone: AdminBadgeTone = isCategoriesApiProvider ? "blue" : "green";
  const categoriesToolbarDescription = isCategoriesApiProvider
    ? "Список, создание и редактирование категорий идут через Python API event categories endpoints."
    : "Управление через Supabase RPC admin_create_event_category / admin_update_event_category / admin_delete_event_category.";
  const categoriesLoadingDescription = isCategoriesApiProvider
    ? "Читаем категории через Python API event categories endpoint."
    : "Читаем Supabase event_categories через admin_list_event_categories.";
  const categoriesEmptyDescription = isCategoriesApiProvider
    ? "API event categories endpoint вернул пустой список. Создайте первую категорию через кнопку «Добавить категорию»."
    : "Supabase event_categories пока пуст. Создайте первую категорию через кнопку «Добавить категорию».";
  const categoriesLoadErrorMessage = isCategoriesApiProvider
    ? "Не удалось загрузить категории через API event categories endpoint."
    : "Не удалось загрузить категории из Supabase.";

  const [categories, setCategories] = useState<AdminEventCategory[]>([]);
  const [usageCounts, setUsageCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AdminEventCategory | null>(null);
  const [actionInFlight, setActionInFlight] = useState(false);

  const reload = useCallback(async () => {
    if (!communityId) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [nextCategories, nextCounts] = await Promise.all([
        listAdminEventCategories(communityId),
        listEventCategoryUsageCounts(communityId).catch(() => ({}) as Record<string, number>),
      ]);
      setCategories(nextCategories);
      setUsageCounts(nextCounts);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : categoriesLoadErrorMessage,
      );
    } finally {
      setLoading(false);
    }
  }, [categoriesLoadErrorMessage, communityId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleOpenCreate = () => {
    setSuccessMessage(null);
    setDialog({ mode: "create", category: null });
  };

  const handleOpenEdit = (category: AdminEventCategory) => {
    setSuccessMessage(null);
    setDialog({ mode: "edit", category });
  };

  const handleDialogClose = () => {
    if (actionInFlight) return;
    setDialog(null);
  };

  const handleSubmit = async (input: AdminEventCategoryMutationInput) => {
    if (!communityId) {
      return false;
    }

    setActionInFlight(true);

    try {
      if (dialog?.mode === "create") {
        const created = await createAdminEventCategory({
          communityId,
          ...input,
        });
        setSuccessMessage(`Категория «${created.title}» создана.`);
      } else if (dialog?.mode === "edit" && dialog.category) {
        const updated = await updateAdminEventCategory(dialog.category.id, input);
        setSuccessMessage(`Категория «${updated.title}» обновлена.`);
      }

      setDialog(null);
      await reload();
      return true;
    } catch (nextError) {
      throw nextError;
    } finally {
      setActionInFlight(false);
    }
  };

  const handleRequestDelete = (category: AdminEventCategory) => {
    setSuccessMessage(null);
    setPendingDelete(category);
  };

  const handleCancelDelete = () => {
    if (actionInFlight) return;
    setPendingDelete(null);
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;

    setActionInFlight(true);
    setError(null);

    try {
      const result = await deleteAdminEventCategory(
        pendingDelete.id,
        pendingDelete.isActive,
      );

      setPendingDelete(null);
      setSuccessMessage(
        result.archived
          ? `Категория «${result.category.title}» используется в событиях и переведена в архив.`
          : `Категория «${result.category.title}» удалена.`,
      );
      await reload();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Не удалось удалить категорию.",
      );
    } finally {
      setActionInFlight(false);
    }
  };

  const dialogUsageCount = useMemo(() => {
    if (!dialog?.category) return 0;
    return usageCounts[dialog.category.slug] ?? 0;
  }, [dialog, usageCounts]);

  const pendingDeleteUsage = pendingDelete ? usageCounts[pendingDelete.slug] ?? 0 : 0;

  if (!communityId) {
    return (
      <div className="page-stack">
        <section className="page-header">
          <Badge tone="red">no community</Badge>
          <h1>Категории</h1>
          <p>{COMMUNITY_ID_ERROR}</p>
        </section>
      </div>
    );
  }

  return (
    <div className="page-stack page-stack--events">
      <section className="page-header">
        <Badge tone={categoriesProviderTone}>{categoriesProviderLabel}</Badge>
        <h1>Категории</h1>
        <p>
          Справочник рубрик событий вашей общины. Эти категории используются и в
          мобильном приложении (название, цвет, иконка, chips-фильтры), и в форме
          создания события.
        </p>
      </section>

      <GlassCard className="events-toolbar">
        <div className="events-toolbar__top">
          <div>
            <h2>Список категорий</h2>
            <p>{categoriesToolbarDescription}</p>
          </div>
          <div className="events-toolbar__actions">
            <Button onClick={handleOpenCreate} variant="primary">
              Добавить категорию
            </Button>
            <Button disabled={loading} onClick={reload}>
              {loading ? "Обновляем..." : "Обновить"}
            </Button>
          </div>
        </div>
      </GlassCard>

      {error ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}

      {successMessage ? (
        <div className="events-action-feedback" role="status">
          {successMessage}
        </div>
      ) : null}

      <GlassCard className="table-panel" elevated>
        <div className="table-panel__header">
          <h2>Категории общины</h2>
          <div className="events-summary">
            <span>{categories.length} записей</span>
            <Badge tone="glass">{categoriesProviderLabel}</Badge>
          </div>
        </div>

        {loading ? (
          <div className="events-state" role="status">
            <h3>Загрузка категорий</h3>
            <p>{categoriesLoadingDescription}</p>
          </div>
        ) : categories.length === 0 ? (
          <div className="events-state" role="status">
            <h3>Категорий пока нет</h3>
            <p>{categoriesEmptyDescription}</p>
          </div>
        ) : (
          <div className="events-table-scroll">
            <div
              className="data-table"
              role="table"
              aria-label="Категории событий"
              style={{ ["--data-table-columns" as string]: "8" }}
            >
              <div className="data-table__row data-table__row--head" role="row">
                <span role="columnheader">Иконка</span>
                <span role="columnheader">Название</span>
                <span role="columnheader">Slug</span>
                <span role="columnheader">Цвет</span>
                <span role="columnheader">Порядок</span>
                <span role="columnheader">Статус</span>
                <span role="columnheader">Используется</span>
                <span role="columnheader">Действия</span>
              </div>

              {categories.map((category) => {
                const usage = usageCounts[category.slug] ?? 0;

                return (
                  <div
                    className="data-table__row"
                    key={category.id}
                    role="row"
                  >
                    <span role="cell" style={{ fontSize: 22 }}>
                      {category.icon}
                    </span>
                    <span role="cell">{category.title}</span>
                    <span role="cell">
                      <code>{category.slug}</code>
                    </span>
                    <span role="cell">
                      <span
                        aria-hidden="true"
                        style={{
                          display: "inline-block",
                          width: 14,
                          height: 14,
                          borderRadius: 4,
                          background: category.color,
                          marginRight: 8,
                          verticalAlign: "middle",
                          border: "1px solid rgba(255,255,255,0.2)",
                        }}
                      />
                      <code>{category.color}</code>
                    </span>
                    <span role="cell">{category.sortOrder}</span>
                    <span role="cell">
                      <Badge tone={category.isActive ? "green" : "muted"}>
                        {category.isActive ? "active" : "archived"}
                      </Badge>
                    </span>
                    <span role="cell">
                      {usage > 0 ? `${usage} событий` : "не используется"}
                    </span>
                    <span role="cell" className="badge-row">
                      <Button
                        onClick={() => handleOpenEdit(category)}
                        size="sm"
                        type="button"
                      >
                        Редактировать
                      </Button>
                      <Button
                        onClick={() => handleRequestDelete(category)}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        Удалить
                      </Button>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </GlassCard>

      {dialog ? (
        <CategoryDialog
          actionInFlight={actionInFlight}
          mode={dialog.mode}
          initialCategory={dialog.category}
          onClose={handleDialogClose}
          onSubmit={handleSubmit}
          usageCount={dialogUsageCount}
        />
      ) : null}

      {pendingDelete ? (
        <DeleteCategoryDialog
          actionInFlight={actionInFlight}
          category={pendingDelete}
          onCancel={handleCancelDelete}
          onConfirm={handleConfirmDelete}
          usageCount={pendingDeleteUsage}
        />
      ) : null}
    </div>
  );
}

function CategoryDialog({
  actionInFlight,
  initialCategory,
  mode,
  onClose,
  onSubmit,
  usageCount,
}: {
  actionInFlight: boolean;
  initialCategory: AdminEventCategory | null;
  mode: DialogMode;
  onClose: () => void;
  onSubmit: (input: AdminEventCategoryMutationInput) => Promise<boolean>;
  usageCount: number;
}) {
  const [form, setForm] = useState<FormState>(() => buildInitialForm(initialCategory));
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const slugReadOnly = mode === "edit" && usageCount > 0;

  const updateField = <Field extends keyof FormState>(
    field: Field,
    value: FormState[Field],
  ) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const validation = validateForm(form);
    setErrors(validation.errors);
    setSubmitError(null);

    if (!validation.input) {
      return;
    }

    try {
      await onSubmit(validation.input);
    } catch (nextError) {
      setSubmitError(
        nextError instanceof Error
          ? nextError.message
          : "Не удалось сохранить категорию.",
      );
    }
  };

  return (
    <div
      className="event-action-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !actionInFlight) {
          onClose();
        }
      }}
    >
      <section
        aria-labelledby="category-dialog-title"
        aria-modal="true"
        className="event-action-dialog"
        role="dialog"
      >
        <div className="event-action-dialog__head">
          <div>
            <Badge tone="blue">{mode === "create" ? "create" : "edit"}</Badge>
            <h2 id="category-dialog-title">
              {mode === "create" ? "Новая категория" : "Редактирование категории"}
            </h2>
          </div>
          <Button disabled={actionInFlight} onClick={onClose} variant="ghost">
            Закрыть
          </Button>
        </div>

        <form className="event-create-form" noValidate onSubmit={handleSubmit}>
          {submitError ? (
            <div className="form-error" role="alert">
              {submitError}
            </div>
          ) : null}

          {slugReadOnly ? (
            <div className="event-form-notice">
              Slug нельзя изменить: эта категория уже используется в событиях.
              Чтобы переименовать рубрику, отредактируйте только название.
            </div>
          ) : null}

          <div className="event-form-grid event-form-grid--two">
            <label className="event-form-field">
              <span>Название *</span>
              <input
                aria-invalid={Boolean(errors.title)}
                onChange={(event) => updateField("title", event.target.value)}
                value={form.title}
              />
              {errors.title ? <small>{errors.title}</small> : null}
            </label>

            <label className="event-form-field">
              <span>Slug *</span>
              <input
                aria-invalid={Boolean(errors.slug)}
                onChange={(event) => updateField("slug", event.target.value)}
                placeholder="например, lecture"
                readOnly={slugReadOnly}
                value={form.slug}
              />
              {errors.slug ? (
                <small>{errors.slug}</small>
              ) : (
                <small>{`Латиница, цифры и _, длина 2-64.`}</small>
              )}
            </label>

            <label className="event-form-field event-form-field--wide">
              <span>Описание</span>
              <textarea
                onChange={(event) => updateField("description", event.target.value)}
                value={form.description}
              />
            </label>

            <label className="event-form-field">
              <span>Иконка *</span>
              <input
                aria-invalid={Boolean(errors.icon)}
                maxLength={8}
                onChange={(event) => updateField("icon", event.target.value)}
                placeholder="например, 📚"
                value={form.icon}
              />
              {errors.icon ? <small>{errors.icon}</small> : null}
            </label>

            <label className="event-form-field">
              <span>Цвет HEX *</span>
              <input
                aria-invalid={Boolean(errors.color)}
                onChange={(event) => updateField("color", event.target.value)}
                placeholder="#RRGGBB"
                value={form.color}
              />
              {errors.color ? <small>{errors.color}</small> : null}
            </label>

            <label className="event-form-field">
              <span>Порядок сортировки *</span>
              <input
                aria-invalid={Boolean(errors.sortOrder)}
                onChange={(event) => updateField("sortOrder", event.target.value)}
                type="number"
                value={form.sortOrder}
              />
              {errors.sortOrder ? <small>{errors.sortOrder}</small> : null}
            </label>

            <label className="event-form-check">
              <input
                checked={form.isActive}
                onChange={(event) => updateField("isActive", event.target.checked)}
                type="checkbox"
              />
              <span>Активна</span>
            </label>
          </div>

          {errors.form ? (
            <div className="form-error" role="alert">
              {errors.form}
            </div>
          ) : null}

          <div className="event-create-actions">
            <Button disabled={actionInFlight} onClick={onClose} variant="ghost">
              Отмена
            </Button>
            <Button disabled={actionInFlight} type="submit" variant="primary">
              {actionInFlight
                ? "Сохраняем..."
                : mode === "create"
                  ? "Создать"
                  : "Сохранить"}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}

function DeleteCategoryDialog({
  actionInFlight,
  category,
  onCancel,
  onConfirm,
  usageCount,
}: {
  actionInFlight: boolean;
  category: AdminEventCategory;
  onCancel: () => void;
  onConfirm: () => void;
  usageCount: number;
}) {
  const isUsed = usageCount > 0;

  return (
    <div
      className="event-action-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !actionInFlight) {
          onCancel();
        }
      }}
    >
      <section
        aria-labelledby="delete-category-dialog-title"
        aria-modal="true"
        className="event-action-dialog"
        role="dialog"
      >
        <div className="event-action-dialog__head">
          <div>
            <Badge tone="red">delete</Badge>
            <h2 id="delete-category-dialog-title">Удалить категорию</h2>
          </div>
          <Button disabled={actionInFlight} onClick={onCancel} variant="ghost">
            Закрыть
          </Button>
        </div>

        <div className="event-action-dialog__event">
          <span>Категория</span>
          <strong>
            {category.icon} {category.title} ({category.slug})
          </strong>
        </div>

        <div className="event-action-dialog__notice">
          {isUsed ? (
            <p>
              Категория используется в событиях ({usageCount}). Она будет
              архивирована, а не удалена. Старые события продолжат корректно
              отображаться, но новые события не смогут её выбрать.
            </p>
          ) : (
            <p>
              Категория не используется ни в одном событии. Она будет удалена
              физически.
            </p>
          )}
        </div>

        <div className="event-action-dialog__actions">
          <Button disabled={actionInFlight} onClick={onCancel} variant="secondary">
            Отмена
          </Button>
          <Button disabled={actionInFlight} onClick={onConfirm} variant="primary">
            {actionInFlight ? "Удаляем..." : isUsed ? "Архивировать" : "Удалить"}
          </Button>
        </div>
      </section>
    </div>
  );
}

function buildInitialForm(category: AdminEventCategory | null): FormState {
  if (!category) {
    return {
      slug: "",
      title: "",
      description: "",
      color: DEFAULT_COLOR,
      icon: DEFAULT_ICON,
      sortOrder: DEFAULT_SORT_ORDER,
      isActive: true,
    };
  }

  return {
    slug: category.slug,
    title: category.title,
    description: category.description ?? "",
    color: category.color,
    icon: category.icon,
    sortOrder: String(category.sortOrder),
    isActive: category.isActive,
  };
}

function validateForm(
  form: FormState,
): { errors: FormErrors; input: AdminEventCategoryMutationInput | null } {
  const errors: FormErrors = {};

  const title = form.title.trim();
  const slug = form.slug.trim().toLowerCase();
  const description = form.description.trim();
  const color = form.color.trim();
  const icon = form.icon.trim();
  const sortOrderText = form.sortOrder.trim();

  if (!title) errors.title = "Укажите название.";
  if (!slug) {
    errors.slug = "Укажите slug.";
  } else if (!SLUG_REGEX.test(slug)) {
    errors.slug = "Slug: латиница, цифры, _, длина 2-64, начинается с буквы или цифры.";
  }
  if (!color) {
    errors.color = "Укажите цвет.";
  } else if (!HEX_COLOR_REGEX.test(color)) {
    errors.color = "Цвет должен быть в формате #RRGGBB.";
  }
  if (!icon) errors.icon = "Укажите иконку.";

  let sortOrder = 100;
  if (!sortOrderText) {
    errors.sortOrder = "Укажите порядок сортировки.";
  } else if (!/^-?\d+$/.test(sortOrderText)) {
    errors.sortOrder = "Порядок должен быть целым числом.";
  } else {
    sortOrder = Number(sortOrderText);
  }

  if (Object.keys(errors).length > 0) {
    return { errors, input: null };
  }

  return {
    errors,
    input: {
      slug,
      title,
      description: description || null,
      color,
      icon,
      sortOrder,
      isActive: form.isActive,
    },
  };
}
