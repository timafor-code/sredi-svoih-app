// Type scale matched to the prototype. The HTML prototype uses Inter +
// SF Pro Display via Google Fonts, but we don't bundle custom fonts on
// native — system fonts (San Francisco on iOS, Roboto on Android) read
// nearly identical at these sizes/weights and we keep the install lean.

export const fontSize = {
  micro: 10,
  caption: 11,
  small: 12,
  smallPlus: 13,
  body: 14,
  bodyLarge: 15,
  h6: 16,
  h5: 18,
  h4: 20,
  h3: 22,
  h2: 26,
  h1: 28,
  display: 36,
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  heavy: '800',
} as const;

export const lineHeight = {
  tight: 1.2,
  snug: 1.35,
  normal: 1.5,
  relaxed: 1.6,
  loose: 1.7,
} as const;

export const letterSpacing = {
  tight: -0.5,
  snug: -0.3,
  normal: 0,
  wide: 0.1,
  wider: 0.4,
  widest: 0.8,
} as const;

// Backwards-compatible shorthand. Existing call sites import { typography }
// and read .title / .h2 / .body / .caption — keep these aliases working.
export const typography = {
  title: fontSize.h1,
  h1: fontSize.h1,
  h2: fontSize.h3,
  h3: fontSize.h4,
  body: fontSize.bodyLarge,
  caption: fontSize.small,
} as const;
