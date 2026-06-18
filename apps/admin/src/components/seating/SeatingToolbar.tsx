import { Button } from "../ui/Button";

type SaveStatusTone = "muted" | "success" | "error";

type TemplateToolbarProps = {
  isLoading: boolean;
  isSaving: boolean;
  onSave: () => void;
  saveDisabled: boolean;
  statusMessage: string | null;
  statusTone: SaveStatusTone;
  variant: "templates";
};

type LayoutToolbarProps = {
  capacityLabel: string;
  hasSelectedTable: boolean;
  isLoading: boolean;
  onAddTable: () => void;
  onRemoveTable: () => void;
  onRotateTable: () => void;
  onSetAllSideSeats: (sideSeats: 2 | 3) => void;
  onToggleSelectedSideSeats: () => void;
  physicalSeatCount: number;
  rabbiReserveCount: number;
  removeDisabled: boolean;
  seamCount: number;
  seatsModeLabel: string;
  selectedTableSideSeats: number | null;
  tableCount: number;
  variant: "layout";
};

export type SeatingToolbarProps = TemplateToolbarProps | LayoutToolbarProps;

export function SeatingToolbar(props: SeatingToolbarProps) {
  if (props.variant === "templates") {
    return (
      <div className="seat-toolbar">
        <div className="seat-layouts">
          <label className="seat-template-field">
            <span>Готовая расстановка</span>
            <select aria-label="Готовая расстановка столов" value="builtin:blank" disabled>
              <option value="builtin:blank">Пустой конструктор</option>
            </select>
          </label>
          <Button disabled size="sm" variant="secondary">
            Сохранить как шаблон
          </Button>
          <Button disabled size="sm" variant="secondary">
            Удалить шаблон
          </Button>
        </div>

        {props.statusMessage ? (
          <span
            className={`seat-save-status seat-save-status--${props.statusTone}`}
            role={props.statusTone === "error" ? "alert" : "status"}
          >
            {props.statusMessage}
          </span>
        ) : null}

        <Button
          className="seat-toolbar__save"
          disabled={props.saveDisabled || props.isLoading || props.isSaving}
          onClick={props.onSave}
          size="sm"
          variant="gold"
        >
          {props.isSaving ? "Сохраняем..." : "Сохранить"}
        </Button>
      </div>
    );
  }

  const selectedSideSeats = props.selectedTableSideSeats === 2 ? 2 : 3;

  return (
    <div className="seat-layout-controls">
      <span className="seat-controls-label">Расстановка столов</span>
      <Button disabled={props.isLoading} onClick={props.onAddTable} size="sm" variant="secondary">
        + Стол
      </Button>
      <Button
        disabled={props.isLoading || !props.hasSelectedTable}
        onClick={props.onRotateTable}
        size="sm"
        title="Повернуть выбранный стол на 90 градусов"
        variant="secondary"
      >
        ↻ 90°
      </Button>
      <Button
        disabled={props.isLoading || !props.hasSelectedTable}
        onClick={props.onToggleSelectedSideSeats}
        size="sm"
        title={`Сейчас ${selectedSideSeats} места/стор.; переключить выбранный стол`}
        variant="secondary"
      >
        2/3 места
      </Button>
      <Button
        disabled={props.isLoading || props.tableCount === 0}
        onClick={() => props.onSetAllSideSeats(2)}
        size="sm"
        variant="secondary"
      >
        Все столы: 2 места/стор.
      </Button>
      <Button
        disabled={props.isLoading || props.tableCount === 0}
        onClick={() => props.onSetAllSideSeats(3)}
        size="sm"
        variant="secondary"
      >
        Все столы: 3 места/стор.
      </Button>
      <Button
        disabled={props.isLoading || props.removeDisabled}
        onClick={props.onRemoveTable}
        size="sm"
        variant="secondary"
      >
        Удалить стол
      </Button>
      <span className="seat-toolbar__sep" />
      <span className="seat-count" aria-live="polite">
        <span className="seat-count__main">
          {props.tableCount} стол. · {props.physicalSeatCount} потенциальных мест
        </span>
        <span className="seat-count__sub">
          {props.seamCount} стык. · {props.capacityLabel} · {props.seatsModeLabel} ·
          раввинский резерв {props.rabbiReserveCount} · фигура без рассадки
        </span>
      </span>
    </div>
  );
}
