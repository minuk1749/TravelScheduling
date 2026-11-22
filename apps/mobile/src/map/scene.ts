import { colors } from '@travel/design-tokens';
import type { ResultView } from '@travel/core/contracts/results/model';
import type { ConflictCause } from '../result/conflicts';
import type { CardModel, DayModel } from '../result/days';
import { legEmphasis, type MapFocus } from './selection';
import type { MapMarkerSpec, MapRouteSpec } from './types';

export type SceneInput = {
  view: ResultView;
  /** Selected date; undefined while nothing has been calculated (3-5 first generation). */
  day: DayModel | undefined;
  card: CardModel | null;
  focus: MapFocus;
  pending: ReadonlySet<string>;
  placed: ReadonlySet<string>;
  causes: readonly ConflictCause[];
};

export const lodgingMarkerId = (placeId: string) => `lodging:${placeId}`;
export const airportMarkerId = (placeId: string) => `airport:${placeId}`;

function placesMarkers({ view, day, placed }: SceneInput): MapMarkerSpec[] {
  const markers: MapMarkerSpec[] = [];
  const at = (id: string) => view.places[id]?.coordinates;
  for (const card of day?.cards ?? []) {
    const coordinate = at(card.placeId);
    if (coordinate) markers.push({ id: card.visitId, coordinate, kind: 'PLACED', order: card.number, label: card.name });
  }
  for (const visit of view.input.visits) {
    const coordinate = at(visit.place.id), place = view.places[visit.place.id];
    if (visit.priority === 'WISH' && !placed.has(visit.id) && coordinate && place
      && !markers.some(marker => marker.id === visit.id)) {
      markers.push({ id: visit.id, coordinate, kind: 'WISH', order: null, label: place.name });
    }
  }
  return markers;
}

type ConflictMapLeg = { index: number; from: string; to: string };

function endpointMarkers({ view, day }: SceneInput, conflictLegs: readonly ConflictMapLeg[]): MapMarkerSpec[] {
  const markers = new Map<string, MapMarkerSpec>();
  const add = (id: string, placeId: string, kind: 'LODGING' | 'AIRPORT') => {
    const place = view.places[placeId];
    if (place && !markers.has(id)) markers.set(id, { id, coordinate: place.coordinates, kind, order: null, label: place.name });
  };
  for (const lodging of view.input.lodgings) {
    if (!day || (lodging.checkIn <= day.date && day.date <= lodging.checkOut)) add(lodgingMarkerId(lodging.place.id), lodging.place.id, 'LODGING');
  }
  for (const row of day?.rows ?? []) {
    if (row.kind === 'ENDPOINT' && (row.role === 'AIRPORT_ARRIVAL' || row.role === 'AIRPORT_DEPARTURE')) {
      add(airportMarkerId(row.placeId), row.placeId, 'AIRPORT');
    }
  }
  const airports = new Set(view.input.flights.map(flight => flight.airport.id));
  const transfers = day?.legs.filter(leg => leg.kind === 'AIRPORT') ?? [];
  for (const leg of [...transfers, ...conflictLegs]) {
    for (const id of [leg.from, leg.to]) if (airports.has(id)) add(airportMarkerId(id), id, 'AIRPORT');
  }
  return [...markers.values()];
}

function legRoutes(input: SceneInput): MapRouteSpec[] {
  const emphasis = legEmphasis(input.day, input.card, input.focus, input.pending);
  return (input.day?.legs ?? []).flatMap((leg): MapRouteSpec[] => {
    const value = emphasis.get(leg.key) ?? 'DIM';
    if (value === 'HIDDEN' || !leg.path) return [];
    const line = leg.path.kind === 'STRAIGHT' ? 'DOTTED' : leg.outside ? 'FLOATING' : leg.mode === 'WALK' ? 'DOTTED' : 'SOLID';
    return [{ id: leg.key, order: leg.order, mode: leg.mode, color: leg.color, emphasis: value, line, path: leg.path }];
  });
}

function conflictRoutes(view: ResultView, legs: readonly ConflictMapLeg[]): MapRouteSpec[] {
  return legs.flatMap(leg => {
    const from = view.places[leg.from]?.coordinates, to = view.places[leg.to]?.coordinates;
    if (!from || !to) return [];
    return [{ id: `conflict:${leg.index}`, order: leg.index + 1, mode: 'TRANSIT', color: colors.red.text, line: 'FLOATING',
      emphasis: 'CONFLICT', path: { kind: 'STRAIGHT', from, to } }];
  });
}

/**
 * Pure map scene for the selected date: placed, wish, lodging and airport markers, and legs styled
 * by the §6 state table. The camera fits the day's places and lodging; airports may lie off screen.
 */
export function mapScene(input: SceneInput) {
  const conflictLegs = input.focus === 'CONFLICT' ? input.causes.flatMap(({ leg }, index) =>
    leg && leg.date === input.day?.date ? [{ from: leg.from, to: leg.to, index }] : []) : [];
  const markers = [...endpointMarkers(input, conflictLegs), ...placesMarkers(input)];
  const routes = [...legRoutes(input), ...conflictRoutes(input.view, conflictLegs)];
  const focusIds = markers.filter(marker => marker.kind === 'PLACED' || marker.kind === 'LODGING').map(marker => marker.id);
  return { markers, routes, focusIds: focusIds.length ? focusIds : markers.map(marker => marker.id) };
}
