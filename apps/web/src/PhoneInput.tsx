import { useEffect, type ReactNode } from "react";
import { polyfillCountryFlagEmojis } from "country-flag-emoji-polyfill";
import flagFontUrl from "country-flag-emoji-polyfill/dist/TwemojiCountryFlags.woff2?url";
import { formatPhoneInput } from "./phone";

let flagEmojiPolyfillReady = false;

function ensureWindowsFlagEmojiSupport(): void {
  if (flagEmojiPolyfillReady || !/Windows/i.test(navigator.userAgent)) return;
  flagEmojiPolyfillReady = true;
  polyfillCountryFlagEmojis("Twemoji Country Flags", flagFontUrl);
}

export function PhoneInput({
  value,
  error,
  onChange,
  onBlur,
}: {
  value: string;
  error?: string;
  onChange: (value: string) => void;
  onBlur: () => void;
}): ReactNode {
  useEffect(ensureWindowsFlagEmojiSupport, []);
  const phone = formatPhoneInput(value);
  const describedBy = ["phone-helper", error ? "phone-error" : null].filter(Boolean).join(" ");

  return (
    <div className="form-field phone-field">
      <label htmlFor="phone">Телефон</label>
      <div className="phone-control">
        <span className="phone-flag" aria-hidden="true">{phone.flag}</span>
        <input
          id="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          maxLength={32}
          placeholder="+(код страны) …"
          value={value}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          onChange={(event) => onChange(formatPhoneInput(event.target.value).display)}
          onBlur={onBlur}
        />
      </div>
      <p className="field-helper" id="phone-helper">Можно указать номер любой страны</p>
      {error ? <p className="field-error" id="phone-error" role="alert">{error}</p> : null}
    </div>
  );
}
