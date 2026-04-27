// Spacing scale. Token names follow the prototype's most common values.
// Numeric aliases (xs/sm/md/...) preserved for existing call sites.

export const spacing = {
  // Numeric scale — preferred for new code.
  s2: 2,
  s3: 3,
  s4: 4,
  s6: 6,
  s8: 8,
  s10: 10,
  s12: 12,
  s14: 14,
  s16: 16,
  s18: 18,
  s20: 20,
  s24: 24,
  s28: 28,
  s32: 32,

  // Legacy aliases — keep so existing imports don't break.
  xs: 6,
  sm: 10,
  md: 16,
  lg: 20,
  xl: 28,
} as const;
