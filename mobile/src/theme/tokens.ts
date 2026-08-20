/**
 * Design tokens — HANDOFF.md §6 plus the --error addition from the mobile
 * screens handoff. Use these exactly; don't hand-roll colors/spacing
 * elsewhere. Radii/type per the handoff: 11px inputs/buttons, 15-20px
 * cards, 999px pills; Iowan Old Style (falls back to Lora) for
 * headings/serif moments, Inter for everything else including the
 * wordmark lockup.
 */

export const colors = {
  greenPrimary: '#027A61',
  greenDeep: '#007B5C',
  greenBright: '#04C29C',
  greenMintBg: '#C8FFF6',
  greenMintPale: '#D2FFFD',
  bgApp: '#F4FAF8',
  surface: '#FFFFFF',
  border: '#E0E6E4',
  textPrimary: '#0C1F1B',
  textBody: '#3A4A47',
  textMuted: '#7E8F8D',
  error: '#B3261E',
} as const;

export const radii = {
  input: 11,
  button: 11,
  cardSm: 15,
  cardLg: 20,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const fonts = {
  serif: 'Lora_600SemiBold',
  serifBold: 'Lora_700Bold',
  sans: 'Inter_400Regular',
  sansMedium: 'Inter_500Medium',
  sansSemiBold: 'Inter_600SemiBold',
  sansBold: 'Inter_700Bold',
} as const;

export const fontSizes = {
  xs: 11,
  sm: 12.5,
  base: 14,
  md: 15,
  lg: 17,
  xl: 19,
  xxl: 24,
  display: 32,
} as const;
