import { useEffect, useMemo, useState } from "react";

import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { SaveStatusView } from "../ui/SaveStatusView";
import { GlassCard } from "../ui/GlassCard";
import {
  getAdminEventQuestionnaire,
  publishAdminEventQuestionnaire,
  saveAdminEventQuestionnaireDraft,
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
};

type EditorOption = {
  value: string;
  label: string;
};

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

const FIELD_TYPE_LABELS: Record<EventQuestionnaireFieldType, string> = {
  short_text: "Короткий текст",
  long_text: "Длинный текст",
  single_select: "Один вариант",
  multi_select: "Несколько вариантов",
  boolean: "Да / нет",
};

const FIELD_TYPES = Object.keys(FIELD_TYPE_LABELS) as EventQuestionnaireFieldType[];

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function formatPublishedAt(value: string | null): string {
  if (!value) return "Дата недоступна";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Дата недоступна";
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(date);
}

function optionalNumber(value: string): number | undefined {
  return value.trim() === "" ? undefined : Number(value);
}

function toEditorQuestion(field: EventQuestionnaireField, keepId: boolean): EditorQuestion {
  return {
    ...(keepId ? { persistedId: field.id } : {}),
    fieldKey: field.fieldKey,
    fieldType: field.fieldType,
    label: field.label,
    required: field.required,
    purpose: field.purpose,
    retentionDays: String(field.retentionDays),
    options: field.options.map((option) => ({ ...option })),
    minLength: field.validation.minLength === undefined
      ? ""
      : String(field.validation.minLength),
    maxLength: field.validation.maxLength === undefined
      ? ""
      : String(field.validation.maxLength),
    minSelections: field.validation.minSelections === undefined
      ? ""
      : String(field.validation.minSelections),
    maxSelections: field.validation.maxSelections === undefined
      ? ""
      : String(field.validation.maxSelections),
    sortOrder: field.sortOrder,
  };
}

function editorFromForm(form: EventQuestionnaireForm, keepIds: boolean): EditorState {
  return {
    version: keepIds ? form.version : null,
    purpose: form.purpose,
    questions: form.fields.map((field) => toEditorQuestion(field, keepIds)),
  };
}

function editorSnapshot(editor: EditorState | null): string | null {
  return editor === null ? null : JSON.stringify(editor);
}

function normalizeQuestionOrder(questions: EditorQuestion[]): EditorQuestion[] {
  return questions.map((question, index) => ({
    ...question,
    sortOrder: (index + 1) * 10,
  }));
}

function nextStableValue(existing: Iterable<string>, prefix: "question" | "option"): string {
  const used = new Set(existing);
  let index = 1;
  while (used.has(`${prefix}_${index}`)) index += 1;
  return `${prefix}_${index}`;
}

function isNonNegativeInteger(value: string): boolean {
  if (value.trim() === "") return true;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 10000;
}

