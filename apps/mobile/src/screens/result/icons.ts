/** Text glyphs for the result screen. Each glyph sits next to a word, so screen readers skip it. */
export const MODE_ICONS = { TRANSIT: '🚇', TAXI: '🚕', WALK: '🚶' } as const;
export const ENDPOINT_ICONS = { LODGING_OUT: '⌂', LODGING_IN: '⌂', AIRPORT_ARRIVAL: '✈', AIRPORT_DEPARTURE: '✈' } as const;
export const ENDPOINT_LABELS = {
  LODGING_OUT: '숙소 출발', LODGING_IN: '숙소 도착', AIRPORT_ARRIVAL: '공항 도착', AIRPORT_DEPARTURE: '공항 출발',
} as const;
