import type {
  ComputedSeat,
  SeatingGeometryResult,
  SeatingGuestPoolItem,
  SeatingPrintLegendItem,
  SeatingPrintModel,
  SeatingPrintSeat,
  SeatingPrintTable,
  SeatingPrintUnseatedItem,
  SeatingReservePoolItem,
  SeatingSeatOccupant,
  SeatingTable,
} from "../types/seating";
import { tableBounds } from "./seatingGeometry";

const PRINT_CONTENT_WIDTH = 1024;
const PRINT_CONTENT_HEIGHT = 684;
const PRINT_HEADER_HEIGHT = 70;
const PRINT_SCHEME_TITLE_HEIGHT = 20;
const PRINT_FIRST_PAGE_GAP = 10;
const PRINT_FIRST_PAGE_BOTTOM_BUFFER = 8;
const PRINT_MIN_VIEWPORT_HEIGHT = 300;
const PRINT_LEGEND_TITLE_HEIGHT = 20;
const PRINT_LEGEND_ROW_HEIGHT = 17;
const PRINT_LEGEND_GAP = 8;
const PRINT_UNSEATED_TITLE_HEIGHT = 18;
const PRINT_UNSEATED_ROW_HEIGHT = 16;
const PRINT_INLINE_LEGEND_MAX_HEIGHT = 150;
const PRINT_INLINE_MIN_SCALE = 0.42;
const PRINT_COMPACT_SCALE = 0.56;
const TABLE_ROW_GROUP_THRESHOLD = 46;

export type BuildSeatingPrintModelInput = {
  capacityBucketTitle: string;
  eventTitle: string;
  geometry: SeatingGeometryResult;
  occupants: readonly SeatingSeatOccupant[];
  occurrenceSubtitle: string;
  printedAt: Date;
  tables: readonly SeatingTable[];
  unseatedGuests?: readonly SeatingGuestPoolItem[];
  unseatedReserves?: readonly SeatingReservePoolItem[];
};

