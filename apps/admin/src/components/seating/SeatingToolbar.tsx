import { Button } from "../ui/Button";

type LayoutToolbarProps = {
  addDisabled: boolean;
  addDisabledReason?: string | null;
  allSideSeatsDisabled: boolean;
  allSideSeatsDisabledReason?: string | null;
  onAddTable: () => void;
  onRemoveTable: () => void;
  onRotateTable: () => void;
  onSetAllSideSeats: (sideSeats: 2 | 3) => void;
  onToggleSelectedSideSeats: () => void;
  removeDisabled: boolean;
  removeDisabledReason?: string | null;
  rotateDisabled: boolean;
  rotateDisabledReason?: string | null;
  selectedTableSideSeats: number | null;
  sideSeatsDisabled: boolean;
  sideSeatsDisabledReason?: string | null;
  tableCount: number;
  variant: "layout";
};

export type SeatingToolbarProps = LayoutToolbarProps;

export function SeatingToolbar(props: SeatingToolbarProps) {
  const selectedSideSeats = props.selectedTableSideSeats === 2 ? 2 : 3;

  return (
    <div className="seat-layout-controls">
      <span className="seat-controls-label">Расстановка столов</span>
      <Button
        aria-keyshortcuts="N"
        disabled={props.addDisabled}
        onClick={props.onAddTable}
        size="sm"
        title={buttonTitle(props.addDisabled, props.addDisabledReason, "Добавить стол (N)")}
        variant="secondary"
      >
        + Стол
      </Button>
      <Button
        aria-keyshortcuts="R"
        disabled={props.rotateDisabled}
        onClick={props.onRotateTable}
        size="sm"
        title={buttonTitle(
          props.rotateDisabled,
          props.rotateDisabledReason,
          "Повернуть (R)",
        )}
        variant="secondary"
      >
        ↻ 90°
      </Button>
      <Button
        disabled={props.sideSeatsDisabled}
        onClick={props.onToggleSelectedSideSeats}
        size="sm"
        title={buttonTitle(
          props.sideSeatsDisabled,
          props.sideSeatsDisabledReason,
          `Сейчас ${selectedSideSeats} места/стор.; переключить выбранный стол`,
        )}
        variant="secondary"
      >
        2/3 места
      </Button>
      <Button
        disabled={props.allSideSeatsDisabled}
        onClick={() => props.onSetAllSideSeats(2)}
        size="sm"
        title={buttonTitle(
          props.allSideSeatsDisabled,
          props.allSideSeatsDisabledReason,
          "Поставить всем столам 2 места на сторону",
        )}
        variant="secondary"
      >
        Все столы: 2 места/стор.
      </Button>
      <Button
        disabled={props.allSideSeatsDisabled}
        onClick={() => props.onSetAllSideSeats(3)}
        size="sm"
        title={buttonTitle(
          props.allSideSeatsDisabled,
          props.allSideSeatsDisabledReason,
          "Поставить всем столам 3 места на сторону",
        )}
        variant="secondary"
      >
        Все столы: 3 места/стор.
      </Button>
      <Button
        aria-keyshortcuts="Delete Backspace"
        disabled={props.removeDisabled}
        onClick={props.onRemoveTable}
        size="sm"
        title={buttonTitle(
          props.removeDisabled,
          props.removeDisabledReason,
          "Удалить (Delete)",
        )}
        variant="secondary"
      >
        Удалить стол
      </Button>
      <span className="seat-toolbar__sep" />
      <SeatingShortcutLegend />
    </div>
  );
}

export function SeatingShortcutLegend() {
  return (
    <div aria-label="Горячие клавиши" className="seat-shortcuts">
      <span>
        <kbd>N</kbd> добавить стол
      </span>
      <span>
        <kbd>R</kbd> повернуть
      </span>
      <span>
        <kbd>Delete</kbd> удалить
      </span>
      <span>
        <kbd>Esc</kbd> отменить / закрыть
      </span>
    </div>
  );
}

function buttonTitle(
  disabled: boolean,
  disabledReason: string | null | undefined,
  enabledTitle: string,
): string {
  return disabled ? disabledReason ?? enabledTitle : enabledTitle;
}
