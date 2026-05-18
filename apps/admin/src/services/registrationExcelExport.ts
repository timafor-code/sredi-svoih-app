import writeXlsxFile, {
  type Cell,
  type Feature,
  type Sheet,
  type SheetData,
} from "write-excel-file/browser";
import {
  getOrderOfSiblings,
  insertElementMarkupAccordingToOrderOfSiblings,
} from "write-excel-file/utility";

import { listEventRegistrations } from "./adminEventsService";
import type { AdminEventOccurrence } from "../types/eventOccurrences";
import type {
  AdminEventRegistrationRow,
  AdminRegistrationEventSummary,
  AdminRegistrationOptionSelectionSummary,
} from "../types/registrations";

type BrowserFileContent = File | Blob | ArrayBuffer;

type RegistrationExcelExportOccurrence = Pick<
  AdminEventOccurrence,
  "id" | "startsAt" | "title"
>;

export type RegistrationExcelExportOptions = {
  occurrence?: RegistrationExcelExportOccurrence | null;
};

type RegistrationExcelExportScope = {
  occurrence: RegistrationExcelExportOccurrence | null;
};

type RegistrationExportColumn = {
  header: string;
  key: keyof RegistrationExportRow;
  maxWidth?: number;
  minWidth?: number;
  wrap?: boolean;
};

type RegistrationExportRow = {
  eventTitle: string;
  occurrenceDate: string;
  occurrenceTitle: string;
  fullName: string;
  email: string;
  phone: string;
  status: string;
  paymentStatus: string;
  selectedOptions: string;
  seatsCount: number;
  guests: string;
  comment: string;
  amount: number | null;
  currency: string;
  registeredAt: string;
  confirmedAt: string;
  cancelledAt: string;
};

type RegistrationExportRowWithStatus = RegistrationExportRow & {
  statusKey: string;
};

type OccurrenceExportGroup = {
  name: string;
  registrations: AdminEventRegistrationRow[];
};

export type RegistrationExcelExportResult = {
  fileName: string;
  rowCount: number;
};

const EXPORT_PAGE_SIZE = 200;
const EXCEL_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ALL_REGISTRATIONS_SHEET_NAME = "Все регистрации";

const EXPORT_COLUMNS: RegistrationExportColumn[] = [
  { header: "Событие", key: "eventTitle", maxWidth: 44, minWidth: 18 },
  { header: "Дата события / сеанс", key: "occurrenceDate", maxWidth: 28, minWidth: 18 },
  { header: "Название сеанса", key: "occurrenceTitle", maxWidth: 34, minWidth: 18 },
  { header: "ФИО", key: "fullName", maxWidth: 34, minWidth: 18 },
  { header: "Email", key: "email", maxWidth: 34, minWidth: 14 },
  { header: "Телефон", key: "phone", maxWidth: 22, minWidth: 14 },
  { header: "Статус", key: "status", maxWidth: 20, minWidth: 14 },
  { header: "Оплата", key: "paymentStatus", maxWidth: 22, minWidth: 14 },
  {
    header: "Варианты участия",
    key: "selectedOptions",
    maxWidth: 48,
    minWidth: 22,
    wrap: true,
  },
  { header: "Количество мест", key: "seatsCount", maxWidth: 18, minWidth: 16 },
  { header: "Гости", key: "guests", maxWidth: 36, minWidth: 16, wrap: true },
  { header: "Комментарий", key: "comment", maxWidth: 44, minWidth: 18, wrap: true },
  { header: "Сумма", key: "amount", maxWidth: 16, minWidth: 12 },
  { header: "Валюта", key: "currency", maxWidth: 12, minWidth: 10 },
  { header: "Дата записи", key: "registeredAt", maxWidth: 24, minWidth: 18 },
  { header: "Дата подтверждения", key: "confirmedAt", maxWidth: 24, minWidth: 18 },
  { header: "Дата отмены", key: "cancelledAt", maxWidth: 24, minWidth: 18 },
];

const STATUS_BACKGROUND_COLORS: Record<string, string> = {
  attended: "#ddf7e5",
  cancelled: "#eceff3",
  confirmed: "#ddf7e5",
  no_show: "#fbe3e5",
  pending: "#fff0c2",
  rejected: "#fbe3e5",
  waitlisted: "#eee7ff",
};

