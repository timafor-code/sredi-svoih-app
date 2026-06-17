import { Button } from "../ui/Button";

type RegistrationMainActionsProps = {
  eventsLoading: boolean;
  excelExportLoading: boolean;
  exportDisabled: boolean;
  exportHint: string;
  onExportExcel: () => void;
  onRefresh: () => void;
  registrationsLoading: boolean;
};

export function RegistrationMainActions({
  eventsLoading,
  excelExportLoading,
  exportDisabled,
  exportHint,
  onExportExcel,
  onRefresh,
  registrationsLoading,
}: RegistrationMainActionsProps) {
  return (
                <div className="registrations-main-actions">
                  <div className="registrations-export-group">
                    <Button
                      disabled={exportDisabled}
                      onClick={onExportExcel}
                      size="sm"
                      variant="gold"
                    >
                      {excelExportLoading ? "Готовим Excel..." : "Экспорт Excel"}
                    </Button>
                    <small className="registrations-export-hint">{exportHint}</small>
                  </div>
                  <Button
                    disabled={registrationsLoading || eventsLoading}
                    onClick={onRefresh}
                    size="sm"
                  >
                    {registrationsLoading ? "Обновляем..." : "Обновить"}
                  </Button>
                </div>
  );
}
