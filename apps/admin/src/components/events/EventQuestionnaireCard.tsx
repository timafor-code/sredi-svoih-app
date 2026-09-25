import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { SaveStatusView } from "../ui/SaveStatusView";
import { GlassCard } from "../ui/GlassCard";
import {
  deleteAdminEventQuestionnaireDraft,
  getAdminEventQuestionnaire,
  publishAdminEventQuestionnaire,
  saveAdminEventQuestionnaireDraft,
  unpublishAdminEventQuestionnaire,
} from "../../services/adminEventQuestionnaireService";
import type {
  AdminEventQuestionnaire,
  EventQuestionnaireDraftInput,
  EventQuestionnaireField,
  EventQuestionnaireFieldType,
  EventQuestionnaireForm,
} from "../../types/eventQuestionnaires";

type EventQuestionnaireCardProps = {
  eventId: string;
  onDirtyChange?: (dirty: boolean) => void;
};
type EditorOption = { value: string; label: string };
type EditorQuestion = {
  persistedId?: string;
  fieldKey: string;
  fieldType: EventQuestionnaireFieldType;
  label: string;
  required: boolean;
  purpose: string;
  retentionDays: string;
  options: EditorOption[];
  minLength: string;
  maxLength: string;
  minSelections: string;
  maxSelections: string;
  sortOrder: number;
};
type EditorState = {
  version: number | null;
  purpose: string;
  questions: EditorQuestion[];
};
type ConfirmationAction = "publish" | "unpublish" | "delete-draft" | null;
type QuestionValidationTarget = {
  questionIndex: number;
  field: "label" | "purpose" | "retention" | "options" | "constraints";
};

