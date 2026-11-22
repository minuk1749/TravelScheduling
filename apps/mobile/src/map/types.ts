/**
 * Result map adapter contract (architecture §13.5). Screens build these specs with the pure
 * functions in this directory; an adapter only draws them and reports marker presses.
 */
export type LatLng = { latitude: number; longitude: number };
export type TravelModeName = 'TRANSIT' | 'WALK' | 'TAXI';

/** AIRPORT marks the ends of airport transfers; it may lie off screen (edge indicator). */
export type MapMarkerKind = 'PLACED' | 'WISH' | 'LODGING' | 'AIRPORT';
export type MapMarkerSpec = {
  id: string; coordinate: LatLng; kind: MapMarkerKind;
  /** 1-based visit number of a PLACED marker; null when the visit has no position yet. */
  order: number | null;
  label: string;
};

/** SOLID: transit/taxi, DOTTED: walking or a straight fallback, FLOATING: outside the city centre (curve + ground shadow). */
export type MapRouteLine = 'SOLID' | 'DOTTED' | 'FLOATING';
/** STRONG: sequence colour, DIM: faded (§6 25%), CONFLICT: red curve for the leg that failed. */
export type MapRouteEmphasis = 'STRONG' | 'DIM' | 'CONFLICT';
export type MapRoutePath =
  | { kind: 'ROAD'; points: readonly LatLng[] }
  | { kind: 'STRAIGHT'; from: LatLng; to: LatLng };
export type MapRouteSpec = {
  id: string;
  /** 1-based leg order within the day. */
  order: number;
  mode: TravelModeName;
  /** Sequence colour (design-tokens `legColors`, interpolated beyond six legs). */
  color: string;
  line: MapRouteLine;
  emphasis: MapRouteEmphasis;
  path: MapRoutePath;
};

export type ResultMapProps = {
  markers: readonly MapMarkerSpec[];
  routes: readonly MapRouteSpec[];
  /** Selected PLACED or WISH marker. */
  selectedId: string | null;
  /** IDs the camera should fit (the day's places); markers outside the view get an edge label. */
  focusIds: readonly string[];
  /** Height (pt) covered by the floating top bar and the bottom panel; used for camera fitting. */
  topInset: number;
  bottomInset: number;
  /** 3-9: the shown result is a previous calculation; draw everything faded. */
  dimmed: boolean;
  /** Incremented by the current-location button. */
  locateRequest: number;
  onSelectMarker(id: string): void;
};
