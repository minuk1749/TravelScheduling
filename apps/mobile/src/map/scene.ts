import { colors } from '@travel/design-tokens';
import type { ResultView } from '@travel/core/contracts/results/model';
import type { ConflictCause } from '../result/conflicts';
import type { CardModel, DayModel } from '../result/days';
import { roadShapeKey } from './geometry';
import { legEmphasis, type MapFocus } from './selection';
import type { LatLng, MapMarkerSpec, MapRouteSpec } from './types';

export type SceneInput = {
  view: ResultView;
  /** Selected date; undefined while nothing has been calculated (3-5 first generation). */
  day: DayModel | undefined;
  card: CardModel | null;
  focus: MapFocus;
  pending: ReadonlySet<string>;
  placed: ReadonlySet<string>;
  shapes: ReadonlyMap<string, readonly LatLng[]>;
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

function endpointMarkers({ view, day }: SceneInput): MapMarkerSpec[] {
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
  for (const leg of day?.legs ?? []) {
    if (leg.kind !== 'AIRPORT') continue;
    for (const id of [leg.from, leg.to]) if (airports.has(id)) add(airportMarkerId(id), id, 'AIRPORT');
  }
  return [...markers.values()];
}

function legRoutes(input: SceneInput): MapRouteSpec[] {
  const emphasis = legEmphasis(input.day, input.card, input.focus, input.pending);
  return (input.day?.legs ?? []).flatMap((leg): MapRouteSpec[] => {
    const value = emphasis.get(leg.key) ?? 'DIM';
    if (value === 'HIDDEN' || !leg.fromPoint || !leg.toPoint) return [];
    const points = input.shapes.get(roadShapeKey(leg.key, leg.mode));
    const road = points && points.length >= 2;
    const line = !road ? 'DOTTED' : leg.outside ? 'FLOATING' : leg.mode === 'WALK' ? 'DOTTED' : 'SOLID';
    return [{
      id: leg.key, order: leg.order, mode: leg.mode, color: leg.color, emphasis: value,
      line,
      path: road ? { kind: 'ROAD', points } : { kind: 'STRAIGHT', from: leg.fromPoint, to: leg.toPoint },
    }];
  });
}

function conflictRoutes({ view, day, causes }: SceneInput): MapRouteSpec[] {
  return causes.flatMap((cause, index): MapRouteSpec[] => {
    const from = cause.leg && view.places[cause.leg.from]?.coordinates, to = cause.leg && view.places[cause.leg.to]?.coordinates;
    if (!cause.leg || cause.leg.date !== day?.date || !from || !to) return [];
    return [{ id: `conflict:${index}`, order: index + 1, mode: 'TRANSIT', color: colors.red.text, line: 'FLOATING',
      emphasis: 'CONFLICT', path: { kind: 'STRAIGHT', from, to } }];
  });
}

/**
 * Pure map scene for the selected date: placed, wish, lodging and airport markers, and legs styled
 * by the §6 state table. The camera fits the day's places and lodging; airports may lie off screen.
 */
export function mapScene(input: SceneInput) {
  const markers = [...endpointMarkers(input), ...placesMarkers(input)];
  const routes = [...legRoutes(input), ...(input.focus === 'CONFLICT' ? conflictRoutes(input) : [])];
  const focusIds = markers.filter(marker => marker.kind === 'PLACED' || marker.kind === 'LODGING').map(marker => marker.id);
  return { markers, routes, focusIds: focusIds.length ? focusIds : markers.map(marker => marker.id) };
}