export async function exportEventRegistrationsToExcel(
  event: AdminRegistrationEventSummary,
  options: RegistrationExcelExportOptions = {},
): Promise<RegistrationExcelExportResult> {
  const scope: RegistrationExcelExportScope = {
    occurrence: options.occurrence ?? null,
  };
  const registrations = await fetchAllEventRegistrations(event.eventId, scope);
  const sheets = createRegistrationSheets(event, registrations, scope);
  const blob = await writeXlsxFile(sheets, {
    features: [createAutoFilterFeature()],
    fontFamily: "Calibri",
    fontSize: 11,
  })
    .toBlob();
  const fileName = buildExportFileName(event.title, scope);

  downloadBlob(blob, fileName);

  return {
    fileName,
    rowCount: registrations.length,
  };
}

async function fetchAllEventRegistrations(
  eventId: string,
  scope: RegistrationExcelExportScope,
): Promise<AdminEventRegistrationRow[]> {
  const registrations: AdminEventRegistrationRow[] = [];
  let offset = 0;

  while (true) {
    const page = await listEventRegistrations({
      eventId,
      occurrenceId: scope.occurrence?.id ?? null,
      limit: EXPORT_PAGE_SIZE,
      offset,
    });

    registrations.push(...page);

    if (page.length < EXPORT_PAGE_SIZE) {
      return registrations;
    }

    offset += EXPORT_PAGE_SIZE;
  }
}

function createRegistrationSheets(
  event: AdminRegistrationEventSummary,
  registrations: AdminEventRegistrationRow[],
  scope: RegistrationExcelExportScope,
): Array<Sheet<BrowserFileContent>> {
  const sheets: Array<Sheet<BrowserFileContent>> = [
    createRegistrationSheet(ALL_REGISTRATIONS_SHEET_NAME, event, registrations),
  ];

  if (scope.occurrence) {
    return sheets;
  }

  const usedSheetNames = new Set([ALL_REGISTRATIONS_SHEET_NAME]);

  for (const group of groupRegistrationsByOccurrence(registrations)) {
    const sheetName = makeUniqueSheetName(group.name, usedSheetNames);
    sheets.push(createRegistrationSheet(sheetName, event, group.registrations));
  }

  return sheets;
}

function createRegistrationSheet(
  sheetName: string,
  event: AdminRegistrationEventSummary,
  registrations: AdminEventRegistrationRow[],
): Sheet<BrowserFileContent> {
  const rows = registrations.map((registration) => buildExportRow(registration, event));

  return {
    columns: createColumnWidths(rows),
    data: createSheetData(rows),
    sheet: sheetName,
    stickyRowsCount: 1,
  };
}

function createSheetData(rows: RegistrationExportRowWithStatus[]): SheetData {
  return [
    EXPORT_COLUMNS.map((column) => ({
      alignVertical: "center",
      backgroundColor: "#f4f7fb",
      bottomBorderColor: "#d8dee8",
      bottomBorderStyle: "thin",
      fontWeight: "bold",
      value: column.header,
      wrap: true,
    })),
    ...rows.map((row) => EXPORT_COLUMNS.map((column) => createBodyCell(row, column))),
  ];
}

function createBodyCell(
  row: RegistrationExportRowWithStatus,
  column: RegistrationExportColumn,
): Cell {
  const value = row[column.key];
  const cell = {
    alignVertical: "top",
    wrap: column.wrap === true,
  } satisfies Partial<Extract<Cell, object>>;

  if (value === null || value === "") {
    return {
      ...cell,
      value: "",
    };
  }

  if (typeof value === "number") {
    return {
      ...cell,
      format: column.key === "amount" ? "#,##0.00" : undefined,
      type: Number,
      value,
    };
  }

  return {
    ...cell,
    backgroundColor:
      column.key === "status" ? STATUS_BACKGROUND_COLORS[row.statusKey] : undefined,
    format: "@",
    type: String,
    value,
  };
}

function createColumnWidths(
  rows: RegistrationExportRowWithStatus[],
): Array<{ width: number }> {
  return EXPORT_COLUMNS.map((column) => ({
    width: getColumnWidth(
      column,
      rows.map((row) => row[column.key]),
    ),
  }));
}

function buildExportRow(
  registration: AdminEventRegistrationRow,
  event: AdminRegistrationEventSummary,
): RegistrationExportRowWithStatus {
  return {
    amount: getRegistrationAmount(registration),
    cancelledAt: formatDateTime(registration.cancelledAt),
    comment: registration.comment ?? "",
    confirmedAt: formatDateTime(registration.confirmedAt),
    currency: getRegistrationCurrency(registration),
    email: registration.email ?? "",
    eventTitle: event.title,
    fullName: registration.participantDisplayName,
    guests: registration.guestNames.join(", "),
    occurrenceDate: formatDateTime(registration.occurrenceStartsAt ?? event.startsAt),
    occurrenceTitle: registration.occurrenceTitle ?? "",
    paymentStatus: formatPaymentStatus(registration.paymentStatus, registration.paymentId),
    phone: registration.phone ?? "",
    registeredAt: formatDateTime(registration.registeredAt),
    seatsCount: registration.seatsCount,
    selectedOptions: formatSelectedOptions(registration.selectedOptions),
    status: formatRegistrationStatus(registration.status),
    statusKey: registration.status,
  };
}

