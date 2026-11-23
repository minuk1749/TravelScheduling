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

/** §4 그림자: CSS `0 y blur rgba(r,g,b,opacity)` 값을 그대로 담는다. */
export const shadow = {
  floating: { y: 2, blur: 10, rgb: [0, 0, 0], opacity: 0.12 },
  panel: { y: -4, blur: 20, rgb: [0, 0, 0], opacity: 0.12 },
  toast: { y: 8, blur: 28, rgb: [0, 0, 0], opacity: 0.18 },
} as const;

/** §6–7 결과 화면(R2 · 지도 우선 · 장소 카드)의 배치·카드·지도 값. */
export const result = {
  topBar: { top: 10, inset: 12, height: 52, radius: 26 },
  dateChips: { top: 72, inset: 12, height: 44, radius: 22, gap: 6 },
  locate: { offset: 56, inset: 12, size: 44 },
  /** Keep the native Google logo and legal text visible between the panel and floating controls. */
  mapAttributionHeight: spacing.steps[6],
  panel: { top: 480, ratio: 0.43 },
  cardRow: { width: 300, gap: 12, inset: 20 },
  card: { surface: '#F7F8FA', radius: 16, padding: 14, border: 1.5, divider: '#E5E8EB', dividerWidth: 1 },
  number: { size: 24 },
  name: { size: 16, weight: 600 },
  switchChip: { height: 28 },
  pager: { editRadius: 12, disabled: '#D1D6DB' },
  /** 선택하지 않은 카드 위 흰 막, 재계산 중 카드 불투명도. */
  overlay: { unselected: 0.45, busy: 0.5 },
  marker: { selectedScale: 1.3, ring: 4, wishOpacity: 0.85 },
  route: { dimOpacity: 0.25, outsideKm: 4 },
} as const;

export const motion = {
  screen: { duration: 280, translateX: 24, easing: 'ease-out' },
  /** §8 카드 넘김(R2 결과 화면 장소 카드·마커 강조). */
  panel: { duration: 320, bezier: [0.22, 1, 0.36, 1] },
  sheet: { duration: 260, backdropOpacity: 0.4 },
  press: { duration: 90, scale: 0.97 },
  skeleton: { duration: 1200 }, subwayOpacity: 0.75,
} as const;
