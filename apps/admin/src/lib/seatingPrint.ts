import type {
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

const PRINT_CANVAS_MAX_WIDTH = 980;
const PRINT_CANVAS_MAX_HEIGHT = 560;
const PRINT_CANVAS_MIN_SCALE = 0.46;

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

  const printSeats: SeatingPrintSeat[] = geometry.seats.map((seat, seatIndex) => {
    const occupant = occupantsBySeat.get(seatIndex) ?? null;
    const seatNumber = seatIndex + 1;
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
      scale: fitPrintCanvasScale(geometry.width, geometry.height),
      seats: printSeats,
      seams: geometry.seams,
      tables: tables.map<SeatingPrintTable>((table, index) => ({
        angle: table.angle || 0,
        cx: table.cx,
        cy: table.cy,
        h: table.h,
        id: table.id,
        isRabbiTable: table.isRabbiTable,
        label: table.isRabbiTable ? "Раввинский стол" : `Стол ${index + 1}`,
        w: table.w,
      })),
      width: Math.max(1, Math.ceil(geometry.width)),
    },
    header: {
      capacityBucketTitle: capacityBucketTitle.trim() || "Слот мест",
      eventTitle: eventTitle.trim() || "Событие",
      occurrenceSubtitle: occurrenceSubtitle.trim() || "Без отдельного сеанса",
      printedAtLabel: formatPrintTimestamp(printedAt),
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

export function formatPrintTimestamp(printedAt: Date): string {
  if (Number.isNaN(printedAt.getTime())) {
    return "Время печати не указано";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(printedAt);
}

function fitPrintCanvasScale(width: number, height: number): number {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 1;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 1;
  const rawScale = Math.min(
    1,
    PRINT_CANVAS_MAX_WIDTH / safeWidth,
    PRINT_CANVAS_MAX_HEIGHT / safeHeight,
  );

  return Math.max(PRINT_CANVAS_MIN_SCALE, Math.round(rawScale * 100) / 100);
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
