import { describe, expect, it } from "vitest";
import {
  normalizeName,
  normalizeRussianPhone,
  validateEmail,
  validateName,
  validateSeatsCount,
} from "./validation";

describe("public form validation", () => {
  it.each([
    ["+79991234567", "+79991234567"],
    ["8 (999) 123-45-67", "+79991234567"],
    ["7 999 123 45 67", "+79991234567"],
  ])("accepts Russian phone format %s", (value, expected) => {
    expect(normalizeRussianPhone(value)).toBe(expected);
  });

  it("rejects invalid email shapes", () => {
    expect(validateEmail("person.example.ru")).not.toBeNull();
    expect(validateEmail("person@@example.ru")).not.toBeNull();
    expect(validateEmail("person@example.ru")).toBeNull();
  });

  it("trims and collapses names while rejecting control characters", () => {
    expect(normalizeName("  Анна   Мария  ")).toBe("Анна Мария");
    expect(validateName("Анна\u0000")).not.toBeNull();
  });

  it.each(["0", "-1", "1001", "1.5", ""])("rejects invalid seats count %j", (value) => {
    expect(validateSeatsCount(value)).not.toBeNull();
  });

  it.each(["1", "1000"])("accepts seats count boundary %s", (value) => {
    expect(validateSeatsCount(value)).toBeNull();
  });
});