function groupRegistrationsByOccurrence(
  registrations: AdminEventRegistrationRow[],
): OccurrenceExportGroup[] {
  const groups = new Map<string, OccurrenceExportGroup>();

  for (const registration of registrations) {
    if (!registration.occurrenceId && !registration.occurrenceStartsAt) {
      continue;
    }

    const key =
      registration.occurrenceId ??
      registration.occurrenceStartsAt ??
      registration.occurrenceTitle ??
      "occurrence";
    const existingGroup = groups.get(key);

    if (existingGroup) {
      existingGroup.registrations.push(registration);
      continue;
    }

    groups.set(key, {
      name: formatOccurrenceSheetName(registration),
      registrations: [registration],
    });
  }

  return Array.from(groups.values()).sort((left, right) =>
    left.name.localeCompare(right.name, "ru"),
  );
}

function formatOccurrenceSheetName(registration: AdminEventRegistrationRow): string {
  if (registration.occurrenceStartsAt) {
    const date = new Date(registration.occurrenceStartsAt);

    if (!Number.isNaN(date.getTime())) {
      const day = String(date.getDate()).padStart(2, "0");
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const hours = String(date.getHours()).padStart(2, "0");
      const minutes = String(date.getMinutes()).padStart(2, "0");

      return `${day}.${month} ${hours}-${minutes}`;
    }
  }

  return registration.occurrenceTitle ?? "Сеанс";
}

function getColumnWidth(
  column: RegistrationExportColumn,
  values: Array<RegistrationExportRow[keyof RegistrationExportRow]>,
): number {
  const contentWidth = values.reduce<number>((maxWidth, value) => {
    const text = formatCellValueForWidth(value);
    const longestLine = text
      .split("\n")
      .reduce((lineMax, line) => Math.max(lineMax, line.length), 0);

    return Math.max(maxWidth, longestLine);
  }, column.header.length);

  const minWidth = column.minWidth ?? 12;
  const maxWidth = column.maxWidth ?? 36;

  return Math.min(maxWidth, Math.max(minWidth, contentWidth + 2));
}

function formatCellValueForWidth(value: RegistrationExportRow[keyof RegistrationExportRow]): string {
  if (value === null) {
    return "";
  }

  return String(value);
}

function formatRegistrationStatus(status: string): string {
  const labels: Record<string, string> = {
    attended: "Пришёл",
    cancelled: "Отменено",
    confirmed: "Подтверждено",
    no_show: "No-show",
    pending: "Заявка",
    rejected: "Отклонено",
    waitlisted: "Лист ожидания",
  };

  return labels[status] ?? status;
}

function formatPaymentStatus(status: string, paymentId?: string | null): string {
  if (isSimulatedPaymentId(paymentId ?? null)) {
    return "Тестовая оплата";
  }

  const labels: Record<string, string> = {
    cancelled: "Отменено",
    failed: "Ошибка оплаты",
    not_required: "Не требуется",
    paid: "Оплачено",
    pending: "Ожидает оплаты",
    refunded: "Возврат",
    succeeded: "Оплачено",
  };

  return labels[status] ?? status;
}

function isSimulatedPaymentId(paymentId: string | null): boolean {
  return paymentId?.startsWith("simulated:") === true;
}

function formatSelectedOptions(
  selectedOptions: AdminRegistrationOptionSelectionSummary[],
): string {
  return selectedOptions
    .map((option) => {
      const donationLabel = option.isDonation ? " (пожертвование)" : "";
      return `${option.title}${donationLabel} × ${option.quantity} — ${formatAmountWithCurrency(
        option.totalAmount,
        option.currency,
      )}`;
    })
    .join("\n");
}

function formatAmountWithCurrency(amount: number, currency: string): string {
  return `${formatNumber(amount)} ${currency}`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
}

function getRegistrationAmount(registration: AdminEventRegistrationRow): number | null {
  if (registration.totalAmount !== null) {
    return registration.totalAmount;
  }

  const selectedOptionsTotal = registration.selectedOptions.reduce(
    (sum, option) => sum + option.totalAmount,
    0,
  );

  return selectedOptionsTotal > 0 ? selectedOptionsTotal : null;
}

