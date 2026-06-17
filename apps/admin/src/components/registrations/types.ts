import type {
  AdminEventRegistrationRow,
  AdminRegistrationAttendanceStatus,
  AdminRegistrationStatus,
  AdminRegistrationStatusUpdate,
} from "../../types/registrations";

export type RegistrationAction =
  | {
      kind: "status";
      status: AdminRegistrationStatusUpdate;
      label: string;
      loadingLabel: string;
      destructive?: boolean;
      variant?: "primary" | "secondary" | "ghost" | "gold";
    }
  | {
      kind: "attendance";
      status: AdminRegistrationAttendanceStatus;
      label: string;
      loadingLabel: string;
      destructive?: boolean;
      variant?: "primary" | "secondary" | "ghost" | "gold";
    };

export type PendingRegistrationAction = {
  action: RegistrationAction;
  registration: AdminEventRegistrationRow;
};

export type ActionInFlight = {
  registrationId: string;
  status: AdminRegistrationStatus;
};
