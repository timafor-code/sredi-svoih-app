import { describe, expect, it } from "vitest";
import {
  calculateRegistrationDisplayTotals,
  clampOptionQuantity,
  getSelectedOptionQuantity,
  validateSelectedCurrencies,
  type ParticipationOptionSelection,
} from "./participation";
import type { WebRegistrationParticipationOption } from "./types";

function option(
  id: string,
  overrides: Partial<WebRegistrationParticipationOption> = {},
): WebRegistrationParticipationOption {
  return {
    id,
    event_id: "11111111-1111-4111-8111-111111111111",
    title: id,
    description: null,
    price_amount: 0,
    price_currency: "RUB",
    option_type: "participation",
    seat_limit: null,
    allow_quantity: true,
    min_quantity: 1,
    max_quantity: 10,
    is_donation: false,
    counts_toward_capacity: true,
    group_key: null,
    sort_order: 0,
    ...overrides,
  };
}

function selected(quantity: unknown): ParticipationOptionSelection {
  return { selected: true, quantity };
}

describe("participation display calculations", () => {
  it("calculates a free capacity-counting option", () => {
    const free = option("free");
    expect(calculateRegistrationDisplayTotals([free], { free: selected(1) })).toEqual({
      amount: 0,
      seats: 1,
      currency: "RUB",
      hasSelection: true,
      hasMixedCurrencies: false,
    });
  });

  it("multiplies paid participation amount and seats by quantity", () => {
    const paid = option("paid", { price_amount: 1500 });
    expect(calculateRegistrationDisplayTotals([paid], { paid: selected(2) }))
      .toMatchObject({ amount: 3000, seats: 2 });
  });

  it("includes donations in amount but not seats", () => {
    const donation = option("donation", {
      price_amount: 1000,
      is_donation: true,
      counts_toward_capacity: true,
    });
    expect(calculateRegistrationDisplayTotals([donation], { donation: selected(2) }))
      .toMatchObject({ amount: 2000, seats: 0 });
  });

  it("includes a priced non-capacity option in amount but not seats", () => {
    const online = option("online", {
      price_amount: 500,
      counts_toward_capacity: false,
    });
    expect(calculateRegistrationDisplayTotals([online], { online: selected(3) }))
      .toMatchObject({ amount: 1500, seats: 0 });
  });

  it("calculates mixed main and donation selections independently", () => {
    const main = option("main", { price_amount: 1500 });
    const donation = option("donation", {
      price_amount: 1000,
      is_donation: true,
      counts_toward_capacity: false,
    });
    expect(calculateRegistrationDisplayTotals(
      [main, donation],
      { main: selected(2), donation: selected(2) },
    )).toMatchObject({ amount: 5000, seats: 2 });
  });

  it("forces quantity one when quantity is disabled", () => {
    const fixed = option("fixed", {
      allow_quantity: false,
      min_quantity: 1,
      max_quantity: 1,
    });
    expect(clampOptionQuantity(fixed, 7)).toBe(1);
    expect(getSelectedOptionQuantity(fixed, selected(7))).toBe(1);
  });

  it("clamps integer quantities to canonical minimum and maximum", () => {
    const ranged = option("ranged", { min_quantity: 2, max_quantity: 4 });
    expect(clampOptionQuantity(ranged, 1)).toBe(2);
    expect(clampOptionQuantity(ranged, 3)).toBe(3);
    expect(clampOptionQuantity(ranged, 5)).toBe(4);
  });

  it.each([0, -3, 100, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "normalizes malformed local quantity %s without leaking it into totals",
    (quantity) => {
      const ranged = option("ranged", { price_amount: 10, min_quantity: 2, max_quantity: 4 });
      const expectedQuantity = Number.isSafeInteger(quantity) && quantity > 4 ? 4 : 2;
      expect(calculateRegistrationDisplayTotals([ranged], { ranged: selected(quantity) }))
        .toMatchObject({ amount: 10 * expectedQuantity, seats: expectedQuantity });
    },
  );

  it("fails closed for mixed selected currencies without exposing a combined amount", () => {
    const rub = option("rub", { price_amount: 1500, price_currency: "RUB" });
    const usd = option("usd", { price_amount: 20, price_currency: "USD" });
    const selections = { rub: selected(1), usd: selected(1) };
    expect(validateSelectedCurrencies([rub, usd], selections)).toEqual({
      isValid: false,
      currency: null,
    });
    expect(calculateRegistrationDisplayTotals([rub, usd], selections)).toMatchObject({
      amount: null,
      currency: null,
      hasMixedCurrencies: true,
    });
  });

  it("ignores unselected options for amount, seats, and currency", () => {
    const rub = option("rub", { price_amount: 1500, price_currency: "RUB" });
    const usd = option("usd", { price_amount: 20, price_currency: "USD" });
    expect(calculateRegistrationDisplayTotals(
      [rub, usd],
      { rub: selected(2), usd: { selected: false, quantity: 9 } },
    )).toEqual({
      amount: 3000,
      seats: 2,
      currency: "RUB",
      hasSelection: true,
      hasMixedCurrencies: false,
    });
    expect(validateSelectedCurrencies([rub, usd], {})).toEqual({
      isValid: true,
      currency: null,
    });
  });
});
