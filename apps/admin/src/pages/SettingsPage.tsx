import { useCallback, useEffect, useState } from "react";

import { AdminHealthCheck } from "../components/settings/AdminHealthCheck";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { GlassCard } from "../components/ui/GlassCard";
import { getAdminCommunity } from "../services/adminCommunityService";
import {
  archiveAdminCommunityLocation,
  createAdminCommunityLocation,
  listAdminCommunityLocations,
  updateAdminCommunityLocation,
} from "../services/communityLocationsService";
import { isSupabaseConfigured } from "../services/supabaseClient";
import { useAdminAuth } from "../store/useAdminAuth";
import type { AdminCommunity } from "../types/community";
import type { AdminCommunityLocation } from "../types/communityLocations";

type LocationFormState = {
  title: string;
  address: string;
  sortOrder: string;
  isDefault: boolean;
  isActive: boolean;
};

type SettingsFactRow = {
  label: string;
  value: string;
  href?: string;
};

const defaultLocationForm: LocationFormState = {
  title: "",
  address: "",
  sortOrder: "100",
  isDefault: false,
  isActive: true,
};

export function SettingsPage() {
  const auth = useAdminAuth();
  const communityId = auth.membership?.community_id ?? null;
  const canManageLocations = auth.isAdmin && Boolean(communityId);
  const adminEnvLabel = getAdminEnvLabel();
  const supabaseHost = getSupabaseHost();
  const [community, setCommunity] = useState<AdminCommunity | null>(null);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [communityError, setCommunityError] = useState<string | null>(null);
  const [locations, setLocations] = useState<AdminCommunityLocation[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [locationsError, setLocationsError] = useState<string | null>(null);
  const [form, setForm] = useState<LocationFormState>(defaultLocationForm);
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null);
  const [savingLocation, setSavingLocation] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadCommunity = useCallback(async () => {
    if (!communityId) {
      setCommunity(null);
      setCommunityLoading(false);
      setCommunityError(null);
      return;
    }

    setCommunityLoading(true);
    setCommunityError(null);

    try {
      const nextCommunity = await getAdminCommunity(communityId);
      setCommunity(nextCommunity);
      if (!nextCommunity) {
        setCommunityError("Не удалось найти активную общину для текущей membership.");
      }
    } catch (error) {
      setCommunity(null);
      setCommunityError(
        error instanceof Error ? error.message : "Не удалось загрузить данные общины.",
      );
    } finally {
      setCommunityLoading(false);
    }
  }, [communityId]);

  const loadLocations = useCallback(async () => {
    if (!communityId) {
      setLocations([]);
      setLocationsLoading(false);
      setLocationsError(null);
      return;
    }

    setLocationsLoading(true);
    setLocationsError(null);

    try {
      const nextLocations = await listAdminCommunityLocations(communityId);
      setLocations(nextLocations);
    } catch (error) {
      setLocations([]);
      setLocationsError(
        error instanceof Error ? error.message : "Не удалось загрузить адреса общины.",
      );
    } finally {
      setLocationsLoading(false);
    }
  }, [communityId]);

  useEffect(() => {
    void loadCommunity();
  }, [loadCommunity]);

  useEffect(() => {
    void loadLocations();
  }, [loadLocations]);

  const resetLocationForm = () => {
    setForm(defaultLocationForm);
    setEditingLocationId(null);
    setFormError(null);
  };

  const editLocation = (location: AdminCommunityLocation) => {
    setForm({
      title: location.title,
      address: location.address,
      sortOrder: String(location.sortOrder),
      isDefault: location.isDefault,
      isActive: location.isActive,
    });
    setEditingLocationId(location.id);
    setFormError(null);
  };

  const saveLocation = async () => {
    setFormError(null);

    if (!communityId) {
      setFormError("Не удалось определить communityId текущей активной membership.");
      return;
    }

    if (!canManageLocations) {
      setFormError("Адресами общины может управлять только admin.");
      return;
    }

    const title = form.title.trim();
    const address = form.address.trim();
    const sortOrder = parseSortOrder(form.sortOrder);

    if (!title) {
      setFormError("Укажите название адреса.");
      return;
    }

    if (!address) {
      setFormError("Укажите адрес.");
      return;
    }

    if (sortOrder === null) {
      setFormError("Порядок сортировки должен быть целым числом.");
      return;
    }

    setSavingLocation(true);

    try {
      if (editingLocationId) {
        await updateAdminCommunityLocation(editingLocationId, {
          title,
          address,
          sortOrder,
          isDefault: form.isDefault,
          isActive: form.isActive,
        });
      } else {
        await createAdminCommunityLocation({
          communityId,
          title,
          address,
          sortOrder,
          isDefault: form.isDefault,
          isActive: true,
        });
      }

      resetLocationForm();
      await loadLocations();
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Не удалось сохранить адрес общины.",
      );
    } finally {
      setSavingLocation(false);
    }
  };

  const archiveLocation = async (location: AdminCommunityLocation) => {
    setFormError(null);

    if (!canManageLocations) {
      setFormError("Адресами общины может управлять только admin.");
      return;
    }

    const confirmed = window.confirm(`Архивировать адрес «${location.title}»?`);
    if (!confirmed) {
      return;
    }

    setSavingLocation(true);

    try {
      await archiveAdminCommunityLocation(location.id);
      if (editingLocationId === location.id) {
        resetLocationForm();
      }
      await loadLocations();
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Не удалось архивировать адрес общины.",
      );
    } finally {
      setSavingLocation(false);
    }
  };

  const communitySettingRows = buildCommunitySettingRows(community);
  const betaConnectionRows = buildBetaConnectionRows({
    adminEnvLabel,
    canAccessAdmin: auth.canAccessAdmin,
    communityId,
    isAuthenticated: auth.isAuthenticated,
    role: auth.role,
    supabaseHost,
  });

  return (
    <div className="page-stack page-stack--settings">
      <section className="page-header">
        <Badge tone="gold">settings beta</Badge>
        <h1>Settings</h1>
        <p>
          Beta-панель для текущей общины: реальные данные, существующие адреса и
          честный staging-контекст без mock-настроек.
        </p>
      </section>

      <GlassCard className="settings-section" elevated>
        <div className="settings-section__head">
          <div className="settings-section__title">
            <span>Community</span>
            <h2>Данные общины</h2>
            <p>
              Read-only snapshot активной community из Supabase. Редактирование
              общины появится отдельным потоком.
            </p>
          </div>
          <Badge tone={communityError ? "red" : community ? "green" : "muted"}>
            {communityError ? "error" : community ? "real data" : "waiting"}
          </Badge>
        </div>

        {communityLoading ? (
          <div className="settings-state" role="status">
            Загружаем активную общину из Supabase...
          </div>
        ) : null}

        {communityError ? (
          <div className="settings-state settings-state--error" role="alert">
            <strong>Не удалось загрузить данные общины.</strong>
            <span>{communityError}</span>
          </div>
        ) : null}

        {!communityLoading && !communityError && communitySettingRows.length === 0 ? (
          <div className="settings-state">
            Active community пока не определена для текущей membership. Проверьте
            beta-доступ и refresh сессии.
          </div>
        ) : null}

        {communitySettingRows.length > 0 ? (
          <SettingsFacts rows={communitySettingRows} />
        ) : null}
      </GlassCard>

      <GlassCard className="settings-section settings-locations" elevated>
        <div className="settings-section__head">
          <div className="settings-section__title">
            <span>Addresses</span>
            <h2>Адреса общины</h2>
            <p>
              Существующий справочник локаций для форм событий. Поведение
              add/edit/archive не меняется.
            </p>
          </div>
          <div className="settings-section__actions">
            <Badge tone={canManageLocations ? "green" : "muted"}>
              {canManageLocations ? "admin editable" : "read-only"}
            </Badge>
            <Button
              disabled={!canManageLocations || savingLocation}
              onClick={resetLocationForm}
              size="sm"
            >
              Новый адрес
            </Button>
          </div>
        </div>

        {!communityId ? (
          <div className="settings-state settings-state--error" role="alert">
            Не удалось определить communityId текущей активной membership.
          </div>
        ) : null}

        {locationsError ? (
          <div className="settings-state settings-state--error" role="alert">
            {locationsError}
          </div>
        ) : null}

        <div className="settings-location-form">
          <label className="event-form-field">
            <span>Название локации</span>
            <input
              disabled={!canManageLocations || savingLocation}
              onChange={(event) =>
                setForm((current) => ({ ...current, title: event.target.value }))
              }
              placeholder="Например: Главный зал"
              value={form.title}
            />
          </label>

          <label className="event-form-field event-form-field--wide">
            <span>Адрес для участников</span>
            <input
              disabled={!canManageLocations || savingLocation}
              onChange={(event) =>
                setForm((current) => ({ ...current, address: event.target.value }))
              }
              placeholder="Город, улица, дом"
              value={form.address}
            />
          </label>

          <label className="event-form-field">
            <span>Сортировка</span>
            <input
              disabled={!canManageLocations || savingLocation}
              onChange={(event) =>
                setForm((current) => ({ ...current, sortOrder: event.target.value }))
              }
              type="number"
              value={form.sortOrder}
            />
          </label>

          <label className="event-form-check">
            <input
              checked={form.isDefault}
              disabled={!canManageLocations || savingLocation || !form.isActive}
              onChange={(event) =>
                setForm((current) => ({ ...current, isDefault: event.target.checked }))
              }
              type="checkbox"
            />
            <span className="event-form-check__content">
              <span>По умолчанию</span>
            </span>
          </label>

          {editingLocationId ? (
            <label className="event-form-check">
              <input
                checked={form.isActive}
                disabled={!canManageLocations || savingLocation}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    isActive: event.target.checked,
                    isDefault: event.target.checked ? current.isDefault : false,
                  }))
                }
                type="checkbox"
              />
              <span className="event-form-check__content">
                <span>Активен</span>
              </span>
            </label>
          ) : null}
        </div>

        {formError ? (
          <div className="settings-state settings-state--error" role="alert">
            {formError}
          </div>
        ) : null}

        <div className="settings-location-form__actions">
          <Button disabled={!canManageLocations || savingLocation} onClick={saveLocation} variant="primary">
            {savingLocation
              ? "Сохраняем..."
              : editingLocationId
                ? "Сохранить адрес"
                : "Добавить адрес"}
          </Button>
          {editingLocationId ? (
            <Button disabled={savingLocation} onClick={resetLocationForm} variant="ghost">
              Отменить
            </Button>
          ) : null}
        </div>

        <div className="settings-location-list">
          {locationsLoading ? (
            <div className="settings-state" role="status">
              Загружаем адреса общины...
            </div>
          ) : locations.length === 0 ? (
            <div className="settings-state">
              Адреса общины ещё не добавлены. Когда появится первая локация, она
              будет доступна в существующих формах событий.
            </div>
          ) : (
            locations.map((location) => (
              <div className="settings-location-row" key={location.id}>
                <div className="settings-location-row__main">
                  <strong>{location.title}</strong>
                  <span>{location.address}</span>
                </div>
                <div className="settings-location-row__badges">
                  {location.isDefault ? <Badge tone="gold">default</Badge> : null}
                  <Badge tone={location.isActive ? "green" : "muted"}>
                    {location.isActive ? "active" : "archived"}
                  </Badge>
                </div>
                <div className="settings-location-row__actions">
                  <Button
                    disabled={!canManageLocations || savingLocation}
                    onClick={() => editLocation(location)}
                    size="sm"
                    variant="secondary"
                  >
                    Изменить
                  </Button>
                  <Button
                    disabled={!canManageLocations || savingLocation || !location.isActive}
                    onClick={() => void archiveLocation(location)}
                    size="sm"
                    variant="ghost"
                  >
                    Архив
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </GlassCard>

      <GlassCard className="settings-section" elevated>
        <div className="settings-section__head">
          <div className="settings-section__title">
            <span>Beta connection</span>
            <h2>Контекст подключения</h2>
            <p>
              Web-admin работает через обычный authenticated Supabase client.
              Админские действия остаются на границе RPC/RLS.
            </p>
          </div>
          <Badge tone={isSupabaseConfigured ? "green" : "red"}>
            {isSupabaseConfigured ? "configured" : "config missing"}
          </Badge>
        </div>

        <SettingsFacts rows={betaConnectionRows} />

        <div className="settings-safe-note">
          На этой странице не раскрываются raw tokens, key values, server-only
          env или SQL/debug credentials.
        </div>
      </GlassCard>

      <AdminHealthCheck />

      <GlassCard className="settings-section" elevated>
        <div className="settings-section__head">
          <div className="settings-section__title">
            <span>Future settings</span>
            <h2>Запланированные настройки</h2>
            <p>
              Эти возможности намеренно выключены в beta: здесь нет fake-save
              форм и production-looking controls.
            </p>
          </div>
          <Badge tone="muted">planned</Badge>
        </div>

        <div className="settings-future-grid">
          {futureSettings.map((setting) => (
            <article aria-disabled="true" className="settings-future-card" key={setting.title}>
              <Badge tone="muted">future</Badge>
              <h3>{setting.title}</h3>
              <p>{setting.description}</p>
            </article>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}

function SettingsFacts({ rows }: { rows: SettingsFactRow[] }) {
  return (
    <dl className="settings-facts">
      {rows.map((setting) => (
        <div className="settings-facts__row" key={setting.label}>
          <dt>{setting.label}</dt>
          <dd>
            {setting.href ? (
              <a href={setting.href} rel="noreferrer" target="_blank">
                {setting.value}
              </a>
            ) : (
              setting.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function parseSortOrder(value: string): number | null {
  const normalized = value.trim();
  if (!normalized) {
    return 100;
  }

  if (!/^-?\d+$/.test(normalized)) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function buildCommunitySettingRows(
  community: AdminCommunity | null,
): SettingsFactRow[] {
  if (!community) {
    return [];
  }

  const rows: SettingsFactRow[] = [
    { label: "Название", value: community.name },
    { label: "Community ID", value: community.id },
    { label: "Timezone", value: community.timezone ?? "Не указан" },
  ];

  if (community.websiteUrl) {
    const href = getSafeWebsiteHref(community.websiteUrl);
    rows.push(
      href
        ? { label: "Website", value: community.websiteUrl, href }
        : { label: "Website", value: community.websiteUrl },
    );
  }

  if (community.createdAt) {
    rows.push({
      label: "Создана",
      value: formatCommunityTimestamp(community.createdAt),
    });
  }

  return rows;
}

function buildBetaConnectionRows(input: {
  adminEnvLabel: string | null;
  canAccessAdmin: boolean;
  communityId: string | null;
  isAuthenticated: boolean;
  role: string | null;
  supabaseHost: string | null;
}): SettingsFactRow[] {
  return [
    { label: "Environment label", value: input.adminEnvLabel ?? "Не задан" },
    { label: "Supabase project", value: input.supabaseHost ?? "Не настроен" },
    {
      label: "Browser client",
      value: "Authenticated Supabase client + user session",
    },
    { label: "Access boundary", value: "Admin actions через RPC/RLS" },
    { label: "Current role", value: input.role ?? "Нет активной роли" },
    {
      label: "Admin access",
      value: input.canAccessAdmin ? "Разрешён текущей membership" : "Не подтверждён",
    },
    {
      label: "Session",
      value: input.isAuthenticated ? "Active user session" : "Нет активной session",
    },
    { label: "Active community", value: input.communityId ?? "Не определена" },
  ];
}

function getAdminEnvLabel(): string | null {
  const value = import.meta.env.VITE_ADMIN_ENV_LABEL as string | undefined;
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function getSupabaseHost(): string | null {
  const value = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const normalized = value?.trim();

  if (!normalized) {
    return null;
  }

  try {
    return new URL(normalized).host;
  } catch {
    return "Supabase URL configured";
  }
}

function getSafeWebsiteHref(value: string): string | undefined {
  return /^https?:\/\//i.test(value) ? value : undefined;
}

function formatCommunityTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

const futureSettings = [
  {
    title: "Logo upload",
    description: "Загрузка и хранение логотипа общины будут подключены отдельным PR.",
  },
  {
    title: "Billing",
    description: "Платёжные и тарифные настройки не входят в текущую beta-панель.",
  },
  {
    title: "Notification settings",
    description: "Email/push preferences появятся после отдельного product flow.",
  },
  {
    title: "Advanced community settings",
    description: "Полное редактирование community будет спроектировано без mock-save форм.",
  },
];
