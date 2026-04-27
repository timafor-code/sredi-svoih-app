// Palette extracted from docs/prototype/sredi-svoih.html.
// Two notes for future eyes:
// 1. The prototype's body bg is #060810 and the "phone shell" is #0d0f18.
//    On real devices we just use the body bg as the screen background.
// 2. Most surfaces are not solid — they are translucent white over the
//    dark bg. Keep the rgba(white) variants below grouped as `glass.*`
//    so call sites describe intent, not magic numbers.

export const colors = {
  // Base
  bg: '#060810',
  shell: '#0d0f18',
  surface: '#141620',
  surface2: '#1a1c28',
  surface3: '#252540',

  // Text
  text: '#FFFFFF',
  textSecondary: 'rgba(255,255,255,0.8)',
  textMuted: 'rgba(255,255,255,0.6)',
  textFaint: 'rgba(255,255,255,0.5)',
  textDim: 'rgba(255,255,255,0.4)',
  textGhost: 'rgba(255,255,255,0.35)',

  // Brand
  red: '#E52C36',
  redSoft: '#e07070',
  gold: '#F6A400',
  goldAccent: '#FFC832', // rgba(255,200,50) used throughout prototype
  orange: '#F07A2A',
  orangeDark: '#E05A10',
  blue: '#6B7FD4',
  blueSoft: '#7090e0',

  // Status / semantic
  success: '#4CAF50',
  warning: '#FF9F0A',
  danger: '#FF5555',

  // Glass / translucent overlays — name encodes opacity step.
  glass: {
    w04: 'rgba(255,255,255,0.04)',
    w05: 'rgba(255,255,255,0.05)',
    w06: 'rgba(255,255,255,0.06)',
    w07: 'rgba(255,255,255,0.07)',
    w08: 'rgba(255,255,255,0.08)',
    w09: 'rgba(255,255,255,0.09)',
    w10: 'rgba(255,255,255,0.10)',
    w11: 'rgba(255,255,255,0.11)',
    w12: 'rgba(255,255,255,0.12)',
    w16: 'rgba(255,255,255,0.16)',
    w20: 'rgba(255,255,255,0.20)',
    w35: 'rgba(255,255,255,0.35)',
    w50: 'rgba(255,255,255,0.50)',
  },

  // Borders (most are just glass w08–w12, but giving them a name)
  border: 'rgba(255,255,255,0.09)',
  borderStrong: 'rgba(255,255,255,0.12)',
  separator: 'rgba(255,255,255,0.06)',

  // Accent overlays used in cards / pills
  accent: {
    goldBg: 'rgba(255,200,50,0.10)',
    goldBgStrong: 'rgba(255,200,50,0.15)',
    goldBorder: 'rgba(255,200,50,0.25)',
    goldBorderStrong: 'rgba(255,200,50,0.30)',
    goldText: 'rgba(255,200,50,0.90)',
    goldTextDim: 'rgba(255,200,50,0.70)',

    orangeBg: 'rgba(240,122,42,0.12)',
    orangeBorder: 'rgba(240,122,42,0.30)',
    orangeShadow: 'rgba(240,122,42,0.35)',

    redBg: 'rgba(220,50,50,0.12)',
    redBorder: 'rgba(220,50,50,0.25)',

    blueBg: 'rgba(50,100,220,0.12)',
    blueBorder: 'rgba(50,100,220,0.25)',

    greenBg: 'rgba(76,175,80,0.15)',
    greenBorder: 'rgba(76,175,80,0.30)',
  },
} as const;
