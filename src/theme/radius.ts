// Border radius scale. Prototype uses these values across all surfaces:
// 6 (tag pill), 9 (segment item), 10 (small card), 12 (button/segment),
// 16 (card), 18 (glass card), 20 (location pill), 24 (tab indicator),
// 28 (modal sheet header), 999 (full pill / circle).

export const radius = {
  xs: 6,
  sm: 8,
  md: 12,
  card: 16,
  glassCard: 18,
  pill: 20,
  lg: 24,
  xl: 28,
  full: 999,
} as const;
