import { Button } from "../ui/Button";

export type SeatingToolbarProps = {
  addDisabled: boolean; addDisabledReason?: string | null;
  allSideSeats: 2 | 3 | null; allSideSeatsDisabled: boolean; allSideSeatsDisabledReason?: string | null;
  onAddTable: () => void; onRemoveTable: () => void; onRotateTable: () => void;
  onSetAllSideSeats: (sideSeats: 2 | 3) => void; onSetSelectedSideSeats: (sideSeats: 2 | 3) => void;
  onToggleSeatEdit: () => void;
  removeDisabled: boolean; removeDisabledReason?: string | null;
  rotateDisabled: boolean; rotateDisabledReason?: string | null;
  seatEditDisabled: boolean; seatEditDisabledReason?: string | null; seatEditEnabled: boolean;
  selectedTableSideSeats: number | null; sideSeatsDisabled: boolean; sideSeatsDisabledReason?: string | null;
  variant: "layout";
};

export function SeatingToolbar(props: SeatingToolbarProps) {
  return <div className="seat-layout-controls">
    <div className="seat-controls-group"><span className="seat-controls-group__label">Расстановка столов</span>
      <Button aria-keyshortcuts="N" disabled={props.addDisabled} onClick={props.onAddTable} size="sm" title={buttonTitle(props.addDisabled, props.addDisabledReason, "Добавить стол (N)")} variant="secondary">+ Стол</Button>
      <Button aria-keyshortcuts="R" disabled={props.rotateDisabled} onClick={props.onRotateTable} size="sm" title={buttonTitle(props.rotateDisabled, props.rotateDisabledReason, "Повернуть (R)")} variant="secondary">↻</Button>
      <Button aria-keyshortcuts="Delete Backspace" disabled={props.removeDisabled} onClick={props.onRemoveTable} size="sm" title={buttonTitle(props.removeDisabled, props.removeDisabledReason, "Удалить (Delete)")} variant="secondary">⌫</Button>
    </div><span className="seat-controls-divider" />
    <div className="seat-controls-group" role="group" aria-label="Мест на сторону у выбранного стола"><span className="seat-controls-group__label">Выбранный стол</span><div className="seat-seg">
      {[2, 3].map((value) => <button aria-pressed={props.selectedTableSideSeats === value} className={props.selectedTableSideSeats === value ? "seat-seg__option is-on" : "seat-seg__option"} disabled={props.sideSeatsDisabled} key={value} onClick={() => props.onSetSelectedSideSeats(value as 2 | 3)} title={buttonTitle(props.sideSeatsDisabled, props.sideSeatsDisabledReason, `${value} места на сторону`)} type="button">{value}</button>)}</div><span className="seat-controls-group__unit">места/стор.</span></div>
    <span className="seat-controls-divider" />
    <div className="seat-controls-group" role="group" aria-label="Мест на сторону у всех столов"><span className="seat-controls-group__label">Все столы</span><div className="seat-seg">
      {[2, 3].map((value) => <button aria-pressed={props.allSideSeats === value} className={props.allSideSeats === value ? "seat-seg__option is-on" : "seat-seg__option"} disabled={props.allSideSeatsDisabled} key={value} onClick={() => props.onSetAllSideSeats(value as 2 | 3)} title={buttonTitle(props.allSideSeatsDisabled, props.allSideSeatsDisabledReason, `${value} места на сторону всем столам`)} type="button">{value}</button>)}</div><span className="seat-controls-group__unit">места/стор.</span></div>
    <span className="seat-controls-divider" />
    <Button className={props.seatEditEnabled ? "is-on" : undefined} disabled={props.seatEditDisabled} onClick={props.onToggleSeatEdit} size="sm" title={buttonTitle(props.seatEditDisabled, props.seatEditDisabledReason, "Выключение мест")} variant="secondary">⌾ Выключение мест</Button>
    <SeatingShortcutLegend />
  </div>;
}

export function SeatingShortcutLegend() { return <div aria-label="Горячие клавиши" className="seat-shortcuts"><span><kbd>N</kbd> добавить стол</span><span><kbd>R</kbd> повернуть</span><span><kbd>Delete</kbd> удалить</span><span><kbd>Esc</kbd> отменить / закрыть</span><span><kbd>Колесо зажать</kbd> — двигать схему</span></div>; }
function buttonTitle(disabled: boolean, disabledReason: string | null | undefined, enabledTitle: string): string { return disabled ? disabledReason ?? enabledTitle : enabledTitle; }
