/** Platform-independent values from docs/design.md §§2–5, 8. */
export const colors = {
  sky: { primary: '#2A64A8', text: '#1D4F8A', surface: '#E5EEF9' },
  peach: { text: '#A8501E', marker: '#E2804F', surface: '#FDEEE4', border: '#F2D2BE' },
  amber: { text: '#8A5A00', surface: '#FFF4D6' },
  green: { text: '#2F6B12', surface: '#E3F6D5' },
  red: { text: '#D92D20', surface: '#FEECEB' },
  gray: {
    text: '#191F28', secondary: '#4E5968', description: '#6B7684', disabled: '#8B95A1',
    line: '#D1D6DB', divider: '#F0F1F3', button: '#F2F4F6', disabledButton: '#E5E8EB',
  },
  background: '#F2F4F6', card: '#FFFFFF',
  subwayExamples: ['#E5171F', '#019A66', '#E44D93', '#8A4B22'],
} as const;

export const legColors = ['#5B9BE0', '#4F86D9', '#6C7FD6', '#8A73CC', '#A367BC', '#B866A6'] as const;

export const typography = {
  family: 'Pretendard', letterSpacingEm: -0.01, numbers: 'tabular-nums',
  title: { size: 20, weight: 600 }, date: { size: 22, weight: 600 },
  place: { size: 17, weight: 600 }, body: { size: 16, weight: 400 },
  description: { size: 15, weight: 400 }, secondary: { size: 14, weight: 400 },
  small: { min: 12, max: 13, weight: 400 },
} as const;

export const spacing = {
  steps: [4, 8, 12, 16, 20, 24, 32],
  screen: 20, cardOutside: 12, cardInside: 16, cardGap: 12, section: 24,
  buttonTop: 12, buttonBottom: 28,
} as const;

export const radius = {
  small: 10, input: { min: 14, max: 16 }, card: { min: 18, max: 20 }, panel: 24,
  tile: 12, button: 16, chip: 17, search: 16, toast: 18,
} as const;

export const size = {
  touch: 44, topBar: 56, back: 44, iconTile: 40, rowButton: 36, button: 56,
  chip: 34, focusBorder: 1.5, search: 52, switch: { width: 50, height: 30 },
  checkbox: 26, checkboxBorder: 2, checkboxTouch: 40, handle: { width: 36, height: 5 },
} as const;

export const motion = {
  screen: { duration: 280, translateX: 24, easing: 'ease-out' },
  panel: { duration: 320, bezier: [0.22, 1, 0.36, 1] },
  sheet: { duration: 260, backdropOpacity: 0.4 },
  press: { duration: 90, scale: 0.97 },
  skeleton: { duration: 1200 }, subwayOpacity: 0.75,
} as const;