const FIELD_TYPE_LABELS: Record<EventQuestionnaireFieldType, string> = {
  short_text: "Короткий текст",
  long_text: "Длинный текст",
  single_select: "Один вариант",
  multi_select: "Несколько вариантов",
  boolean: "Да / нет",
};
const FIELD_TYPES = Object.keys(
  FIELD_TYPE_LABELS,
) as EventQuestionnaireFieldType[];
const RETENTION_PRESETS = [
  { label: "30 дней", value: "30" },
  { label: "90 дней", value: "90" },
  { label: "1 год", value: "365" },
];

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
function formatPublishedAt(value: string | null): string {
  if (!value || Number.isNaN(new Date(value).getTime()))
    return "Дата недоступна";
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(value));
}
function optionalNumber(value: string): number | undefined {
  return value.trim() === "" ? undefined : Number(value);
}
function nextStableValue(
  existing: Iterable<string>,
  prefix: "question" | "option",
): string {
  const used = new Set(existing);
  let index = 1;
  while (used.has(`${prefix}_${index}`)) index += 1;
  return `${prefix}_${index}`;
}
function normalizeQuestionOrder(questions: EditorQuestion[]): EditorQuestion[] {
  return questions.map((question, index) => ({
    ...question,
    sortOrder: (index + 1) * 10,
  }));
}
function toEditorQuestion(
  field: EventQuestionnaireField,
  keepId: boolean,
): EditorQuestion {
  return {
    ...(keepId ? { persistedId: field.id } : {}),
    fieldKey: field.fieldKey,
    fieldType: field.fieldType,
    label: field.label,
    required: field.required,
    purpose: field.purpose,
    retentionDays: String(field.retentionDays),
    options: field.options.map((option) => ({ ...option })),
    minLength:
      field.validation.minLength === undefined
        ? ""
        : String(field.validation.minLength),
    maxLength:
      field.validation.maxLength === undefined
        ? ""
        : String(field.validation.maxLength),
    minSelections:
      field.validation.minSelections === undefined
        ? ""
        : String(field.validation.minSelections),
    maxSelections:
      field.validation.maxSelections === undefined
        ? ""
        : String(field.validation.maxSelections),
    sortOrder: field.sortOrder,
  };
}
function editorFromForm(
  form: EventQuestionnaireForm,
  keepIds: boolean,
): EditorState {
  return {
    version: keepIds ? form.version : null,
    purpose: form.purpose,
    questions: form.fields.map((field) => toEditorQuestion(field, keepIds)),
  };
}
function editorSnapshot(editor: EditorState | null): string | null {
  return editor ? JSON.stringify(editor) : null;
}
function isNonNegativeInteger(value: string): boolean {
  if (!value.trim()) return true;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 10000;
}
function editorValidationIssue(editor: EditorState | null): string | null {
  if (!editor) return "Сначала создайте черновик.";
  if (!editor.purpose.trim()) return "Укажите цель анкеты.";
  if (!editor.questions.length) return "Добавьте хотя бы один вопрос.";
  for (let index = 0; index < editor.questions.length; index += 1) {
    const question = editor.questions[index];
    const number = index + 1;
    if (!question.label.trim()) return `Укажите текст вопроса ${number}.`;
    if (!question.purpose.trim()) return `Укажите цель вопроса ${number}.`;
    const retention = Number(question.retentionDays);
    if (!Number.isInteger(retention) || retention <= 0 || retention > 36500)
      return `Укажите положительный срок хранения для вопроса ${number}.`;
    if (
      question.fieldType === "single_select" ||
      question.fieldType === "multi_select"
    ) {
      if (!question.options.length)
        return `Добавьте хотя бы один вариант для вопроса ${number}.`;
      if (question.options.some((option) => !option.label.trim()))
        return `Заполните все варианты ответа в вопросе ${number}.`;
    }
    const values =
      question.fieldType === "short_text" || question.fieldType === "long_text"
        ? [question.minLength, question.maxLength]
        : question.fieldType === "multi_select"
          ? [question.minSelections, question.maxSelections]
          : [];
    if (values.some((value) => !isNonNegativeInteger(value)))
      return `Проверьте ограничения вопроса ${number}.`;
    const [minimum, maximum] =
      question.fieldType === "multi_select"
        ? [
            optionalNumber(question.minSelections),
            optionalNumber(question.maxSelections),
          ]
        : [
            optionalNumber(question.minLength),
            optionalNumber(question.maxLength),
          ];
    if (minimum !== undefined && maximum !== undefined && maximum < minimum)
      return `Максимальное значение вопроса ${number} должно быть не меньше минимального.`;
    if (
      question.fieldType === "multi_select" &&
      ((minimum ?? 0) > question.options.length ||
        (maximum ?? 0) > question.options.length)
    )
      return `Ограничения вопроса ${number} не должны превышать количество вариантов.`;
  }
  return null;
}
function questionValidationTarget(
  issue: string | null,
): QuestionValidationTarget | null {
  if (!issue) return null;
  const match = issue.match(/вопроса (\d+)/);
  if (!match) return null;
  const questionIndex = Number(match[1]) - 1;
  if (issue.startsWith("Укажите текст вопроса")) {
    return { questionIndex, field: "label" };
  }
  if (issue.startsWith("Укажите цель вопроса")) {
    return { questionIndex, field: "purpose" };
  }
  if (issue.startsWith("Укажите положительный срок хранения")) {
    return { questionIndex, field: "retention" };
  }
  if (
    issue.startsWith("Добавьте хотя бы один вариант") ||
    issue.startsWith("Заполните все варианты ответа")
  ) {
    return { questionIndex, field: "options" };
  }
  return { questionIndex, field: "constraints" };
}
function draftInput(editor: EditorState): EventQuestionnaireDraftInput {
  return {
    purpose: editor.purpose.trim(),
    fields: editor.questions.map((question) => ({
      fieldKey: question.fieldKey,
      fieldType: question.fieldType,
      label: question.label.trim(),
      required: question.required,
      purpose: question.purpose.trim(),
      retentionDays: Number(question.retentionDays),
      options: question.options.map((option) => ({
        value: option.value,
        label: option.label.trim(),
      })),
      validation:
        question.fieldType === "short_text" ||
        question.fieldType === "long_text"
          ? {
              minLength: optionalNumber(question.minLength),
              maxLength: optionalNumber(question.maxLength),
            }
          : question.fieldType === "multi_select"
            ? {
                minSelections: optionalNumber(question.minSelections),
                maxSelections: optionalNumber(question.maxSelections),
              }
            : {},
      sortOrder: question.sortOrder,
    })),
  };
}

