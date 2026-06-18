import type { ReactNode } from "react";

import { Button } from "../ui/Button";

type LayoutToolbarProps = {
  hasSelectedTable: boolean;
  isLoading: boolean;
  onAddTable: () => void;
  onRemoveTable: () => void;
  onRotateTable: () => void;
  onSetAllSideSeats: (sideSeats: 2 | 3) => void;
  onToggleSelectedSideSeats: () => void;
  removeDisabled: boolean;
  selectedTableSideSeats: number | null;
  // PR 18: the single capacity/status line shown in the toolbar footer. The parent
  // builds it (table count + capacity numbers + seams/mode/rabbi reserve) so the
  // footer stays one line instead of a separate summary row below the modal.
  statusSummary: ReactNode;
  tableCount: number;
  variant: "layout";
};

export type SeatingToolbarProps = LayoutToolbarProps;

export function SeatingToolbar(props: SeatingToolbarProps) {
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
      {props.statusSummary}
    </div>
  );
}
