import { type FormEvent, useEffect, useId, useRef, useState } from "react";

import { createAdminFeedback } from "../../services/adminFeedbackService";
import type { AdminSection } from "../../types/admin";
import type {
  AdminFeedbackEntityContext,
  AdminFeedbackSeverity,
} from "../../types/feedback";
import { Button } from "../ui/Button";

const SEVERITY_OPTIONS: ReadonlyArray<{
  value: AdminFeedbackSeverity;
  label: string;
}> = [
  { value: "note", label: "Заметка" },
  { value: "issue", label: "Проблема" },
  { value: "blocker", label: "Блокер" },
  { value: "idea", label: "Идея" },
];

type SubmitState = "idle" | "submitting" | "success" | "error";

type AdminFeedbackDialogProps = {
  communityId?: string | null;
  section: AdminSection;
  sectionTitle: string;
  entityContext?: AdminFeedbackEntityContext | null;
  onClose: () => void;
};

export function AdminFeedbackDialog({
  communityId = null,
  section,
  sectionTitle,
  entityContext = null,
  onClose,
}: AdminFeedbackDialogProps) {
  const titleId = useId();
  const messageId = useId();
  const statusId = useId();
  const messageRef = useRef<HTMLTextAreaElement | null>(null);
  const [severity, setSeverity] = useState<AdminFeedbackSeverity>("note");
  const [message, setMessage] = useState("");
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const trimmedMessage = message.trim();
  const isSubmitting = submitState === "submitting";

  useEffect(() => {
    messageRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSubmitting) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSubmitting, onClose]);

  const resetStatus = () => {
    if (submitState !== "idle") {
      setSubmitState("idle");
      setErrorMessage(null);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!trimmedMessage || isSubmitting) {
      return;
    }

    setSubmitState("submitting");
    setErrorMessage(null);

    try {
      await createAdminFeedback({
        communityId,
        section,
        severity,
        message: trimmedMessage,
        url: getCurrentUrl(),
        userAgent: getUserAgent(),
        entity: entityContext,
      });
      setMessage("");
      setSubmitState("success");
    } catch (error) {
      setSubmitState("error");
      setErrorMessage(getErrorMessage(error));
    }
  };

  const handleSubmitAnother = () => {
    setSubmitState("idle");
    setErrorMessage(null);
    messageRef.current?.focus();
  };

  return (
    <div className="admin-feedback-dialog-backdrop" role="presentation">
      <section
        aria-describedby={statusId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="admin-feedback-dialog"
        role="dialog"
      >
        <header className="admin-feedback-dialog__head">
          <div>
            <span>beta feedback</span>
            <h2 id={titleId}>Замечание по админке</h2>
            <p>{sectionTitle}</p>
          </div>
          <Button disabled={isSubmitting} onClick={onClose} variant="ghost">
            Закрыть
          </Button>
        </header>

        <form className="admin-feedback-dialog__form" onSubmit={handleSubmit}>
          <fieldset className="admin-feedback-dialog__fieldset" disabled={isSubmitting}>
            <legend>Важность</legend>
            <div
              aria-label="Важность замечания"
              className="admin-feedback-dialog__severity"
              role="radiogroup"
            >
              {SEVERITY_OPTIONS.map((option) => (
                <label
                  className={[
                    "admin-feedback-dialog__severity-option",
                    severity === option.value
                      ? "admin-feedback-dialog__severity-option--active"
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  key={option.value}
                >
                  <input
                    checked={severity === option.value}
                    name="admin-feedback-severity"
                    onChange={() => {
                      setSeverity(option.value);
                      resetStatus();
                    }}
                    type="radio"
                    value={option.value}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="admin-feedback-dialog__message" htmlFor={messageId}>
            <span>Сообщение</span>
            <textarea
              id={messageId}
              maxLength={4000}
              onChange={(event) => {
                setMessage(event.target.value);
                resetStatus();
              }}
              placeholder="Что заметили?"
              ref={messageRef}
              rows={6}
              value={message}
            />
          </label>

          <div className="admin-feedback-dialog__meta">
            <span>{section}</span>
            <span>{message.length}/4000</span>
          </div>

          <div className="admin-feedback-dialog__actions">
            {submitState === "success" ? (
              <>
                <Button onClick={handleSubmitAnother} variant="secondary">
                  Отправить ещё
                </Button>
                <Button onClick={onClose} variant="primary">
                  Готово
                </Button>
              </>
            ) : (
              <>
                <Button disabled={isSubmitting} onClick={onClose} variant="ghost">
                  Отмена
                </Button>
                <Button disabled={!trimmedMessage || isSubmitting} type="submit" variant="primary">
                  {isSubmitting ? "Отправляем..." : "Отправить"}
                </Button>
              </>
            )}
          </div>

          <p
            className={[
              "admin-feedback-dialog__status",
              submitState === "success" ? "admin-feedback-dialog__status--success" : "",
              submitState === "error" ? "admin-feedback-dialog__status--error" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            id={statusId}
            role={submitState === "error" ? "alert" : "status"}
          >
            {submitState === "success"
              ? "Замечание отправлено. Спасибо."
              : errorMessage ?? ""}
          </p>
        </form>
      </section>
    </div>
  );
}

function getCurrentUrl(): string | null {
  return typeof window === "undefined" ? null : window.location.href;
}

function getUserAgent(): string | null {
  return typeof navigator === "undefined" ? null : navigator.userAgent;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Не удалось отправить замечание.";
}
