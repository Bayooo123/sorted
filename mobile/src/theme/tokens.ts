/**
 * Design tokens — HANDOFF.md §6 plus the --error addition from the mobile
 * screens handoff. Use these exactly; don't hand-roll colors/spacing
 * elsewhere. Radii/type per the handoff: 11px inputs/buttons, 15-20px
 * cards, 999px pills; Iowan Old Style (falls back to Lora) for
 * headings/serif moments, Inter for everything else including the
 * wordmark lockup.
 *
 * lightColors/darkColors: two color palettes behind the same key set (see
 * ThemeContext.tsx) — dark added per the "app flow" mockups (near-black
 * app background, dark cards, mint-green accents). Every screen reads
 * colors via useTheme() now, never this file directly, so the active
 * palette can be swapped by mode alone. spacing/radii/fonts/fontSizes stay
 * theme-independent — only color changes between light and dark.
 */

export interface ThemeColors {
  greenPrimary: string;
  greenDeep: string;
  greenBright: string;
  greenMintBg: string;
  greenMintPale: string;
  bgApp: string;
  surface: string;
  border: string;
  textPrimary: string;
  textBody: string;
  textMuted: string;
  error: string;
  errorBg: string;
}

export const lightColors: ThemeColors = {
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
  errorBg: '#FBEAE8',
};

export const darkColors: ThemeColors = {
  greenPrimary: '#04C29C',
  greenDeep: '#04C29C',
  greenBright: '#04C29C',
  greenMintBg: '#123830',
  greenMintPale: '#0F2E27',
  bgApp: '#0A1614',
  surface: '#13221E',
  border: '#213A33',
  textPrimary: '#F4FAF8',
  textBody: '#AFC4BE',
  textMuted: '#6E8A83',
  error: '#FF6B5E',
  errorBg: '#3A1512',
};

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