export function buildSeatingPrintModel({
  capacityBucketTitle,
  eventTitle,
  geometry,
  occupants,
  occurrenceSubtitle,
  printedAt,
  tables,
  unseatedGuests = [],
  unseatedReserves = [],
}: BuildSeatingPrintModelInput): SeatingPrintModel {
  const occupantsBySeat = new Map<number, SeatingSeatOccupant>();
  occupants.forEach((occupant) => {
    occupantsBySeat.set(occupant.seatIndex, occupant);
  });

  const tablePrintOrder = orderTablesForPrint(tables);
  const tablePrintOrderById = new Map(
    tablePrintOrder.map((table, index) => [table.id, index + 1]),
  );
  const printSeatNumberBySeatIndex = buildPrintSeatNumberBySeatIndex({
    geometry,
    tables: tablePrintOrder,
  });
  const legendColumns = PRINT_CONTENT_WIDTH >= 960 ? 4 : 3;
  const estimatedDetailsHeight = estimateDetailsHeight({
    legendCount: occupants.length,
    legendColumns,
    unseatedCount: unseatedGuests.length + unseatedReserves.length,
  });
  const detailsFitInline =
    estimatedDetailsHeight > 0 &&
    estimatedDetailsHeight <= PRINT_INLINE_LEGEND_MAX_HEIGHT;
  const inlineSchemeHeight = schemeViewportHeight(estimatedDetailsHeight);
  const inlineScale = fitPrintCanvasScale(
    geometry.width,
    geometry.height,
    PRINT_CONTENT_WIDTH,
    inlineSchemeHeight,
  );
  const inlineLegend =
    detailsFitInline && inlineScale >= PRINT_INLINE_MIN_SCALE;
  const viewportHeight = schemeViewportHeight(inlineLegend ? estimatedDetailsHeight : 0);
  const scale = fitPrintCanvasScale(
    geometry.width,
    geometry.height,
    PRINT_CONTENT_WIDTH,
    viewportHeight,
  );
  const scaledWidth = Math.ceil(Math.max(1, geometry.width) * scale);
  const scaledHeight = Math.ceil(Math.max(1, geometry.height) * scale);
  const viewportWidth = PRINT_CONTENT_WIDTH;
  const finalViewportHeight = Math.min(
    viewportHeight,
    Math.max(PRINT_MIN_VIEWPORT_HEIGHT, scaledHeight),
  );

  const printSeats: SeatingPrintSeat[] = geometry.seats.map((seat, seatIndex) => {
    const occupant = occupantsBySeat.get(seatIndex) ?? null;
    const seatNumber = printSeatNumberBySeatIndex[seatIndex];
    const initials = normalizeInitials(occupant?.initials, occupant?.type ?? "guest");
    const displayName = normalizeDisplayName(occupant?.displayName, occupant?.type ?? "guest");

    return {
      isHead: seatIndex === geometry.headIndex,
      isRabbiTable: seat.isRabbiTable,
      occupant: occupant
        ? {
            displayName,
            id: occupant.id,
            initials,
            isRabbiHead: Boolean(occupant.isRabbiHead),
            legendLabel:
              occupant.type === "reserve" ? `Резерв: ${displayName}` : displayName,
            schemeLabel: `${initials} ${seatNumber}`,
            seatNumber,
            type: occupant.type,
          }
        : null,
      seatNumber,
      x: seat.x,
      y: seat.y,
    };
  });

  const legend = printSeats
    .filter((seat): seat is SeatingPrintSeat & {
      occupant: NonNullable<SeatingPrintSeat["occupant"]>;
    } => seat.occupant !== null)
    .map<SeatingPrintLegendItem>((seat) => ({
      displayName: seat.occupant.displayName,
      id: seat.occupant.id,
      initials: seat.occupant.initials,
      legendLabel: seat.occupant.legendLabel,
      seatNumber: seat.seatNumber,
      type: seat.occupant.type,
    }))
    .sort((a, b) => a.seatNumber - b.seatNumber);

  return {
    canvas: {
      height: Math.max(1, Math.ceil(geometry.height)),
      isCompact: scale < PRINT_COMPACT_SCALE,
      offsetX: Math.max(0, Math.floor((viewportWidth - scaledWidth) / 2)),
      offsetY: Math.max(0, Math.floor((finalViewportHeight - scaledHeight) / 2)),
      printSeatNumberBySeatIndex,
      scale,
      seats: printSeats,
      seams: geometry.seams,
      tables: tables.map<SeatingPrintTable>((table, index) => ({
        angle: table.angle || 0,
        cx: table.cx,
        cy: table.cy,
        h: table.h,
        id: table.id,
        isRabbiTable: table.isRabbiTable,
        label: table.isRabbiTable
          ? `Стол ${tablePrintOrderById.get(table.id) ?? index + 1} · раввинский`
          : `Стол ${tablePrintOrderById.get(table.id) ?? index + 1}`,
        printOrder: tablePrintOrderById.get(table.id) ?? index + 1,
        w: table.w,
      })),
      viewportHeight: finalViewportHeight,
      viewportWidth,
      width: Math.max(1, Math.ceil(geometry.width)),
    },
    header: {
      capacityBucketTitle: capacityBucketTitle.trim() || "Слот мест",
      eventTitle: eventTitle.trim() || "Событие",
      occurrenceSubtitle: occurrenceSubtitle.trim() || "Без отдельного сеанса",
      printedAtLabel: formatPrintTimestamp(printedAt),
    },
    layout: {
      hasFullLegendPage:
        !inlineLegend &&
        (legend.length > 0 || unseatedGuests.length > 0 || unseatedReserves.length > 0),
      inlineLegend,
      legendColumns,
    },
    legend,
    unseated: [
      ...unseatedGuests.map<SeatingPrintUnseatedItem>((guest) => ({
        displayName: normalizeDisplayName(guest.displayName, "guest"),
        id: guest.id,
        initials: normalizeInitials(guest.initials, "guest"),
        type: "guest",
      })),
      ...unseatedReserves.map<SeatingPrintUnseatedItem>((reserve) => ({
        displayName: normalizeDisplayName(reserve.label, "reserve"),
        id: reserve.id,
        initials: normalizeInitials(reserve.initials, "reserve"),
        type: "reserve",
      })),
    ],
  };
}

export function buildPrintSeatNumberBySeatIndex({
  geometry,
  tables,
}: {
  geometry: SeatingGeometryResult;
  tables: readonly SeatingTable[];
}): Record<number, number> {
  const numberBySeatIndex: Record<number, number> = {};
  let nextNumber = 1;

  orderTablesForPrint(tables).forEach((table) => {
    const tableSeats = geometry.seats
      .map((seat, seatIndex) => ({ seat, seatIndex }))
      .filter(({ seat }) => seat.tableId === table.id);

    orderSeatsClockwiseFromTopLeft(tableSeats, table).forEach(({ seatIndex }) => {
      numberBySeatIndex[seatIndex] = nextNumber;
      nextNumber += 1;
    });
  });

  geometry.seats
    .map((seat, seatIndex) => ({ seat, seatIndex }))
    .filter(({ seatIndex }) => numberBySeatIndex[seatIndex] === undefined)
    .sort(compareSeatsByVisualPosition)
    .forEach(({ seatIndex }) => {
      numberBySeatIndex[seatIndex] = nextNumber;
      nextNumber += 1;
    });

  return numberBySeatIndex;
}

