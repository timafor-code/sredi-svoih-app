import { AsYouType, parsePhoneNumberFromString, type PhoneNumber } from "libphonenumber-js";

export type PhoneInputValue = {
  display: string;
  canonical: string | null;
  country: string | null;
  flag: string;
};

const VISUAL_PHONE_CHARACTERS = /^[+\d\s().-]*$/;
const E164 = /^\+[1-9]\d{6,14}$/;

export function countryCodeToFlag(country: string | null): string {
  if (!country || !/^[A-Z]{2}$/.test(country)) return "🌐";
  return String.fromCodePoint(
    ...country.split("").map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65),
  );
}

function toInternationalCandidate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || !VISUAL_PHONE_CHARACTERS.test(trimmed)) return null;

  const compact = trimmed.replace(/[\s().-]/g, "");
  if (!compact || (compact.match(/\+/g)?.length ?? 0) > 1) return null;
  if (compact.startsWith("00")) return `+${compact.slice(2)}`;
  if (compact.startsWith("+")) return compact;
  if (!/^\d+$/.test(compact)) return null;

  // Russian numbers are commonly entered with the domestic trunk prefix 8.
  if (compact.startsWith("8")) return `+7${compact.slice(1)}`;
  if (compact.startsWith("7")) return `+${compact}`;

  const candidate = `+${compact}`;
  const formatter = new AsYouType();
  formatter.input(candidate);
  return formatter.getNumber()?.countryCallingCode ? candidate : null;
}

function formatParsedPhone(phone: PhoneNumber): string {
  if (phone.country === "RU") {
    const national = phone.formatNational()
      .replace(/^8\s*/, "")
      .replace(/[()]/g, "")
      .trim();
    return `+${phone.countryCallingCode} ${national}`;
  }
  return phone.formatInternational();
}

export function formatPhoneInput(value: string): PhoneInputValue {
  const candidate = toInternationalCandidate(value);
  if (!candidate) {
    return { display: value, canonical: null, country: null, flag: "🌐" };
  }

  const formatter = new AsYouType();
  const partialDisplay = formatter.input(candidate);
  const parsed = parsePhoneNumberFromString(candidate);
  const canonical = parsed?.isValid() && E164.test(parsed.number) ? parsed.number : null;
  const country = parsed?.country ?? formatter.getCountry() ?? null;
  return {
    display: canonical && parsed ? formatParsedPhone(parsed) : partialDisplay,
    canonical,
    country,
    flag: countryCodeToFlag(country),
  };
}

export function normalizeInternationalPhone(value: string): string | null {
  return formatPhoneInput(value).canonical;
}
