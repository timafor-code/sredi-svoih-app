import type { WebRegistrationParticipationOption } from "./types";

export type ParticipationOptionSelection = Readonly<{
  selected: boolean;
  quantity: unknown;
}>;

type QuantityOption = Pick<
  WebRegistrationParticipationOption,
  "allow_quantity" | "min_quantity" | "max_quantity"
>;

export type SelectedCurrencyValidation = Readonly<{
  isValid: boolean;
  currency: string | null;
}>;

export type RegistrationDisplayTotals = Readonly<{
  amount: number | null;
  seats: number;
  currency: string | null;
  hasSelection: boolean;
  hasMixedCurrencies: boolean;
}>;

export function clampOptionQuantity(
  option: QuantityOption,
  quantity: unknown,
): number {
  if (!option.allow_quantity) return 1;
  if (typeof quantity !== "number" || !Number.isSafeInteger(quantity)) {
    return option.min_quantity;
  }
  return Math.min(
    option.max_quantity,
    Math.max(option.min_quantity, quantity),
  );
}

export function getSelectedOptionQuantity(
  option: QuantityOption,
  selection: ParticipationOptionSelection | undefined,
): number | null {
  if (!selection?.selected) return null;
  return clampOptionQuantity(option, selection.quantity);
}

export function validateSelectedCurrencies(
  options: readonly WebRegistrationParticipationOption[],
  selections: Readonly<Record<string, ParticipationOptionSelection | undefined>>,
): SelectedCurrencyValidation {
  const currencies = new Set<string>();
  for (const option of options) {
    if (getSelectedOptionQuantity(option, selections[option.id]) !== null) {
      currencies.add(option.price_currency);
    }
  }
  return currencies.size <= 1
    ? { isValid: true, currency: currencies.values().next().value ?? null }
    : { isValid: false, currency: null };
}

export function calculateRegistrationDisplayTotals(
  options: readonly WebRegistrationParticipationOption[],
  selections: Readonly<Record<string, ParticipationOptionSelection | undefined>>,
): RegistrationDisplayTotals {
  const currencyValidation = validateSelectedCurrencies(options, selections);
  let amount = 0;
  let seats = 0;
  let hasSelection = false;

  for (const option of options) {
    const quantity = getSelectedOptionQuantity(option, selections[option.id]);
    if (quantity === null) continue;
    hasSelection = true;
    amount += option.price_amount * quantity;
    if (!option.is_donation && option.counts_toward_capacity) {
      seats += quantity;
    }
  }

  return {
    amount: currencyValidation.isValid ? amount : null,
    seats,
    currency: currencyValidation.currency,
    hasSelection,
    hasMixedCurrencies: !currencyValidation.isValid,
  };
}
