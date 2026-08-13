import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  confirmPrivacyAccessCode,
  confirmPrivacyErasure,
  createDeletionPrivacyRequest,
  PublicApiError,
  requestPrivacyAccessCode,
} from "../api";

type DeleteAccountStep =
  | "explanation"
  | "verification"
  | "confirmation"
  | "manual_review"
  | "success";

const PRIVACY_SESSION_ERROR_CODES = new Set([
  "privacy_session_required",
  "privacy_session_expired",
  "privacy_session_revoked",
]);

function isNetworkError(error: unknown): boolean {
  return error instanceof PublicApiError
    && (error.code === "network_error" || error.code === "request_timeout");
}

function safeRequestError(error: unknown, fallback: string): string {
  return isNetworkError(error)
    ? "Не удалось выполнить запрос. Проверьте соединение и попробуйте снова."
    : fallback;
}

export function WebDeleteAccountFlow({
  email,
  onClose,
  onDeletionPending,
}: {
  email: string;
  onClose: () => void;
  onDeletionPending: () => void | Promise<void>;
}): ReactNode {
  const [step, setStep] = useState<DeleteAccountStep>("explanation");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [requestingCode, setRequestingCode] = useState(false);
  const [confirmingCode, setConfirmingCode] = useState(false);
  const [confirmingDeletion, setConfirmingDeletion] = useState(false);
  const [finalConfirmationOpen, setFinalConfirmationOpen] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);
  const finalDeleteButtonRef = useRef<HTMLButtonElement>(null);
  const openFinalConfirmationButtonRef = useRef<HTMLButtonElement>(null);
  const privacySessionTokenRef = useRef<string | null>(null);
  const deletionRequestIdRef = useRef<string | null>(null);
  const requestingCodeRef = useRef(false);
  const confirmingCodeRef = useRef(false);
  const confirmingDeletionRef = useRef(false);
  const canonicalEmail = email.trim();

  const clearTemporaryPrivacyState = useCallback(() => {
    privacySessionTokenRef.current = null;
    deletionRequestIdRef.current = null;
    setCode("");
    setError(null);
    setFinalConfirmationOpen(false);
  }, []);

  const closeFlow = useCallback(() => {
    clearTemporaryPrivacyState();
    onClose();
  }, [clearTemporaryPrivacyState, onClose]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    if (step === "verification") {
      codeInputRef.current?.focus();
    } else {
      stepHeadingRef.current?.focus();
    }
  }, [step]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab" && dialogRef.current) {
        const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ));
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (event.key !== "Escape" || requestingCode || confirmingCode || confirmingDeletion) return;
      event.preventDefault();
      if (finalConfirmationOpen) {
        setFinalConfirmationOpen(false);
        window.requestAnimationFrame(() => openFinalConfirmationButtonRef.current?.focus());
      } else {
        closeFlow();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeFlow, confirmingCode, confirmingDeletion, finalConfirmationOpen, requestingCode]);

  useEffect(() => () => {
    privacySessionTokenRef.current = null;
    deletionRequestIdRef.current = null;
  }, []);

  const requestCode = async () => {
    if (requestingCodeRef.current || confirmingCodeRef.current || !canonicalEmail) return;
    requestingCodeRef.current = true;
    setRequestingCode(true);
    setError(null);
    try {
      await requestPrivacyAccessCode(canonicalEmail);
      privacySessionTokenRef.current = null;
      setCode("");
      setStep("verification");
    } catch (requestError: unknown) {
      setError(safeRequestError(
        requestError,
        "Не удалось запросить код. Попробуйте ещё раз.",
      ));
    } finally {
      requestingCodeRef.current = false;
      setRequestingCode(false);
    }
  };

  const confirmCode = async () => {
    if (confirmingCodeRef.current || requestingCodeRef.current || !/^\d{6}$/.test(code)) return;
    confirmingCodeRef.current = true;
    setConfirmingCode(true);
    setError(null);
    try {
      const privacySession = await confirmPrivacyAccessCode(canonicalEmail, code);
      privacySessionTokenRef.current = privacySession.privacy_session_token;
      setCode("");
      setStep("confirmation");
    } catch (confirmationError: unknown) {
      setError(
        confirmationError instanceof PublicApiError
          && confirmationError.code === "invalid_or_expired_privacy_code"
          ? "Неверный или просроченный код."
          : safeRequestError(
            confirmationError,
            "Не удалось подтвердить код. Попробуйте ещё раз.",
          ),
      );
    } finally {
      confirmingCodeRef.current = false;
      setConfirmingCode(false);
    }
  };

  const returnToVerification = () => {
    privacySessionTokenRef.current = null;
    setCode("");
    setFinalConfirmationOpen(false);
    setStep("verification");
    setError("Сеанс подтверждения истёк. Получите новый код и попробуйте снова.");
  };

  const submitDeletion = async () => {
    const privacySessionToken = privacySessionTokenRef.current;
    if (confirmingDeletionRef.current || !privacySessionToken) {
      if (!privacySessionToken) returnToVerification();
      return;
    }

    confirmingDeletionRef.current = true;
    setConfirmingDeletion(true);
    setFinalConfirmationOpen(false);
    setError(null);
    let deletionPendingConfirmed = false;

    try {
      let requestId = deletionRequestIdRef.current;
      if (!requestId) {
        const privacyRequest = await createDeletionPrivacyRequest(privacySessionToken);
        requestId = privacyRequest.id;
        deletionRequestIdRef.current = requestId;
      }
      const lifecycle = await confirmPrivacyErasure(requestId, privacySessionToken);
      if (lifecycle.state !== "deletion_pending") {
        throw new PublicApiError("invalid_response");
      }
      deletionPendingConfirmed = true;
    } catch (deletionError: unknown) {
      const errorCode = deletionError instanceof PublicApiError ? deletionError.code : null;
      if (errorCode === "privacy_erasure_manual_review_required") {
        setStep("manual_review");
      } else if (errorCode && PRIVACY_SESSION_ERROR_CODES.has(errorCode)) {
        returnToVerification();
      } else {
        setError(safeRequestError(
          deletionError,
          "Не удалось подтвердить удаление аккаунта. Попробуйте ещё раз.",
        ));
      }
    } finally {
      confirmingDeletionRef.current = false;
      setConfirmingDeletion(false);
    }

    if (!deletionPendingConfirmed) return;
    privacySessionTokenRef.current = null;
    deletionRequestIdRef.current = null;
    setCode("");
    setStep("success");
    try {
      await onDeletionPending();
    } catch {
      // The backend lifecycle transition is authoritative; local cleanup stays best-effort.
    }
  };

  const handleCodeChange = (value: string) => {
    setCode(value.replace(/\D/g, "").slice(0, 6));
    setError(null);
  };

  const errorMessage = error ? (
    <p className="delete-account-error" role="alert" aria-live="assertive">{error}</p>
  ) : null;

  let content: ReactNode;
  if (step === "success") {
    content = (
      <>
        <h2 ref={stepHeadingRef} id="delete-account-heading" tabIndex={-1}>Запрос на удаление подтверждён</h2>
        <p>Доступ к аккаунту остановлен. Удаление данных будет завершено в соответствии с правилами хранения данных.</p>
        <button className="secondary-button" type="button" onClick={closeFlow}>Вернуться к регистрации</button>
      </>
    );
  } else if (step === "manual_review") {
    content = (
      <>
        <h2 ref={stepHeadingRef} id="delete-account-heading" tabIndex={-1}>Требуется дополнительная обработка</h2>
        <p>Запрос нельзя завершить автоматически. Обратитесь в поддержку. Доступ не считается остановленным, пока сервер не подтвердил удаление.</p>
        <button className="secondary-button" type="button" onClick={closeFlow}>Закрыть</button>
      </>
    );
  } else if (step === "verification") {
    content = (
      <>
        <h2 ref={stepHeadingRef} id="delete-account-heading" tabIndex={-1}>Подтверждение удаления</h2>
        <p>Мы отправили шестизначный код на <strong className="delete-account-email">{canonicalEmail}</strong>.</p>
        <div className="form-field code-field delete-account-code-field">
          <label htmlFor="delete-account-code">Код подтверждения удаления</label>
          <input
            ref={codeInputRef}
            id="delete-account-code"
            value={code}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            aria-describedby={error ? "delete-account-error" : undefined}
            onChange={(event) => handleCodeChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && /^\d{6}$/.test(code)) void confirmCode();
            }}
          />
        </div>
        {error ? <div id="delete-account-error">{errorMessage}</div> : null}
        <div className="delete-account-actions">
          <button className="primary-button" type="button" disabled={!/^\d{6}$/.test(code) || requestingCode || confirmingCode} onClick={() => void confirmCode()}>
            {confirmingCode ? "Проверяем код…" : "Продолжить"}
          </button>
          <button className="secondary-button" type="button" disabled={requestingCode || confirmingCode} onClick={() => void requestCode()}>
            {requestingCode ? "Отправляем код…" : "Отправить код ещё раз"}
          </button>
          <button className="text-button" type="button" disabled={requestingCode || confirmingCode} onClick={closeFlow}>Отмена</button>
        </div>
      </>
    );
  } else if (step === "confirmation") {
    content = (
      <>
        <h2 ref={stepHeadingRef} id="delete-account-heading" tabIndex={-1}>Подтвердите удаление аккаунта</h2>
        <p>После подтверждения доступ к аккаунту будет остановлен. Это удаление аккаунта и данных, а не обычный выход. Завершение удаления происходит по правилам хранения данных.</p>
        {errorMessage}
        {finalConfirmationOpen ? (
          <div className="delete-account-final-confirmation" role="group" aria-labelledby="delete-account-final-heading">
            <h3 id="delete-account-final-heading">Удалить аккаунт и остановить доступ?</h3>
            <p>Подтвердите необратимое действие ещё раз.</p>
            <div className="delete-account-actions">
              <button ref={finalDeleteButtonRef} className="danger-button" type="button" disabled={confirmingDeletion} onClick={() => void submitDeletion()}>
                {confirmingDeletion ? "Подтверждаем удаление…" : "Да, удалить аккаунт"}
              </button>
              <button className="secondary-button" type="button" disabled={confirmingDeletion} onClick={() => {
                setFinalConfirmationOpen(false);
                window.requestAnimationFrame(() => openFinalConfirmationButtonRef.current?.focus());
              }}>Нет, вернуться</button>
            </div>
          </div>
        ) : (
          <div className="delete-account-actions">
            <button ref={openFinalConfirmationButtonRef} className="danger-button" type="button" disabled={confirmingDeletion} onClick={() => {
              setFinalConfirmationOpen(true);
              window.requestAnimationFrame(() => finalDeleteButtonRef.current?.focus());
            }}>Перейти к удалению аккаунта</button>
            <button className="text-button" type="button" disabled={confirmingDeletion} onClick={closeFlow}>Отмена</button>
          </div>
        )}
      </>
    );
  } else {
    content = (
      <>
        <h2 ref={stepHeadingRef} id="delete-account-heading" tabIndex={-1}>Удаление аккаунта и данных</h2>
        <p>Это действие удаляет аккаунт и связанные данные, а не просто выполняет выход. После подтверждения доступ будет остановлен, а удаление завершится по правилам хранения данных.</p>
        <div className="delete-account-email-box">
          <span>Email для подтверждения</span>
          <input aria-label="Email для подтверждения удаления" value={canonicalEmail} readOnly />
          <small>Email не редактируется.</small>
        </div>
        {errorMessage}
        <div className="delete-account-actions">
          <button className="primary-button" type="button" disabled={!canonicalEmail || requestingCode} onClick={() => void requestCode()}>
            {requestingCode ? "Запрашиваем код…" : "Получить код подтверждения"}
          </button>
          <button className="text-button" type="button" disabled={requestingCode} onClick={closeFlow}>Отмена</button>
        </div>
      </>
    );
  }

  return (
    <div className="delete-account-backdrop">
      <section
        ref={dialogRef}
        className="surface delete-account-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-account-heading"
        tabIndex={-1}
      >
        {content}
      </section>
    </div>
  );
}
