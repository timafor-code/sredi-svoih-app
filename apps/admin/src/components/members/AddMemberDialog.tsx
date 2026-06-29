import { useEffect, useMemo, useState, type FormEvent } from "react";

import { Button } from "../ui/Button";
import { createAdminInvite } from "../../services/adminInvitesService";
import {
  ADMIN_INVITE_ROLES,
  type AdminCreatedInvite,
  type AdminInviteRole,
} from "../../types/invites";
import { AddExistingMemberPanel } from "./AddExistingMemberDialog";

type AddMemberDialogProps = {
  communityId: string | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
};

type AddMemberMode = "existing" | "invite";

const COMMUNITY_ID_ERROR =
  "Не удалось определить communityId текущей активной membership.";

const INVITE_ROLE_LABELS: Record<AdminInviteRole, string> = {
  member: "Участник",
  event_manager: "Организатор",
  admin: "Администратор",
  rabbi: "Раввин",
};

const MODE_META: Record<AddMemberMode, { label: string; hint: string }> = {
  existing: {
    label: "Профиль приложения",
    hint: "Найдите существующий профиль без членства в этой общине, проверьте данные и назначьте роль.",
  },
  invite: {
    label: "Новый по приглашению",
    hint: "Создайте приглашение для нового участника. Профиль и пароль создаются самим участником при активации кода.",
  },
};

export function AddMemberDialog({
  communityId,
  onClose,
  onSaved,
}: AddMemberDialogProps) {
  const [mode, setMode] = useState<AddMemberMode>("existing");
  const [busy, setBusy] = useState(false);

  const requestClose = () => {
    if (busy) {
      return;
    }
    onClose();
  };

  const switchMode = (next: AddMemberMode) => {
    if (busy || next === mode) {
      return;
    }
    setMode(next);
  };

  const meta = MODE_META[mode];

  return (
    <div className="member-add-backdrop" onClick={requestClose}>
      <section
        aria-labelledby="member-add-title"
        aria-modal="true"
        className="member-add-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="member-add-dialog__head">
          <div>
            <span>{meta.label}</span>
            <h2 id="member-add-title">Добавить участника</h2>
            <p>{meta.hint}</p>
            <div className="member-add-modes" role="tablist">
              <button
                aria-selected={mode === "existing"}
                className={[
                  "member-add-mode",
                  mode === "existing" ? "member-add-mode--active" : null,
                ]
                  .filter(Boolean)
                  .join(" ")}
                disabled={busy}
                onClick={() => switchMode("existing")}
                role="tab"
                type="button"
              >
                Профиль приложения
              </button>
              <button
                aria-selected={mode === "invite"}
                className={[
                  "member-add-mode",
                  mode === "invite" ? "member-add-mode--active" : null,
                ]
                  .filter(Boolean)
                  .join(" ")}
                disabled={busy}
                onClick={() => switchMode("invite")}
                role="tab"
                type="button"
              >
                Новый по приглашению
              </button>
            </div>
          </div>
          <button
            aria-label="Закрыть добавление участника"
            className="member-detail-drawer__close"
            disabled={busy}
            onClick={requestClose}
            type="button"
          >
            ×
          </button>
        </header>

        {mode === "existing" ? (
          <AddExistingMemberPanel
            communityId={communityId}
            onBusyChange={setBusy}
            onClose={onClose}
            onSaved={onSaved}
          />
        ) : (
          <AddInviteMemberPanel
            communityId={communityId}
            onBusyChange={setBusy}
            onClose={onClose}
          />
        )}
      </section>
    </div>
  );
}

type AddInviteMemberPanelProps = {
  communityId: string | null;
  onClose: () => void;
  onBusyChange?: (busy: boolean) => void;
};

function toIsoFromLocalInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function AddInviteMemberPanel({
  communityId,
  onClose,
  onBusyChange,
}: AddInviteMemberPanelProps) {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<AdminInviteRole>("member");
  const [expiresAtLocal, setExpiresAtLocal] = useState("");
  const [maxUses, setMaxUses] = useState("1");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdInvite, setCreatedInvite] = useState<AdminCreatedInvite | null>(
    null,
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setEmail("");
    setPhone("");
    setRole("member");
    setExpiresAtLocal("");
    setMaxUses("1");
    setCreating(false);
    setCreateError(null);
    setCreatedInvite(null);
    setCopied(false);
  }, [communityId]);

  useEffect(() => {
    onBusyChange?.(creating);
  }, [creating, onBusyChange]);

  const canCreate = Boolean(communityId) && !creating;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!communityId) {
      setCreateError(COMMUNITY_ID_ERROR);
      return;
    }

    const trimmedExpires = expiresAtLocal.trim();
    let expiresAtIso: string | null = null;
    if (trimmedExpires) {
      expiresAtIso = toIsoFromLocalInput(trimmedExpires);
      if (!expiresAtIso) {
        setCreateError("Укажите корректную дату и время окончания действия.");
        return;
      }
    }

    let maxUsesValue: number | null = null;
    const trimmedMaxUses = maxUses.trim();
    if (trimmedMaxUses) {
      const parsed = Number(trimmedMaxUses);
      if (!Number.isInteger(parsed) || parsed < 1) {
        setCreateError("Число использований должно быть целым числом не меньше 1.");
        return;
      }
      maxUsesValue = parsed;
    }

    setCreating(true);
    setCreateError(null);
    setCopied(false);

    try {
      const invite = await createAdminInvite({
        communityId,
        role,
        email: email.trim() || null,
        phone: phone.trim() || null,
        expiresAt: expiresAtIso,
        maxUses: maxUsesValue,
      });

      setCreatedInvite(invite);
    } catch (nextError) {
      setCreateError(
        nextError instanceof Error
          ? nextError.message
          : "Не удалось создать приглашение.",
      );
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!createdInvite) {
      return;
    }

    try {
      await navigator.clipboard.writeText(createdInvite.code);
      setCopied(true);
    } catch {
      setCopied(false);
      setCreateError(
        "Не удалось скопировать код автоматически. Скопируйте его вручную.",
      );
    }
  };

  const startNewInvite = () => {
    setEmail("");
    setPhone("");
    setRole("member");
    setExpiresAtLocal("");
    setMaxUses("1");
    setCreateError(null);
    setCreatedInvite(null);
    setCopied(false);
  };

  return (
    <div className="member-add-dialog__body member-add-dialog__body--invite">
      <section className="member-add-dialog__section">
        <h3>Новый участник по приглашению</h3>
        <p className="member-add-state">
          Создаётся только приглашение. Пользователь сам задаёт пароль при
          регистрации по коду. Учётная запись и профиль появляются только после
          активации приглашения. Письмо автоматически не отправляется — передайте
          код участнику самостоятельно.
        </p>

        <form className="member-add-form" onSubmit={handleSubmit}>
          <div className="member-membership-fields">
            <label className="member-membership-field">
              <span>Email</span>
              <input
                autoComplete="off"
                disabled={creating}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@example.com"
                type="email"
                value={email}
              />
            </label>

            <label className="member-membership-field">
              <span>Телефон</span>
              <input
                autoComplete="off"
                disabled={creating}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+7 999 000-00-00"
                type="tel"
                value={phone}
              />
            </label>

            <label className="member-membership-field">
              <span>Роль</span>
              <select
                disabled={creating}
                onChange={(event) =>
                  setRole(event.target.value as AdminInviteRole)
                }
                value={role}
              >
                {ADMIN_INVITE_ROLES.map((inviteRole) => (
                  <option key={inviteRole} value={inviteRole}>
                    {INVITE_ROLE_LABELS[inviteRole]}
                  </option>
                ))}
              </select>
            </label>

            <label className="member-membership-field">
              <span>Действует до</span>
              <input
                disabled={creating}
                onChange={(event) => setExpiresAtLocal(event.target.value)}
                type="datetime-local"
                value={expiresAtLocal}
              />
            </label>

            <label className="member-membership-field">
              <span>Макс. использований</span>
              <input
                disabled={creating}
                min={1}
                onChange={(event) => setMaxUses(event.target.value)}
                step={1}
                type="number"
                value={maxUses}
              />
            </label>
          </div>

          {createError ? (
            <p
              className="member-membership-feedback member-membership-feedback--error"
              role="alert"
            >
              {createError}
            </p>
          ) : null}

          <div className="member-membership-actions">
            <Button disabled={creating} onClick={onClose} variant="ghost">
              Закрыть
            </Button>
            <Button disabled={!canCreate} type="submit" variant="primary">
              {creating ? "Создаём..." : "Создать приглашение"}
            </Button>
          </div>
        </form>
      </section>

      <section className="member-add-dialog__section">
        <h3>Код приглашения</h3>
        {createdInvite ? (
          <div className="member-invite-result">
            <p className="member-membership-feedback member-membership-feedback--success">
              Приглашение создано. Код показывается один раз — скопируйте и
              передайте его участнику.
            </p>

            <div className="member-invite-code">
              <code>{createdInvite.code}</code>
              <Button onClick={() => void handleCopy()} variant="primary">
                {copied ? "Скопировано" : "Копировать код"}
              </Button>
            </div>

            <dl className="member-invite-meta">
              <div>
                <dt>Роль</dt>
                <dd>{INVITE_ROLE_LABELS[createdInvite.role]}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{createdInvite.email ?? "—"}</dd>
              </div>
              <div>
                <dt>Телефон</dt>
                <dd>{createdInvite.phone ?? "—"}</dd>
              </div>
              <div>
                <dt>Макс. использований</dt>
                <dd>{createdInvite.maxUses}</dd>
              </div>
              <div>
                <dt>Действует до</dt>
                <dd>
                  {createdInvite.expiresAt
                    ? new Date(createdInvite.expiresAt).toLocaleString("ru-RU")
                    : "Без срока"}
                </dd>
              </div>
            </dl>

            <p className="member-add-state">
              Пользователь сам задаёт пароль при регистрации по этому коду.
            </p>

            <div className="member-membership-actions">
              <Button onClick={startNewInvite} variant="ghost">
                Создать ещё одно
              </Button>
            </div>
          </div>
        ) : (
          <p className="member-detail-empty">
            Заполните данные и создайте приглашение — код появится здесь один раз.
          </p>
        )}
      </section>
    </div>
  );
}