function getRegistrationCurrency(registration: AdminEventRegistrationRow): string {
  return registration.selectedOptions[0]?.currency ?? "RUB";
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function downloadBlob(blob: Blob, fileName: string): void {
  if (typeof document === "undefined") {
    throw new Error("Скачивание Excel доступно только в браузере.");
  }

  const xlsxBlob =
    blob.type === EXCEL_MIME_TYPE ? blob : new Blob([blob], { type: EXCEL_MIME_TYPE });
  const url = URL.createObjectURL(xlsxBlob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";

  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function buildExportFileName(
  eventTitle: string,
  scope: RegistrationExcelExportScope,
): string {
  const occurrencePart = scope.occurrence
    ? formatOccurrenceForFileName(scope.occurrence)
    : null;
  const parts = [
    "registrations",
    sanitizeFileNamePart(eventTitle),
    occurrencePart,
    formatDateForFileName(new Date()),
  ].filter((part): part is string => Boolean(part));

  return `${parts.join("_")}.xlsx`;
}

function sanitizeFileNamePart(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64)
    .replace(/_+$/g, "");

  return cleaned || "event";
}

function formatDateForFileName(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatOccurrenceForFileName(
  occurrence: RegistrationExcelExportOccurrence,
): string {
  const startsAt = parseDate(occurrence.startsAt);

  if (startsAt) {
    const year = startsAt.getFullYear();
    const month = String(startsAt.getMonth() + 1).padStart(2, "0");
    const day = String(startsAt.getDate()).padStart(2, "0");
    const hours = String(startsAt.getHours()).padStart(2, "0");
    const minutes = String(startsAt.getMinutes()).padStart(2, "0");

    return `${year}-${month}-${day}_${hours}-${minutes}`;
  }

  return sanitizeFileNamePart(occurrence.title ?? occurrence.id);
}

function parseDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function makeUniqueSheetName(name: string, usedNames: Set<string>): string {
  const baseName = sanitizeSheetName(name);

  if (!usedNames.has(baseName)) {
    usedNames.add(baseName);
    return baseName;
  }

  let suffixIndex = 2;

  while (true) {
    const suffix = ` (${suffixIndex})`;
    const candidate = `${baseName.slice(0, 31 - suffix.length).trim()}${suffix}`;

    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }

    suffixIndex += 1;
  }
}

function sanitizeSheetName(value: string): string {
  const cleaned = value
    .replace(/[\\/?*:[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 31)
    .trim();

  return cleaned || "Лист";
}

function createAutoFilterFeature(): Feature<BrowserFileContent> {
  return {
    files: {
      transform: {
        "xl/worksheets/sheet{id}.xml": {
          transform: (xml) => {
            if (xml.includes("<autoFilter")) {
              return xml;
            }

            const lastRow = getLastSheetRow(xml);
            const lastColumn = getExcelColumnName(EXPORT_COLUMNS.length);
            const autoFilter = `<autoFilter ref="A1:${lastColumn}${lastRow}"/>`;
            const siblingOrder =
              getOrderOfSiblings("xl/worksheets/sheet{id}.xml", "worksheet") ??
              DEFAULT_WORKSHEET_SIBLING_ORDER;

            return insertElementMarkupAccordingToOrderOfSiblings(
              xml,
              autoFilter,
              siblingOrder,
              "worksheet",
            );
          },
        },
      },
    },
  };
}

const DEFAULT_WORKSHEET_SIBLING_ORDER = [
  "sheetPr",
  "dimension",
  "sheetViews",
  "sheetFormatPr",
  "cols",
  "sheetData",
  "sheetCalcPr",
  "sheetProtection",
  "protectedRanges",
  "scenarios",
  "autoFilter",
  "sortState",
  "mergeCells",
  "conditionalFormatting",
  "dataValidations",
  "hyperlinks",
  "printOptions",
  "pageMargins",
  "pageSetup",
  "headerFooter",
  "drawing",
];

function getLastSheetRow(xml: string): number {
  const rowMatches = xml.matchAll(/<row[^>]*\sr="(\d+)"/g);
  let lastRow = 1;

  for (const match of rowMatches) {
    lastRow = Math.max(lastRow, Number(match[1]));
  }

  return lastRow;
}

function getExcelColumnName(columnNumber: number): string {
  let name = "";
  let current = columnNumber;

  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - remainder) / 26);
  }

  return name;
}
