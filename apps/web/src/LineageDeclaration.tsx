import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  deleteLineageDeclaration,
  getLineageDeclaration,
  putLineageDeclaration,
} from "./api";
import type {
  LineageDeclaration as LineageDeclarationData,
  LineageValue,
  WebRegistrationLegalDocument,
} from "./types";

const LINEAGE_OPTIONS: Array<{ value: LineageValue; label: string }> = [
  { value: "mother", label: "Мать" },
  { value: "father", label: "Отец" },
  { value: "maternal_grandmother", label: "Бабушка по маминой линии" },
  { value: "maternal_grandfather", label: "Дедушка по маминой линии" },
  { value: "paternal_grandmother", label: "Бабушка по папиной линии" },
  { value: "paternal_grandfather", label: "Дедушка по папиной линии" },
  { value: "giyur", label: "Гиюр" },
  { value: "unknown", label: "Я не знаю" },
];

const LINEAGE_LABELS = Object.fromEntries(
  LINEAGE_OPTIONS.map((option) => [option.value, option.label]),
) as Record<LineageValue, string>;

type Mode = "loading" | "hidden" | "question" | "collapsed";

type FormErrors = {
  values?: string;
  consent?: string;
};

export function LineageDeclarationPanel({
  consentDocument,
}: {
  consentDocument: WebRegistrationLegalDocument | null;
}): ReactNode {
  const uid = useId();
  const [mode, setMode] = useState<Mode>("loading");
  const [declaration, setDeclaration] = useState<LineageDeclarationData | null>(null);
  const [values, setValues] = useState<LineageValue[]>([]);
  const [consentChecked, setConsentChecked] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const activeRef = useRef(true);
  const firstOptionRef = useRef<HTMLInputElement>(null);
  const consentRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Without a current consent document there is nothing to ask and no new
    // acceptance to link, so skip the request entirely rather than surface a
    // withdraw-only view for a vanishingly rare retired-document edge case.
    if (!consentDocument) {
      setMode("hidden");
      return;
    }
    activeRef.current = true;
    getLineageDeclaration()
      .then((result) => {
        if (!activeRef.current) return;
        setDeclaration(result);
        setMode(result.state === "declared" ? "collapsed" : "question");
      })
      .catch(() => {
        if (activeRef.current) setMode("hidden");
      });
    return () => {
      activeRef.current = false;
    };
    // Identity/document resolution happens once per mount; the parent only
    // mounts this component when it makes sense to ask.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startEdit = () => {
    setValues(declaration?.values ?? []);
    setConsentChecked(false);
    setErrors({});
    setSubmitError(null);
    setMode("question");
  };

  const toggleValue = (value: LineageValue, checked: boolean) => {
    setValues((current) => {
      if (value === "unknown") return checked ? ["unknown"] : [];
      const withoutUnknown = current.filter((item) => item !== "unknown");
      return checked
        ? [...withoutUnknown, value]
        : withoutUnknown.filter((item) => item !== value);
    });
    setErrors((current) => ({ ...current, values: undefined }));
    setSubmitError(null);
  };

  const submit = async () => {
    if (!consentDocument || busy) return;
    const nextErrors: FormErrors = {};
    if (values.length === 0) nextErrors.values = "Выберите хотя бы один вариант ответа.";
    if (!consentChecked) nextErrors.consent = "Отметьте согласие, чтобы сохранить ответ.";
    setErrors(nextErrors);
    if (nextErrors.values) {
      firstOptionRef.current?.focus();
      return;
    }
    if (nextErrors.consent) {
      consentRef.current?.focus();
      return;
    }
    setBusy(true);
    setSubmitError(null);
    try {
      const result = await putLineageDeclaration(values, {
        document_id: consentDocument.id,
        content_hash: consentDocument.content_hash,
      });
      if (!activeRef.current) return;
      setDeclaration(result);
      setMode("collapsed");
    } catch {
      if (activeRef.current) {
        setSubmitError("Не удалось сохранить ответ. Попробуйте ещё раз позже.");
      }
    } finally {
      if (activeRef.current) setBusy(false);
    }
  };

  const withdraw = async () => {
    if (withdrawBusy) return;
    setWithdrawBusy(true);
    setWithdrawError(null);
    try {
      await deleteLineageDeclaration();
      if (!activeRef.current) return;
      setDeclaration({ state: "none", values: [], declared_at: null, updated_at: null });
      setValues([]);
      setConsentChecked(false);
      setErrors({});
      setMode("question");
    } catch {
      if (activeRef.current) {
        setWithdrawError("Не удалось отменить ответ. Попробуйте ещё раз позже.");
      }
    } finally {
      if (activeRef.current) setWithdrawBusy(false);
    }
  };

  if (mode === "loading" || mode === "hidden") return null;

  if (mode === "collapsed" && declaration) {
    return (
      <section className="surface section-card lineage-card lineage-summary" aria-labelledby={`${uid}-summary-heading`}>
        <h2 className="sr-only" id={`${uid}-summary-heading`}>Еврейское происхождение</h2>
        <p>Вы уже указывали: {declaration.values.map((value) => LINEAGE_LABELS[value]).join(", ")}</p>
        <div className="lineage-summary-actions">
          <button className="text-button" type="button" onClick={startEdit}>Изменить</button>
          <button className="text-button" type="button" disabled={withdrawBusy} onClick={() => { void withdraw(); }}>
            {withdrawBusy ? "Отменяем…" : "Отменить ответ"}
          </button>
        </div>
        {withdrawError ? <p className="form-error" role="alert">{withdrawError}</p> : null}
      </section>
    );
  }

  if (mode === "question" && consentDocument) {
    const valuesErrorId = `${uid}-values-error`;
    const consentMetaId = `${uid}-consent-meta`;
    const consentErrorId = `${uid}-consent-error`;
    return (
      <section className="surface section-card lineage-card" aria-labelledby={`${uid}-question-heading`}>
        <h2 id={`${uid}-question-heading`}>Еврейское происхождение</h2>
        <fieldset className="choice-fieldset" aria-describedby={errors.values ? valuesErrorId : undefined}>
          <legend>Есть ли у кого-то из ваших близких родственников еврейское происхождение или гиюр?</legend>
          <p className="questionnaire-help">возможно несколько вариантов ответа</p>
          <div className="questionnaire-choices">
            {LINEAGE_OPTIONS.map((option, index) => (
              <label key={option.value}>
                <input
                  ref={index === 0 ? firstOptionRef : undefined}
                  type="checkbox"
                  checked={values.includes(option.value)}
                  onChange={(event) => toggleValue(option.value, event.target.checked)}
                />
                {option.label}
              </label>
            ))}
          </div>
          {errors.values ? <p className="field-error" id={valuesErrorId} role="alert">{errors.values}</p> : null}
        </fieldset>

        <section className={`consent-card${consentChecked ? " checked" : ""}${errors.consent ? " invalid" : ""}`} aria-labelledby={`${uid}-consent-heading`}>
          <h3 className="sr-only" id={`${uid}-consent-heading`}>Согласие на обработку специальной категории данных</h3>
          <div className="consent-row">
            <input
              ref={consentRef}
              id={`${uid}-consent`}
              type="checkbox"
              checked={consentChecked}
              aria-required="true"
              aria-invalid={Boolean(errors.consent)}
              aria-describedby={`${consentMetaId}${errors.consent ? ` ${consentErrorId}` : ""}`}
              onChange={(event) => {
                setConsentChecked(event.target.checked);
                setErrors((current) => ({ ...current, consent: undefined }));
              }}
            />
            <div className="consent-text">
              <label htmlFor={`${uid}-consent`}>Я даю отдельное согласие на обработку специальной категории персональных данных для ответа на этот вопрос:</label>{" "}
              <a href={consentDocument.published_url} target="_blank" rel="noopener noreferrer">{consentDocument.title}</a>
              <p className="consent-meta" id={consentMetaId}>Версия {consentDocument.version}. Документ откроется в новой вкладке.</p>
            </div>
          </div>
          {errors.consent ? <p className="field-error" id={consentErrorId} role="alert">{errors.consent}</p> : null}
        </section>

        <div className="lineage-actions">
          <button className="secondary-button" type="button" disabled={busy} onClick={() => { void submit(); }}>
            {busy ? "Сохраняем…" : "Сохранить ответ"}
          </button>
        </div>
        {submitError ? <p className="form-error" role="alert">{submitError}</p> : null}
      </section>
    );
  }

  return null;
}
