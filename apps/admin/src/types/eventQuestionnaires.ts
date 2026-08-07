export type EventQuestionnaireFieldType =
  | "short_text"
  | "long_text"
  | "single_select"
  | "multi_select"
  | "boolean";

export type EventQuestionnaireStatus =
  | "draft"
  | "published"
  | "retired";

export type EventQuestionnaireDataCategory = "ordinary";
export type EventQuestionnaireChannel = "web";

export type EventQuestionnaireOption = {
  value: string;
  label: string;
};

export type EventQuestionnaireValidation = {
  minLength?: number;
  maxLength?: number;
  minSelections?: number;
  maxSelections?: number;
};

export type EventQuestionnaireField = {
  id: string;
  fieldKey: string;
  fieldType: EventQuestionnaireFieldType;
  label: string;
  required: boolean;
  purpose: string;
  retentionDays: number;
  options: EventQuestionnaireOption[];
  validation: EventQuestionnaireValidation;
  dataCategory: EventQuestionnaireDataCategory;
  sortOrder: number;
};

export type EventQuestionnaireForm = {
  id: string;
  eventId: string;
  channel: EventQuestionnaireChannel;
  version: number;
  purpose: string;
  status: EventQuestionnaireStatus;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  fields: EventQuestionnaireField[];
};

export type AdminEventQuestionnaire = {
  eventId: string;
  channel: EventQuestionnaireChannel;
  draft: EventQuestionnaireForm | null;
  published: EventQuestionnaireForm | null;
};

export type EventQuestionnaireDraftFieldInput = Omit<
  EventQuestionnaireField,
  "id" | "dataCategory"
>;

export type EventQuestionnaireDraftInput = {
  purpose: string;
  fields: EventQuestionnaireDraftFieldInput[];
};
