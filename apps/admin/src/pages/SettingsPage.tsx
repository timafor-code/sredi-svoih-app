import { useCallback, useEffect, useState } from "react";

import { AdminHealthCheck } from "../components/settings/AdminHealthCheck";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { GlassCard } from "../components/ui/GlassCard";
import { communitySettings } from "../data/mockAdmin";
import {
  archiveAdminCommunityLocation,
  createAdminCommunityLocation,
  listAdminCommunityLocations,
  updateAdminCommunityLocation,
} from "../services/communityLocationsService";
import { useAdminAuth } from "../store/useAdminAuth";
import type { AdminCommunityLocation } from "../types/communityLocations";

type LocationFormState = {
  title: string;
  address: string;
  sortOrder: string;
  isDefault: boolean;
  isActive: boolean;
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
  const [locations, setLocations] = useState<AdminCommunityLocation[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [locationsError, setLocationsError] = useState<string | null>(null);
  const [form, setForm] = useState<LocationFormState>(defaultLocationForm);
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null);
  const [savingLocation, setSavingLocation] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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

  return (
    <div className="page-stack">
      <section className="page-header">
        <Badge tone="glass">settings</Badge>
        <h1>Настройки</h1>
        <p>Базовые настройки общины и справочники для web-admin.</p>
      </section>

      <GlassCard className="settings-list" elevated>
        {communitySettings.map((setting) => (
          <div className="settings-list__row" key={setting.label}>
            <span>{setting.label}</span>
            <strong>{setting.value}</strong>
          </div>
        ))}
      </GlassCard>

      <AdminHealthCheck />

      <GlassCard className="settings-locations" elevated>
        <div className="settings-locations__head">
          <div>
            <span>Справочник</span>
            <h2>Адреса общины</h2>
          </div>
          <Button disabled={savingLocation} onClick={resetLocationForm} size="sm">
            Новый адрес
          </Button>
        </div>

        {!communityId ? (
          <div className="form-error" role="alert">
            Не удалось определить communityId текущей активной membership.
          </div>
        ) : null}

        {locationsError ? (
          <div className="form-error" role="alert">
            {locationsError}
          </div>
        ) : null}

        <div className="settings-location-form">
          <label className="event-form-field">
            <span>Название</span>
            <input
              disabled={!canManageLocations || savingLocation}
              onChange={(event) =>
                setForm((current) => ({ ...current, title: event.target.value }))
              }
              value={form.title}
            />
          </label>

          <label className="event-form-field event-form-field--wide">
            <span>Адрес</span>
            <input
              disabled={!canManageLocations || savingLocation}
              onChange={(event) =>
                setForm((current) => ({ ...current, address: event.target.value }))
              }
              value={form.address}
            />
          </label>

          <label className="event-form-field">
            <span>Порядок</span>
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
          <div className="form-error" role="alert">
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
            <div className="event-form-notice">Загружаем адреса...</div>
          ) : locations.length === 0 ? (
            <div className="event-form-notice">
              Адреса общины ещё не добавлены. Создайте первый адрес для формы событий.
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
    </div>
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