function ControlledDialog({
  open,
  children,
  className,
}: {
  open: boolean;
  children: ReactNode;
  className: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && ref.current && !ref.current.open) ref.current.showModal();
  }, [open]);
  if (!open) return null;
  return (
    <dialog
      className={className}
      onCancel={(event) => event.preventDefault()}
      ref={ref}
    >
      {children}
    </dialog>
  );
}
function PublishedQuestionnaire({ form }: { form: EventQuestionnaireForm }) {
  return (
    <details className="event-questionnaire-card__published-details">
      <summary>Показать опубликованную версию {form.version}</summary>
      <dl className="event-questionnaire-card__facts">
        <div>
          <dt>Дата публикации</dt>
          <dd>{formatPublishedAt(form.publishedAt)}</dd>
        </div>
        <div>
          <dt>Цель анкеты</dt>
          <dd>{form.purpose}</dd>
        </div>
        <div>
          <dt>Вопросов</dt>
          <dd>{form.fields.length}</dd>
        </div>
      </dl>
      <ol className="event-questionnaire-card__published-list">
        {form.fields.map((field) => (
          <li key={field.id}>
            <strong>{field.label}</strong>
            <span>{FIELD_TYPE_LABELS[field.fieldType]}</span>
            <span>{field.required ? "Обязательный" : "Необязательный"}</span>
            <span>Хранение: {field.retentionDays} дн.</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

export function EventQuestionnaireCard({
  eventId,
  onDirtyChange,
}: EventQuestionnaireCardProps) {
  const [questionnaire, setQuestionnaire] =
    useState<AdminEventQuestionnaire | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [baselineSnapshot, setBaselineSnapshot] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveErrorLabel, setSaveErrorLabel] = useState("Ошибка сохранения");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [editingQuestionIndex, setEditingQuestionIndex] = useState<
    number | null
  >(null);
  const [validationTarget, setValidationTarget] =
    useState<QuestionValidationTarget | null>(null);
  const [privacyDetailsOpen, setPrivacyDetailsOpen] = useState(false);
  const [constraintsDetailsOpen, setConstraintsDetailsOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmationAction>(null);
  const purposeInputRef = useRef<HTMLTextAreaElement>(null);
  const applyLoadedQuestionnaire = (next: AdminEventQuestionnaire) => {
    const nextEditor = next.draft ? editorFromForm(next.draft, true) : null;
    setQuestionnaire(next);
    setEditor(nextEditor);
    setBaselineSnapshot(editorSnapshot(nextEditor));
  };
  useEffect(() => {
    let active = true;
    setQuestionnaire(null);
    setEditor(null);
    setBaselineSnapshot(null);
    setSavedAt(null);
    setLoading(true);
    setLoadError(null);
    setSaveError(null);
    setFeedback(null);
    void getAdminEventQuestionnaire(eventId)
      .then((next) => {
        if (active) applyLoadedQuestionnaire(next);
      })
      .catch((error: unknown) => {
        if (active)
          setLoadError(
            errorMessage(error, "Не удалось загрузить настройки анкеты."),
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [eventId, reloadKey]);
  const currentSnapshot = useMemo(() => editorSnapshot(editor), [editor]);
  const dirty = currentSnapshot !== baselineSnapshot;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [eventId, onDirtyChange]);
  const validationIssue = useMemo(
    () => editorValidationIssue(editor),
    [editor],
  );
  const busy = saving || lifecycleBusy;
  const editingQuestion =
    editingQuestionIndex === null
      ? null
      : (editor?.questions[editingQuestionIndex] ?? null);
  useEffect(() => {
    if (
      validationTarget?.field === "purpose" &&
      editingQuestionIndex === validationTarget.questionIndex
    ) {
      window.requestAnimationFrame(() => purposeInputRef.current?.focus());
    }
  }, [editingQuestionIndex, validationTarget]);
  const updateQuestion = (index: number, update: Partial<EditorQuestion>) => {
    setEditor((current) =>
      current
        ? {
            ...current,
            questions: current.questions.map((question, questionIndex) =>
              questionIndex === index ? { ...question, ...update } : question,
            ),
          }
        : current,
    );
    setSaveError(null);
    setFeedback(null);
    setValidationTarget(null);
  };
  const handleRefresh = () => {
    if (
      dirty &&
      !window.confirm(
        "Несохранённые изменения будут потеряны. Обновить анкету?",
      )
    )
      return;
    setReloadKey((current) => current + 1);
  };
  const handleStartDraft = () => {
    setEditor(
      questionnaire?.published
        ? editorFromForm(questionnaire.published, false)
        : { version: null, purpose: "", questions: [] },
    );
    setSaveError(null);
    setFeedback(
      "Черновик открыт для редактирования. Он будет сохранён только после явного сохранения.",
    );
  };
  const handleAddQuestion = () => {
    let index = 0;
    setEditor((current) => {
      if (!current) return current;
      index = current.questions.length;
      return {
        ...current,
        questions: normalizeQuestionOrder([
          ...current.questions,
          {
            fieldKey: nextStableValue(
              current.questions.map((question) => question.fieldKey),
              "question",
            ),
            fieldType: "short_text",
            label: "",
            required: false,
            purpose: "",
            retentionDays: "365",
            options: [],
            minLength: "",
            maxLength: "",
            minSelections: "",
            maxSelections: "",
            sortOrder: (current.questions.length + 1) * 10,
          },
        ]),
      };
    });
    setEditingQuestionIndex(index);
    setSaveError(null);
    setFeedback(null);
  };
  const handleMoveQuestion = (index: number, direction: -1 | 1) => {
    setEditor((current) => {
      if (!current) return current;
      const destination = index + direction;
      if (destination < 0 || destination >= current.questions.length)
        return current;
      const questions = [...current.questions];
      [questions[index], questions[destination]] = [
        questions[destination],
        questions[index],
      ];
      return { ...current, questions: normalizeQuestionOrder(questions) };
    });
    setSaveError(null);
    setFeedback(null);
  };
  const handleRemoveQuestion = (index: number) => {
    setEditor((current) =>
      current
        ? {
            ...current,
            questions: normalizeQuestionOrder(
              current.questions.filter(
                (_, questionIndex) => questionIndex !== index,
              ),
            ),
          }
        : current,
    );
    setSaveError(null);
    setFeedback(
      "Вопрос удалён из редактора и исчезнет с сервера после сохранения черновика.",
    );
  };
  const handleAddOption = (index: number) => {
    const question = editor?.questions[index];
    if (question)
      updateQuestion(index, {
        options: [
          ...question.options,
          {
            value: nextStableValue(
              question.options.map((option) => option.value),
              "option",
            ),
            label: "",
          },
        ],
      });
  };
  const handleSave = async () => {
    if (!editor || busy) return;
    if (validationIssue) {
      const target = questionValidationTarget(validationIssue);
      setValidationTarget(target);
      if (target) {
        setEditingQuestionIndex(target.questionIndex);
        setPrivacyDetailsOpen(
          target.field === "purpose" || target.field === "retention",
        );
        setConstraintsDetailsOpen(target.field === "constraints");
      }
      return;
    }
    setValidationTarget(null);
    setSaving(true);
    setSaveErrorLabel("Ошибка сохранения");
    setSaveError(null);
    setFeedback(null);
    try {
      const next = await saveAdminEventQuestionnaireDraft(
        eventId,
        draftInput(editor),
      );
      applyLoadedQuestionnaire(next);
      setSavedAt(new Date().toISOString());
    } catch (error) {
      setSaveError(
        errorMessage(error, "Не удалось сохранить черновик анкеты."),
      );
    } finally {
      setSaving(false);
    }
  };
  const runLifecycle = async () => {
    if (busy || !confirmation) return;
    const action = confirmation;
    setConfirmation(null);
    setLifecycleBusy(true);
    setSaveErrorLabel("Ошибка действия");
    setSaveError(null);
    setFeedback(null);
    try {
      const next =
        action === "publish"
          ? await publishAdminEventQuestionnaire(eventId)
          : action === "unpublish"
            ? await unpublishAdminEventQuestionnaire(eventId)
            : await deleteAdminEventQuestionnaireDraft(eventId);
      if (action === "unpublish") {
        setQuestionnaire(next);
      } else {
        applyLoadedQuestionnaire(next);
      }
      setSavedAt(new Date().toISOString());
      setFeedback(
        action === "publish"
          ? "Версия опубликована."
          : action === "unpublish"
            ? "Анкета снята с публикации."
            : "Неопубликованный черновик удалён.",
      );
    } catch (error) {
      setSaveError(
        errorMessage(error, "Не удалось выполнить действие с анкетой."),
      );
    } finally {
      setLifecycleBusy(false);
    }
  };
  if (loading && !questionnaire)
    return (
      <GlassCard className="event-questionnaire-card" elevated>
        <div className="event-questionnaire-card__state" role="status">
          Загружаем анкету регистрации…
        </div>
      </GlassCard>
    );
  if (loadError && !questionnaire)
    return (
      <GlassCard className="event-questionnaire-card" elevated>
        <div className="event-questionnaire-card__head">
          <div>
            <h2>Анкета регистрации</h2>
            <p>Дополнительные организационные вопросы для веб-регистрации.</p>
          </div>
        </div>
        <div className="form-error" role="alert">
          {loadError}
        </div>
        <div>
          <Button onClick={handleRefresh} variant="secondary">
            Повторить
          </Button>
        </div>
      </GlassCard>
    );
  const hasPublished = Boolean(questionnaire?.published);
  return (
    <GlassCard
      aria-busy={busy || loading}
      className="event-questionnaire-card"
      elevated
    >
      <div className="event-questionnaire-card__head">
        <div>
          <h2>Анкета регистрации</h2>
          <p>Дополнительные организационные вопросы для веб-регистрации.</p>
        </div>
        <Button
          disabled={busy || loading}
          onClick={handleRefresh}
          size="sm"
          variant="secondary"
        >
          {loading ? "Обновляем…" : "Обновить"}
        </Button>
      </div>
      <div className="event-questionnaire-card__boundary">
        Разрешены только обычные организационные вопросы. Чувствительные и
        специальные категории данных недоступны.
      </div>
      {loadError ? (
        <div className="form-error" role="alert">
          {loadError}
        </div>
      ) : null}
      {!hasPublished && !editor ? (
        <section className="event-questionnaire-card__empty">
          <div>
          <Badge tone="glass">Не настроена</Badge>
            <h3>Анкета пока не настроена</h3>
            <p>
              Создайте черновик и добавьте организационные вопросы. Участникам
              он не виден до публикации.
            </p>
          </div>
          <Button disabled={busy} onClick={handleStartDraft} variant="gold">
            Создать анкету
          </Button>
        </section>
      ) : null}
      {hasPublished ? (
        <section className="event-questionnaire-card__published">
          <div className="event-questionnaire-card__section-head">
            <div>
              <Badge tone="blue">Опубликована</Badge>
              <h3>Версия {questionnaire?.published?.version}</h3>
              <p>
                Опубликована{" "}
                {formatPublishedAt(
                  questionnaire?.published?.publishedAt ?? null,
                )}
              </p>
            </div>
            <div className="event-questionnaire-card__lifecycle-actions">
              <Button
                disabled={busy || Boolean(editor)}
                onClick={handleStartDraft}
                size="sm"
                variant="gold"
              >
                Редактировать
              </Button>
              <Button
                disabled={busy}
                onClick={() => setConfirmation("unpublish")}
                size="sm"
                variant="destructive"
              >
                Снять с публикации
              </Button>
            </div>
          </div>
          {questionnaire?.published ? (
            <PublishedQuestionnaire form={questionnaire.published} />
          ) : null}
        </section>
      ) : null}
      {editor ? (
        <section className="event-questionnaire-editor">
          <div className="event-questionnaire-card__section-head">
            <div>
              {hasPublished ? (
              <Badge tone="glass">
                  Черновик версии{" "}
                  {editor.version ??
                    (questionnaire?.published?.version ?? 0) + 1}{" "}
                  · не опубликован
                </Badge>
              ) : (
              <Badge tone="glass">Черновик</Badge>
              )}
              <h3>
                {hasPublished ? "Новая версия анкеты" : "Черновик анкеты"}
              </h3>
              <p>
                {hasPublished
                  ? "Редактирование создаёт новую версию. Ранее собранные ответы остаются привязаны к версии, на которой были отправлены."
                  : "Этот черновик не виден участникам."}
              </p>
            </div>
            {hasPublished ? (
              <div className="event-questionnaire-card__lifecycle-actions">
                <Button
                  disabled={busy}
                  onClick={() => setFeedback("Черновик уже открыт для редактирования.")}
                  size="sm"
                  variant="secondary"
                >
                  Продолжить редактирование
                </Button>
                {questionnaire?.draft ? (
                  <Button
                    disabled={busy || dirty || Boolean(validationIssue)}
                    onClick={() => setConfirmation("publish")}
                    size="sm"
                    variant="success"
                  >
                    Опубликовать
                  </Button>
                ) : null}
                <Button
                  disabled={busy}
                  onClick={() => setConfirmation("delete-draft")}
                  size="sm"
                  variant="destructive"
                >
                  Удалить черновик
                </Button>
              </div>
            ) : null}
          </div>
          <label className="event-form-field event-form-field--wide">
            <span>Цель анкеты</span>
            <textarea
              disabled={busy}
              maxLength={1000}
              onChange={(event) => {
                setEditor((current) =>
                  current
                    ? { ...current, purpose: event.target.value }
                    : current,
                );
                setSaveError(null);
              }}
              value={editor.purpose}
            />
            <em>Для чего организатору нужны дополнительные сведения.</em>
          </label>
          <div className="event-questionnaire-editor__questions">
            {editor.questions.length ? (
              editor.questions.map((question, index) => (
                <article
                  className="event-questionnaire-question event-questionnaire-question--compact"
                  key={question.fieldKey}
                >
                  <div className="event-questionnaire-question__summary">
                    <strong>
                      {index + 1}. {question.label || "Новый вопрос"}
                    </strong>
                    <span className="event-questionnaire-question__type">
                      {FIELD_TYPE_LABELS[question.fieldType]}
                    </span>
                    {question.required ? (
                      <span className="event-questionnaire-question__required-chip">
                        Обязательный
                      </span>
                    ) : null}
                  </div>
                  <div className="event-questionnaire-question__reorder">
                    <Button
                      aria-label="Переместить вопрос выше"
                      disabled={busy || index === 0}
                      onClick={() => handleMoveQuestion(index, -1)}
                      size="sm"
                      variant="ghost"
                    >
                      ↑
                    </Button>
                    <Button
                      aria-label="Переместить вопрос ниже"
                      disabled={busy || index === editor.questions.length - 1}
                      onClick={() => handleMoveQuestion(index, 1)}
                      size="sm"
                      variant="ghost"
                    >
                      ↓
                    </Button>
                    <Button
                      aria-label="Редактировать вопрос"
                      disabled={busy}
                      onClick={() => setEditingQuestionIndex(index)}
                      size="sm"
                      variant="ghost"
                    >
                      ✎
                    </Button>
                    <Button
                      aria-label="Удалить вопрос"
                      disabled={busy}
                      onClick={() => handleRemoveQuestion(index)}
                      size="sm"
                      variant="destructive"
                    >
                      🗑
                    </Button>
                  </div>
                </article>
              ))
            ) : (
              <p className="event-questionnaire-card__empty-note">
                Добавьте хотя бы один вопрос.
              </p>
            )}
          </div>
          <Button disabled={busy} onClick={handleAddQuestion} variant="gold">
            Добавить вопрос
          </Button>
          <div className="event-questionnaire-editor__actions">
            <Button
              disabled={busy || !dirty}
              onClick={() => void handleSave()}
              variant="success"
            >
              {saving ? "Сохраняем…" : "Сохранить черновик"}
            </Button>
            {questionnaire?.draft ? (
              <Button
                disabled={busy || dirty || Boolean(validationIssue)}
                onClick={() => setConfirmation("publish")}
                variant="success"
              >
                Опубликовать
              </Button>
            ) : null}
          </div>
          {validationIssue ? (
            <p className="event-questionnaire-editor__validation" role="status">
              {validationIssue}
            </p>
          ) : null}
          {!validationIssue && questionnaire?.draft && dirty ? (
            <p className="event-questionnaire-editor__validation" role="status">
              Сохраните изменения перед публикацией.
            </p>
          ) : null}
        </section>
      ) : null}
      {feedback ? (
        <p
          className="event-questionnaire-feedback event-questionnaire-feedback--success"
          role="status"
        >
          {feedback}
        </p>
      ) : null}
      <SaveStatusView
        error={saveError}
        errorLabel={saveErrorLabel}
        recovery="Проверьте данные; для загрузки состояния с сервера нажмите «Обновить»."
        savedAt={savedAt}
        saving={busy}
        unsaved={Boolean(editor) && dirty}
      />
      <ControlledDialog
        className="event-questionnaire-dialog"
        open={editingQuestion !== null}
      >
        <div className="event-questionnaire-dialog__head">
          <div>
            <h3>
              {editingQuestionIndex === null
                ? "Вопрос"
                : `Вопрос ${editingQuestionIndex + 1}`}
            </h3>
            <p>
              Настройте вопрос, затем сохраните черновик отдельным действием.
            </p>
          </div>
          <Button
            onClick={() => setEditingQuestionIndex(null)}
            size="sm"
            variant="ghost"
          >
            Закрыть
          </Button>
        </div>
        {editingQuestion && editingQuestionIndex !== null ? (
          <div className="event-questionnaire-dialog__body">
            <label className="event-form-field">
              <span>Текст вопроса</span>
              <input
                aria-invalid={validationTarget?.field === "label"}
                disabled={busy}
                maxLength={300}
                onChange={(event) =>
                  updateQuestion(editingQuestionIndex, {
                    label: event.target.value,
                  })
                }
                value={editingQuestion.label}
              />
            </label>
            <fieldset className="event-questionnaire-type-control">
              <legend>Тип вопроса</legend>
              <div>
                {FIELD_TYPES.map((type) => (
                  <button
                    aria-pressed={editingQuestion.fieldType === type}
                    disabled={busy}
                    key={type}
                    onClick={() =>
                      updateQuestion(editingQuestionIndex, {
                        fieldType: type,
                        options:
                          type === "single_select" || type === "multi_select"
                            ? editingQuestion.options
                            : [],
                        minLength:
                          type === "short_text" || type === "long_text"
                            ? editingQuestion.minLength
                            : "",
                        maxLength:
                          type === "short_text" || type === "long_text"
                            ? editingQuestion.maxLength
                            : "",
                        minSelections:
                          type === "multi_select"
                            ? editingQuestion.minSelections
                            : "",
                        maxSelections:
                          type === "multi_select"
                            ? editingQuestion.maxSelections
                            : "",
                      })
                    }
                    type="button"
                  >
                    {FIELD_TYPE_LABELS[type]}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="event-questionnaire-question__required">
              <input
                checked={editingQuestion.required}
                disabled={busy}
                onChange={(event) =>
                  updateQuestion(editingQuestionIndex, {
                    required: event.target.checked,
                  })
                }
                type="checkbox"
              />
              <span>Обязательный вопрос</span>
            </label>
            {editingQuestion.fieldType === "single_select" ||
            editingQuestion.fieldType === "multi_select" ? (
              <section className="event-questionnaire-options">
                <h4>Варианты ответа</h4>
                {editingQuestion.options.map((option, optionIndex) => (
                  <div
                    className="event-questionnaire-option"
                    key={option.value}
                  >
                    <input
                      aria-label={`Вариант ${optionIndex + 1}`}
                      aria-invalid={
                        validationTarget?.field === "options" &&
                        !option.label.trim()
                      }
                      disabled={busy}
                      maxLength={200}
                      onChange={(event) =>
                        updateQuestion(editingQuestionIndex, {
                          options: editingQuestion.options.map(
                            (item, itemIndex) =>
                              itemIndex === optionIndex
                                ? { ...item, label: event.target.value }
                                : item,
                          ),
                        })
                      }
                      value={option.label}
                    />
                    <Button
                      disabled={busy}
                      onClick={() =>
                        updateQuestion(editingQuestionIndex, {
                          options: editingQuestion.options.filter(
                            (_, itemIndex) => itemIndex !== optionIndex,
                          ),
                        })
                      }
                      size="sm"
                      variant="destructive"
                    >
                      Удалить
                    </Button>
                  </div>
                ))}
                <Button
                  disabled={busy}
                  onClick={() => handleAddOption(editingQuestionIndex)}
                  size="sm"
                  variant="gold"
                >
                  Добавить вариант
                </Button>
              </section>
            ) : null}
            <details
              className="event-questionnaire-dialog__details"
              onToggle={(event) =>
                setConstraintsDetailsOpen(event.currentTarget.open)
              }
              open={constraintsDetailsOpen}
            >
              <summary>Ограничения ответа</summary>
              <div className="event-questionnaire-question__validation">
                {editingQuestion.fieldType === "short_text" ||
                editingQuestion.fieldType === "long_text" ? (
                  <>
                    <label className="event-form-field">
                      <span>Минимальная длина</span>
                      <input
                        aria-invalid={validationTarget?.field === "constraints"}
                        disabled={busy}
                        min={0}
                        onChange={(event) =>
                          updateQuestion(editingQuestionIndex, {
                            minLength: event.target.value,
                          })
                        }
                        type="number"
                        value={editingQuestion.minLength}
                      />
                    </label>
                    <label className="event-form-field">
                      <span>Максимальная длина</span>
                      <input
                        aria-invalid={validationTarget?.field === "constraints"}
                        disabled={busy}
                        min={0}
                        onChange={(event) =>
                          updateQuestion(editingQuestionIndex, {
                            maxLength: event.target.value,
                          })
                        }
                        type="number"
                        value={editingQuestion.maxLength}
                      />
                    </label>
                  </>
                ) : null}
                {editingQuestion.fieldType === "multi_select" ? (
                  <>
                    <label className="event-form-field">
                      <span>Минимум вариантов</span>
                      <input
                        aria-invalid={validationTarget?.field === "constraints"}
                        disabled={busy}
                        min={0}
                        onChange={(event) =>
                          updateQuestion(editingQuestionIndex, {
                            minSelections: event.target.value,
                          })
                        }
                        type="number"
                        value={editingQuestion.minSelections}
                      />
                    </label>
                    <label className="event-form-field">
                      <span>Максимум вариантов</span>
                      <input
                        aria-invalid={validationTarget?.field === "constraints"}
                        disabled={busy}
                        min={0}
                        onChange={(event) =>
                          updateQuestion(editingQuestionIndex, {
                            maxSelections: event.target.value,
                          })
                        }
                        type="number"
                        value={editingQuestion.maxSelections}
                      />
                    </label>
                  </>
                ) : null}
              </div>
            </details>
            <details
              className="event-questionnaire-dialog__details"
              onToggle={(event) =>
                setPrivacyDetailsOpen(event.currentTarget.open)
              }
              open={privacyDetailsOpen}
            >
              <summary>Приватность и хранение</summary>
              <label className="event-form-field">
                <span>Зачем нужен ответ</span>
                <textarea
                  aria-invalid={validationTarget?.field === "purpose"}
                  disabled={busy}
                  maxLength={1000}
                  onChange={(event) =>
                    updateQuestion(editingQuestionIndex, {
                      purpose: event.target.value,
                    })
                  }
                  ref={purposeInputRef}
                  value={editingQuestion.purpose}
                />
              </label>
              <fieldset className="event-questionnaire-retention">
                <legend>Срок хранения</legend>
                <div>
                  {RETENTION_PRESETS.map((preset) => (
                    <button
                      aria-pressed={
                        editingQuestion.retentionDays === preset.value
                      }
                      disabled={busy}
                      key={preset.value}
                      onClick={() =>
                        updateQuestion(editingQuestionIndex, {
                          retentionDays: preset.value,
                        })
                      }
                      type="button"
                    >
                      {preset.label}
                    </button>
                  ))}
                  <button
                    aria-pressed={
                      !RETENTION_PRESETS.some(
                        (preset) =>
                          preset.value === editingQuestion.retentionDays,
                      )
                    }
                    disabled={busy}
                    onClick={() =>
                      updateQuestion(editingQuestionIndex, {
                        retentionDays: "",
                      })
                    }
                    type="button"
                  >
                    Другой срок
                  </button>
                </div>
                <label className="event-form-field">
                  <span>Дней</span>
                  <input
                    aria-invalid={validationTarget?.field === "retention"}
                    disabled={busy}
                    max={36500}
                    min={1}
                    onChange={(event) =>
                      updateQuestion(editingQuestionIndex, {
                        retentionDays: event.target.value,
                      })
                    }
                    type="number"
                    value={editingQuestion.retentionDays}
                  />
                </label>
              </fieldset>
            </details>
          </div>
        ) : null}
      </ControlledDialog>
      <ControlledDialog
        className="event-questionnaire-dialog event-questionnaire-dialog--confirmation"
        open={confirmation !== null}
      >
        <div className="event-questionnaire-dialog__head">
          <h3>
            {confirmation === "publish"
              ? "Опубликовать анкету?"
              : confirmation === "unpublish"
                ? "Снять анкету с публикации?"
                : "Удалить черновик?"}
          </h3>
        </div>
        <div className="event-questionnaire-dialog__body">
          <p>
            {confirmation === "publish"
              ? "Версия станет доступна участникам и останется неизменяемой."
              : confirmation === "unpublish"
                ? "Собранные ответы сохранятся; регистрации, уже начатые с этой анкетой, можно завершить; повторная публикация позже создаст новую версию."
                : "Будет удалён только неопубликованный черновик. Текущая опубликованная анкета и ранее собранные ответы не изменятся."}
          </p>
          <div className="event-questionnaire-dialog__actions">
            <Button
              disabled={busy}
              onClick={() => setConfirmation(null)}
              variant="secondary"
            >
              Отмена
            </Button>
            <Button
              disabled={busy}
              onClick={() => void runLifecycle()}
              variant={confirmation === "publish" ? "success" : "destructive"}
            >
              {confirmation === "publish"
                ? "Опубликовать"
                : confirmation === "unpublish"
                  ? "Снять с публикации"
                  : "Удалить черновик"}
            </Button>
          </div>
        </div>
      </ControlledDialog>
    </GlassCard>
  );
}