export function formatPrintTimestamp(printedAt: Date): string {
  if (Number.isNaN(printedAt.getTime())) {
    return "Время печати не указано";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(printedAt);
}

function fitPrintCanvasScale(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): number {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 1;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 1;
  const rawScale = Math.min(
    1,
    maxWidth / safeWidth,
    maxHeight / safeHeight,
  );

  return Math.max(0.24, Math.round(rawScale * 100) / 100);
}

function schemeViewportHeight(reservedDetailsHeight: number): number {
  return Math.max(
    220,
    PRINT_CONTENT_HEIGHT -
      PRINT_HEADER_HEIGHT -
      PRINT_SCHEME_TITLE_HEIGHT -
      PRINT_FIRST_PAGE_GAP * 3 -
      PRINT_FIRST_PAGE_BOTTOM_BUFFER -
      reservedDetailsHeight,
  );
}

function estimateDetailsHeight({
  legendColumns,
  legendCount,
  unseatedCount,
}: {
  legendColumns: 3 | 4;
  legendCount: number;
  unseatedCount: number;
}): number {
  if (legendCount === 0 && unseatedCount === 0) {
    return 0;
  }

  const legendRows =
    legendCount > 0 ? Math.ceil(legendCount / legendColumns) : 0;
  const unseatedRows =
    unseatedCount > 0 ? Math.ceil(unseatedCount / legendColumns) : 0;

  return (
    (legendCount > 0
      ? PRINT_LEGEND_TITLE_HEIGHT + PRINT_LEGEND_GAP + legendRows * PRINT_LEGEND_ROW_HEIGHT
      : 0) +
    (legendCount > 0 && unseatedCount > 0 ? PRINT_LEGEND_GAP : 0) +
    (unseatedCount > 0
      ? PRINT_UNSEATED_TITLE_HEIGHT + PRINT_LEGEND_GAP + unseatedRows * PRINT_UNSEATED_ROW_HEIGHT
      : 0)
  );
}

function orderTablesForPrint(tables: readonly SeatingTable[]): SeatingTable[] {
  const entries = tables
    .map((table) => ({
      bounds: tableBounds(table),
      table,
    }))
    .sort((a, b) =>
      a.bounds.minY - b.bounds.minY ||
      a.bounds.minX - b.bounds.minX ||
      a.table.id.localeCompare(b.table.id),
    );
  const rows: Array<{
    entries: typeof entries;
    top: number;
  }> = [];

  entries.forEach((entry) => {
    const row = rows.find(
      (candidate) => Math.abs(candidate.top - entry.bounds.minY) <= TABLE_ROW_GROUP_THRESHOLD,
    );

    if (row) {
      row.entries.push(entry);
      row.top =
        row.entries.reduce((sum, item) => sum + item.bounds.minY, 0) /
        row.entries.length;
      return;
    }

    rows.push({ entries: [entry], top: entry.bounds.minY });
  });

  return rows
    .sort((a, b) => a.top - b.top)
    .flatMap((row) =>
      row.entries
        .sort((a, b) =>
          a.bounds.minX - b.bounds.minX ||
          a.table.cx - b.table.cx ||
          a.table.id.localeCompare(b.table.id),
        )
        .map((entry) => entry.table),
    );
}

type SeatWithIndex = {
  seat: ComputedSeat;
  seatIndex: number;
};

function orderSeatsClockwiseFromTopLeft(
  seats: SeatWithIndex[],
  table: SeatingTable,
): SeatWithIndex[] {
  if (seats.length <= 1) {
    return seats;
  }

  const startSeat = [...seats].sort(compareSeatsByVisualPosition)[0];
  const startAngle = screenAngleFromTableCenter(startSeat.seat, table);

  return [...seats].sort((a, b) => {
    const angleA = relativeClockwiseAngle(
      screenAngleFromTableCenter(a.seat, table),
      startAngle,
    );
    const angleB = relativeClockwiseAngle(
      screenAngleFromTableCenter(b.seat, table),
      startAngle,
    );

    return (
      angleA - angleB ||
      distanceFromTableCenter(a.seat, table) - distanceFromTableCenter(b.seat, table) ||
      a.seatIndex - b.seatIndex
    );
  });
}

function compareSeatsByVisualPosition(a: SeatWithIndex, b: SeatWithIndex): number {
  return (
    a.seat.y - b.seat.y ||
    a.seat.x - b.seat.x ||
    a.seat.tableId.localeCompare(b.seat.tableId) ||
    a.seatIndex - b.seatIndex
  );
}

function screenAngleFromTableCenter(seat: ComputedSeat, table: SeatingTable): number {
  return Math.atan2(seat.y - table.cy, seat.x - table.cx);
}

function relativeClockwiseAngle(angle: number, startAngle: number): number {
  const fullTurn = Math.PI * 2;
  return (angle - startAngle + fullTurn) % fullTurn;
}

function distanceFromTableCenter(seat: ComputedSeat, table: SeatingTable): number {
  return Math.hypot(seat.x - table.cx, seat.y - table.cy);
}

function normalizeInitials(
  initials: string | null | undefined,
  type: "guest" | "reserve",
): string {
  const value = initials?.trim();
  if (value) {
    return value;
  }

  return type === "reserve" ? "Рез" : "?";
}

function normalizeDisplayName(
  displayName: string | null | undefined,
  type: "guest" | "reserve",
): string {
  const value = displayName?.trim();
  if (value) {
    return value;
  }

  return type === "reserve" ? "Резерв" : "Гость";
}
