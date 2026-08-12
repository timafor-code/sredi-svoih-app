import { describe, expect, it } from "vitest";
import {
  countryCodeToFlag,
  formatPhoneInput,
  normalizeInternationalPhone,
} from "./phone";

describe("international phone input", () => {
  it.each([
    ["79950955545", "+79950955545"],
    ["89950955545", "+79950955545"],
    ["+79950955545", "+79950955545"],
    ["0044 7400 123456", "+447400123456"],
    ["+44 7400 123456", "+447400123456"],
    ["+972 50 123 4567", "+972501234567"],
    ["+1 (415) 555-2671", "+14155552671"],
    ["+49 1512 3456789", "+4915123456789"],
    ["+33 6 12 34 56 78", "+33612345678"],
    ["+44 (7911) 123-456", "+447911123456"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeInternationalPhone(input)).toBe(expected);
  });

  it("formats Russian legacy input and derives the flag from ISO country code", () => {
    expect(formatPhoneInput("79950955545")).toEqual({
      display: "+7 995 095-55-45",
      canonical: "+79950955545",
      country: "RU",
      flag: "🇷🇺",
    });
    expect(countryCodeToFlag("GB")).toBe("🇬🇧");
    expect(countryCodeToFlag("IL")).toBe("🇮🇱");
  });

  it.each([
    ["+44 7400 123456", "GB", "🇬🇧"],
    ["+972 50 123 4567", "IL", "🇮🇱"],
    ["+1 (415) 555-2671", "US", "🇺🇸"],
    ["+49 1512 3456789", "DE", "🇩🇪"],
    ["+33 6 12 34 56 78", "FR", "🇫🇷"],
  ])("detects the country and flag for %s", (input, country, flag) => {
    expect(formatPhoneInput(input)).toMatchObject({ country, flag });
  });

  it.each([
    "+",
    "+0123456789",
    "+1234567890123456",
    "+44CALLME",
    "+9991234567",
    "+44",
    "+447",
  ])("rejects invalid phone %s", (input) => {
    expect(normalizeInternationalPhone(input)).toBeNull();
  });
});
