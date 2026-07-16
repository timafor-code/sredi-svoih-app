import type { RegisterForEventOccurrenceOptionSelectionInput } from '@/types/event';

export type PaidEventOptionSelectionInput = RegisterForEventOccurrenceOptionSelectionInput;

export type RegisterForPaidEventSimulatedInput = {
  eventId: string;
  occurrenceId?: string | null;
  optionSelections: PaidEventOptionSelectionInput[];
  seatsCount?: number | null;
  guestNames?: string[] | null;
  comment?: string | null;
};

export {
  cancelRegistration,
  loadMyRegistrations,
  normalizeApiRegistration as normalizeEventRegistrationRow,
  registerForEvent,
  registerForEventOccurrenceWithOptions,
  registerForPaidEventSimulated,
} from './registrationApiService';
