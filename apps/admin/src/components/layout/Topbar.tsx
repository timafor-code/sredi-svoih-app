import { useEffect, useId, useState } from "react";

import type { AdminProfile, AdminRole } from "../../types/auth";
import { Button } from "../ui/Button";

const LOCAL_IMPORT_COMMANDS = [
  "cd F:\\2026\\SS-App\\code\\sredi-svoih-app; npm run import:events:dry",
  "cd F:\\2026\\SS-App\\code\\sredi-svoih-app; npm run import:events -- --apply",
  "cd F:\\2026\\SS-App\\code\\sredi-svoih-app; npm run import:events:review -- --limit 20",
].join("\n");

type CopyState = "idle" | "copied" | "error";

type TopbarProps = {
  sectionTitle: string;
  profile: AdminProfile | null;
  role: AdminRole;
  isImportSection: boolean;
  onCreateEvent: () => void;
  onOpenImportReview: () => void;
  onRefreshImportReview: () => void;
  onSignOut: () => void;
  sessionEmail: string | null;
};

export function Topbar({
  sectionTitle,
  profile,
  role,
  isImportSection,
  onCreateEvent,
  onOpenImportReview,
  onRefreshImportReview,
  onSignOut,
  sessionEmail,
}: TopbarProps) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [isImportWorkflowOpen, setIsImportWorkflowOpen] = useState(false);
  const [workflowMessage, setWorkflowMessage] = useState<string | null>(null);
  const dialogTitleId = useId();
  const userLabel = getProfileLabel(profile, sessionEmail);

  useEffect(() => {
    if (!isImportWorkflowOpen) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsImportWorkflowOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isImportWorkflowOpen]);

  useEffect(() => {
    if (copyState === "idle") {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setCopyState("idle");
    }, 2500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [copyState]);

  const handleCopyCommands = async () => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API is unavailable.");
      }

      await navigator.clipboard.writeText(LOCAL_IMPORT_COMMANDS);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  };

  const handleOpenImportReview = () => {
    onOpenImportReview();
    setIsImportWorkflowOpen(false);
  };

  const handleRefreshImportReview = () => {
    onRefreshImportReview();
    setWorkflowMessage("Запросили обновление очереди на странице импорта.");
  };

  const openImportWorkflow = () => {
    setCopyState("idle");
    setWorkflowMessage(null);
    setIsImportWorkflowOpen(true);
  };

  return (
    <header className="topbar">
      <div className="topbar__breadcrumbs" aria-label="Хлебные крошки">
        <span>Admin Center</span>
        <span className="topbar__separator">/</span>
        <strong>{sectionTitle}</strong>
      </div>

      <label className="topbar__search">
        <span aria-hidden="true">⌕</span>
        <input aria-label="Глобальный поиск" placeholder="Поиск по админке" readOnly />
      </label>

      <div className="topbar__actions">
        <Button onClick={onCreateEvent} variant="primary">
          Создать событие
        </Button>
        <Button onClick={openImportWorkflow} variant="secondary">
          Проверить импорт
        </Button>
        <div className="topbar__user" title={userLabel}>
          <strong>{userLabel}</strong>
          <span>{role}</span>
        </div>
        <Button onClick={onSignOut} variant="ghost">
          Выйти
        </Button>
      </div>

      {isImportWorkflowOpen ? (
        <div className="import-workflow-backdrop" role="presentation">
          <section
            aria-labelledby={dialogTitleId}
            aria-modal="true"
            className="import-workflow-dialog"
            role="dialog"
          >
            <div className="import-workflow-dialog__head">
              <div>
                <span>local/dev workflow</span>
                <h2 id={dialogTitleId}>Импорт с сайта</h2>
              </div>
              <Button onClick={() => setIsImportWorkflowOpen(false)} variant="ghost">
                Закрыть
              </Button>
            </div>

            <div className="import-workflow-status">
              <strong>Автоматический запуск из браузера будет добавлен отдельным backend PR.</strong>
              <p>
                Сейчас importer запускается локально из PowerShell и пишет в Supabase через
                DATABASE_URL. Браузерная админка не запускает Node script напрямую.
              </p>
            </div>

            <p className="import-workflow-helper">
              Сейчас для локальной проверки запустите importer из PowerShell, затем нажмите
              «Обновить очередь».
            </p>

            <pre className="import-workflow-commands" aria-label="PowerShell команды">
              <code>{LOCAL_IMPORT_COMMANDS}</code>
            </pre>

            <div className="import-workflow-dialog__actions">
              <Button onClick={handleCopyCommands}>Скопировать команды</Button>
              {isImportSection ? (
                <Button onClick={handleRefreshImportReview} variant="secondary">
                  Обновить очередь
                </Button>
              ) : (
                <Button onClick={handleOpenImportReview} variant="secondary">
                  Открыть импорт с сайта
                </Button>
              )}
            </div>

            {copyState === "copied" ? (
              <p className="import-workflow-feedback">Команды скопированы.</p>
            ) : null}
            {copyState === "error" ? (
              <p className="import-workflow-feedback import-workflow-feedback--error">
                Не удалось скопировать автоматически. Команды можно выделить вручную.
              </p>
            ) : null}
            {workflowMessage ? <p className="import-workflow-feedback">{workflowMessage}</p> : null}
          </section>
        </div>
      ) : null}
    </header>
  );
}

function getProfileLabel(profile: AdminProfile | null, sessionEmail: string | null): string {
  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim();

  return (
    profile?.display_name ??
    profile?.full_name ??
    (fullName || null) ??
    profile?.email ??
    sessionEmail ??
    "Пользователь"
  );
}