function editorValidationIssue(editor: EditorState | null): string | null {
  if (!editor) return "Сначала создайте черновик.";
  if (!editor.purpose.trim()) return "Укажите цель анкеты.";
  if (editor.questions.length === 0) return "Добавьте хотя бы один вопрос.";

  for (let index = 0; index < editor.questions.length; index += 1) {
    const question = editor.questions[index];
    const number = index + 1;
    if (!question.label.trim()) return `Укажите текст вопроса ${number}.`;
    if (!question.purpose.trim()) return `Укажите цель вопроса ${number}.`;

    const retention = Number(question.retentionDays);
    if (!Number.isInteger(retention) || retention <= 0 || retention > 36500) {
      return `Укажите положительный срок хранения для вопроса ${number}.`;
    }

    if (question.fieldType === "single_select" || question.fieldType === "multi_select") {
      if (question.options.length === 0) {
        return `Добавьте хотя бы один вариант для вопроса ${number}.`;
      }
      const optionValues = new Set<string>();
      for (const option of question.options) {
        if (!option.label.trim()) return `Заполните все варианты ответа в вопросе ${number}.`;
        if (optionValues.has(option.value)) {
          return `Технические значения вариантов в вопросе ${number} должны быть уникальны.`;
        }
        optionValues.add(option.value);
      }
    }

    const validationValues = question.fieldType === "short_text" || question.fieldType === "long_text"
      ? [question.minLength, question.maxLength]
      : question.fieldType === "multi_select"
        ? [question.minSelections, question.maxSelections]
        : [];
    if (validationValues.some((value) => !isNonNegativeInteger(value))) {
      return `Проверьте правила проверки для вопроса ${number}.`;
    }

    if (question.fieldType === "short_text" || question.fieldType === "long_text") {
      const minimum = optionalNumber(question.minLength);
      const maximum = optionalNumber(question.maxLength);
      if (minimum !== undefined && maximum !== undefined && maximum < minimum) {
        return `Максимальная длина вопроса ${number} должна быть не меньше минимальной.`;
      }
    }

    if (question.fieldType === "multi_select") {
      const minimum = optionalNumber(question.minSelections);
      const maximum = optionalNumber(question.maxSelections);
      if (minimum !== undefined && maximum !== undefined && maximum < minimum) {
        return `Максимум вариантов вопроса ${number} должен быть не меньше минимума.`;
      }
      if (
        (minimum !== undefined && minimum > question.options.length)
        || (maximum !== undefined && maximum > question.options.length)
      ) {
        return `Правила вопроса ${number} не должны превышать количество вариантов.`;
      }
    }
  }
  return null;
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
      validation: question.fieldType === "short_text" || question.fieldType === "long_text"
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

function PublishedQuestionnaire({ form }: { form: EventQuestionnaireForm }) {
  return (
    <section className="event-questionnaire-card__published">
      <div className="event-questionnaire-card__section-head">
        <div>
          <h3>Опубликованная версия {form.version}</h3>
          <p>Опубликованная версия доступна только для чтения.</p>
        </div>
        <Badge tone="blue">Опубликовано</Badge>
      </div>
      <dl className="event-questionnaire-card__facts">
        <div>
          <dt>Дата публикации</dt>
          <dd>{formatPublishedAt(form.publishedAt)}</dd>
        </div>
        <div>
          <dt>Purpose</dt>
          <dd>{form.purpose}</dd>
        </div>
        <div>
          <dt>Количество вопросов</dt>
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
    </section>
  );
}

export function EventQuestionnaireCard({ eventId }: EventQuestionnaireCardProps) {
  const [questionnaire, setQuestionnaire] = useState<AdminEventQuestionnaire | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [baselineSnapshot, setBaselineSnapshot] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveErrorLabel, setSaveErrorLabel] = useState("Ошибка сохранения");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

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
        if (active) {
          setLoadError(errorMessage(error, "Не удалось загрузить настройки анкеты."));
        }
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
  const validationIssue = useMemo(() => editorValidationIssue(editor), [editor]);
  const busy = saving || publishing;

  const updateQuestion = (index: number, update: Partial<EditorQuestion>) => {
    setEditor((current) => {
      if (!current) return current;
      return {
        ...current,
        questions: current.questions.map((question, questionIndex) =>
          questionIndex === index ? { ...question, ...update } : question),
      };
    });
    setSaveError(null);
    setFeedback(null);
  };

  const handleRefresh = () => {
    if (
      dirty
      && !window.confirm("Несохранённые изменения будут потеряны. Обновить анкету?")
    ) {
      return;
    }
    setReloadKey((current) => current + 1);
  };

  const handleStartDraft = () => {
    const nextEditor = questionnaire?.published
      ? editorFromForm(questionnaire.published, false)
      : { version: null, purpose: "", questions: [] };
    setEditor(nextEditor);
    setSaveError(null);
    setFeedback("Создан локальный новый черновик. Он ещё не сохранён на сервере.");
  };

  const handleAddQuestion = () => {
    setEditor((current) => {
      if (!current) return current;
      const fieldKey = nextStableValue(current.questions.map((question) => question.fieldKey), "question");
      return {
        ...current,
        questions: normalizeQuestionOrder([
          ...current.questions,
          {
            fieldKey,
            fieldType: "short_text",
            label: "",
            required: false,
            purpose: "",
            retentionDays: "",
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
    setSaveError(null);
    setFeedback(null);
  };

  const handleRemoveQuestion = (index: number) => {
    const wasPersisted = Boolean(editor?.questions[index]?.persistedId);
    setEditor((current) => {
      if (!current) return current;
      return {
        ...current,
        questions: normalizeQuestionOrder(
          current.questions.filter((_, questionIndex) => questionIndex !== index),
        ),
      };
    });
    setSaveError(null);
    setFeedback(
      wasPersisted
        ? "Вопрос удалён из редактора. На сервере он будет удалён только после сохранения черновика."
        : "Несохранённый вопрос удалён.",
    );
  };

  const handleMoveQuestion = (index: number, direction: -1 | 1) => {
    setEditor((current) => {
      if (!current) return current;
      const destination = index + direction;
      if (destination < 0 || destination >= current.questions.length) return current;
      const questions = [...current.questions];
      [questions[index], questions[destination]] = [questions[destination], questions[index]];
      return { ...current, questions: normalizeQuestionOrder(questions) };
    });
    setSaveError(null);
    setFeedback(null);
  };

  const handleAddOption = (questionIndex: number) => {
    setEditor((current) => {
      if (!current) return current;
      return {
        ...current,
        questions: current.questions.map((question, index) => {
          if (index !== questionIndex) return question;
          const value = nextStableValue(question.options.map((option) => option.value), "option");
          return { ...question, options: [...question.options, { value, label: "" }] };
        }),
      };
    });
    setSaveError(null);
    setFeedback(null);
  };

  const handleSave = async () => {
    if (!editor || validationIssue || saving || publishing) return;
    setSaveErrorLabel("Ошибка сохранения");
    setSaving(true);
    setSaveError(null);
    setFeedback(null);

    try {
      const next = await saveAdminEventQuestionnaireDraft(eventId, draftInput(editor));
      applyLoadedQuestionnaire(next);
      setSavedAt(new Date().toISOString());
    } catch (error) {
      setSaveError(errorMessage(error, "Не удалось сохранить черновик анкеты."));
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!questionnaire?.draft || dirty || validationIssue || saving || publishing) return;
    const confirmed = window.confirm(
      "После публикации эта версия станет доступна странице веб-регистрации.\n"
      + "Текущая опубликованная версия, если она есть, будет заменена новой.\n"
      + "Опубликованная версия становится неизменяемой.",
    );
    if (!confirmed) return;

    setSavedAt(null);
    setSaveErrorLabel("Ошибка публикации");
    setPublishing(true);
    setSaveError(null);
    setFeedback(null);
    try {
      const publishedResult = await publishAdminEventQuestionnaire(eventId);
      try {
        const refreshed = await getAdminEventQuestionnaire(eventId);
        applyLoadedQuestionnaire(refreshed);
        setFeedback("Версия опубликована.");
      } catch (refreshError) {
        setSaveErrorLabel("Ошибка обновления после публикации");
        applyLoadedQuestionnaire(publishedResult);
        setSaveError(
          errorMessage(
            refreshError,
            "Версия опубликована, но обновить состояние не удалось. Нажмите «Обновить».",
          ),
        );
      }
    } catch (error) {
      setSaveError(errorMessage(error, "Не удалось опубликовать версию анкеты."));
    } finally {
      setPublishing(false);
    }
  };

  if (loading && !questionnaire) {
    return (
      <GlassCard className="event-questionnaire-card" elevated>
        <div className="event-questionnaire-card__state" role="status">
          Загружаем анкету регистрации…
        </div>
      </GlassCard>
    );
  }

  if (loadError && !questionnaire) {
    return (
      <GlassCard className="event-questionnaire-card" elevated>
        <div className="event-questionnaire-card__head">
          <div>
            <h2>Анкета регистрации</h2>
            <p>Дополнительные организационные вопросы для веб-регистрации.</p>
          </div>
        </div>
        <div className="form-error" role="alert">{loadError}</div>
        <div>
          <Button onClick={handleRefresh} variant="secondary">Повторить</Button>
        </div>
      </GlassCard>
    );
  }

  return (
    <GlassCard aria-busy={busy || loading} className="event-questionnaire-card" elevated>
      <div className="event-questionnaire-card__head">
        <div>
          <h2>Анкета регистрации</h2>
          <p>Дополнительные организационные вопросы для веб-регистрации.</p>
        </div>
        <Button disabled={busy || loading} onClick={handleRefresh} size="sm" variant="secondary">
          {loading ? "Обновляем…" : "Обновить"}
        </Button>
      </div>

      <div className="event-questionnaire-card__boundary">
        Разрешены только обычные организационные вопросы. Чувствительные и специальные
        категории данных недоступны.
      </div>

      {loadError ? <div className="form-error" role="alert">{loadError}</div> : null}

      {questionnaire?.published ? (
        <PublishedQuestionnaire form={questionnaire.published} />
      ) : (
        <section className="event-questionnaire-card__empty">
          <h3>Опубликованной версии нет</h3>
          <p>Создайте и сохраните черновик, затем опубликуйте его отдельным действием.</p>
        </section>
      )}

      {!editor ? (
        <section className="event-questionnaire-card__new-version">
          <p>
            {questionnaire?.published
              ? "Новая версия может быть подготовлена как копия опубликованной анкеты."
              : "Черновика пока нет."}
          </p>
          <Button disabled={busy} onClick={handleStartDraft} variant="gold">
            Создать новую версию
          </Button>
        </section>
      ) : (
        <section className="event-questionnaire-editor">
          <div className="event-questionnaire-card__section-head">
            <div>
              <h3>{editor.version === null ? "Новый черновик" : `Черновик версии ${editor.version}`}</h3>
              <p>
                {editor.version === null
                  ? "Локальная версия ещё не сохранена на сервере."
                  : dirty
                    ? "Есть несохранённые изменения."
                    : "Черновик синхронизирован с сервером."}
              </p>
            </div>
          </div>

          <label className="event-form-field event-form-field--wide">
            <span>Цель анкеты</span>
            <textarea
              disabled={busy}
              maxLength={1000}
              onChange={(event) => {
                setEditor((current) => current ? { ...current, purpose: event.target.value } : current);
                setSaveError(null);
                setFeedback(null);
              }}
              value={editor.purpose}
            />
            <em>Для чего организатору нужны эти дополнительные сведения.</em>
          </label>

          <div className="event-questionnaire-editor__questions">
            {editor.questions.length === 0 ? (
              <p className="event-questionnaire-card__empty-note">Добавьте хотя бы один вопрос.</p>
            ) : null}

            {editor.questions.map((question, questionIndex) => (
              <article className="event-questionnaire-question" key={question.fieldKey}>
                <div className="event-questionnaire-question__head">
                  <div>
                    <h4>Вопрос {questionIndex + 1}</h4>
                    <small>
                      Технический ключ: {question.fieldKey} · Порядок: {question.sortOrder}
                    </small>
                  </div>
                  <div className="event-questionnaire-question__reorder">
                    <Button
                      disabled={busy || questionIndex === 0}
                      onClick={() => handleMoveQuestion(questionIndex, -1)}
                      size="sm"
                      variant="ghost"
                    >
                      Выше
                    </Button>
                    <Button
                      disabled={busy || questionIndex === editor.questions.length - 1}
                      onClick={() => handleMoveQuestion(questionIndex, 1)}
                      size="sm"
                      variant="ghost"
                    >
                      Ниже
                    </Button>
                  </div>
                </div>

                <div className="event-questionnaire-question__grid">
                  <label className="event-form-field event-form-field--wide">
                    <span>Текст вопроса</span>
                    <input
                      disabled={busy}
                      maxLength={300}
                      onChange={(event) => updateQuestion(questionIndex, { label: event.target.value })}
                      value={question.label}
                    />
                  </label>
                  <label className="event-form-field">
                    <span>Тип вопроса</span>
                    <select
                      disabled={busy}
                      onChange={(event) => {
                        const nextType = event.target.value as EventQuestionnaireFieldType;
                        updateQuestion(questionIndex, {
                          fieldType: nextType,
                          options: nextType === "single_select" || nextType === "multi_select"
                            ? question.options
                            : [],
                          minLength: nextType === "short_text" || nextType === "long_text"
                            ? question.minLength
                            : "",
                          maxLength: nextType === "short_text" || nextType === "long_text"
                            ? question.maxLength
                            : "",
                          minSelections: nextType === "multi_select" ? question.minSelections : "",
                          maxSelections: nextType === "multi_select" ? question.maxSelections : "",
                        });
                      }}
                      value={question.fieldType}
                    >
                      {FIELD_TYPES.map((type) => (
                        <option key={type} value={type}>{FIELD_TYPE_LABELS[type]}</option>
                      ))}
                    </select>
                  </label>
                  <label className="event-questionnaire-question__required">
                    <input
                      checked={question.required}
                      disabled={busy}
                      onChange={(event) => updateQuestion(questionIndex, { required: event.target.checked })}
                      type="checkbox"
                    />
                    <span>Обязательный вопрос</span>
                  </label>
                  <label className="event-form-field event-form-field--wide">
                    <span>Цель вопроса</span>
                    <textarea
                      disabled={busy}
                      maxLength={1000}
                      onChange={(event) => updateQuestion(questionIndex, { purpose: event.target.value })}
                      value={question.purpose}
                    />
                  </label>
                  <label className="event-form-field">
                    <span>Срок хранения, дней</span>
                    <input
                      disabled={busy}
                      max={36500}
                      min={1}
                      onChange={(event) => updateQuestion(questionIndex, { retentionDays: event.target.value })}
                      type="number"
                      value={question.retentionDays}
                    />
                  </label>
                </div>

                {(question.fieldType === "short_text" || question.fieldType === "long_text") ? (
                  <div className="event-questionnaire-question__validation">
                    <label className="event-form-field">
                      <span>Минимальная длина</span>
                      <input
                        disabled={busy}
                        min={0}
                        onChange={(event) => updateQuestion(questionIndex, { minLength: event.target.value })}
                        type="number"
                        value={question.minLength}
                      />
                    </label>
                    <label className="event-form-field">
                      <span>Максимальная длина</span>
                      <input
                        disabled={busy}
                        min={0}
                        onChange={(event) => updateQuestion(questionIndex, { maxLength: event.target.value })}
                        type="number"
                        value={question.maxLength}
                      />
                    </label>
                  </div>
                ) : null}

                {question.fieldType === "multi_select" ? (
                  <div className="event-questionnaire-question__validation">
                    <label className="event-form-field">
                      <span>Минимум вариантов</span>
                      <input
                        disabled={busy}
                        min={0}
                        onChange={(event) => updateQuestion(questionIndex, { minSelections: event.target.value })}
                        type="number"
                        value={question.minSelections}
                      />
                    </label>
                    <label className="event-form-field">
                      <span>Максимум вариантов</span>
                      <input
                        disabled={busy}
                        min={0}
                        onChange={(event) => updateQuestion(questionIndex, { maxSelections: event.target.value })}
                        type="number"
                        value={question.maxSelections}
                      />
                    </label>
                  </div>
                ) : null}

                {(question.fieldType === "single_select" || question.fieldType === "multi_select") ? (
                  <div className="event-questionnaire-options">
                    <h5>Варианты ответа</h5>
                    {question.options.map((option, optionIndex) => (
                      <div className="event-questionnaire-option" key={option.value}>
                        <label className="event-form-field">
                          <span>Название варианта</span>
                          <input
                            disabled={busy}
                            maxLength={200}
                            onChange={(event) => {
                              const options = question.options.map((item, index) =>
                                index === optionIndex ? { ...item, label: event.target.value } : item);
                              updateQuestion(questionIndex, { options });
                            }}
                            value={option.label}
                          />
                          <em>Техническое значение: {option.value}</em>
                        </label>
                        <Button
                          disabled={busy}
                          onClick={() => {
                            updateQuestion(questionIndex, {
                              options: question.options.filter((_, index) => index !== optionIndex),
                            });
                          }}
                          size="sm"
                          variant="destructive"
                        >
                          Удалить вариант
                        </Button>
                      </div>
                    ))}
                    <Button
                      disabled={busy}
                      onClick={() => handleAddOption(questionIndex)}
                      size="sm"
                      variant="gold"
                    >
                      Добавить вариант
                    </Button>
                  </div>
                ) : null}

                <div className="event-questionnaire-question__remove">
                  <Button
                    disabled={busy}
                    onClick={() => handleRemoveQuestion(questionIndex)}
                    size="sm"
                    variant="destructive"
                  >
                    Удалить вопрос
                  </Button>
                </div>
              </article>
            ))}
          </div>

          <Button disabled={busy} onClick={handleAddQuestion} variant="gold">
            Добавить вопрос
          </Button>

          <div className="event-questionnaire-editor__actions">
            <div>
              <Button
                disabled={busy || !dirty || Boolean(validationIssue)}
                onClick={() => void handleSave()}
                variant="success"
              >
                {saving ? "Сохраняем…" : "Сохранить черновик"}
              </Button>
              {questionnaire?.draft ? (
                <Button
                  disabled={busy || dirty || Boolean(validationIssue)}
                  onClick={() => void handlePublish()}
                  variant="success"
                >
                  {publishing ? "Публикуем…" : "Опубликовать версию"}
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
          </div>
        </section>
      )}

      {feedback ? <p className="event-questionnaire-feedback event-questionnaire-feedback--success" role="status">{feedback}</p> : null}
      <SaveStatusView
        saving={busy}
        unsaved={Boolean(editor) && dirty}
        savedAt={savedAt}
        error={saveError}
        errorLabel={saveErrorLabel}
        recovery="Проверьте данные; для загрузки состояния с сервера нажмите «Обновить»."
      />
    </GlassCard>
  );
}
