import { colors } from '@travel/design-tokens';
import { placeName } from '@travel/core/presentation';
import type { ResultView } from '@travel/core/contracts/results/model';
import type { ConflictCause } from '../result/conflicts';
import { placeDetailCoordinates, type CardModel, type DayModel } from '../result/days';
import { legEmphasis, type MapFocus } from './selection';
import type { LatLng, MapMarkerSpec, MapRouteSpec } from './types';

export type SceneInput = {
  view: ResultView;
  /** Input that produced the current conflict. Scheduled markers still belong to view. */
  conflictView?: ResultView;
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

function placesMarkers({ view, conflictView, day, placed }: SceneInput, coordinates: ReadonlyMap<string, LatLng>): MapMarkerSpec[] {
  const markers: MapMarkerSpec[] = [];
  for (const card of day?.cards ?? []) {
    const unplaced = card.start ? undefined : conflictView?.places[card.placeId]?.coordinates;
    const coordinate = unplaced ?? coordinates.get(card.placeId);
    const label = conflictView && card.start ? placeName(view, card.placeId) : card.name;
    if (coordinate) markers.push({ id: card.visitId, coordinate, kind: 'PLACED', order: card.number, label });
  }
  const editable = conflictView ?? view;
  for (const visit of editable.input.visits) {
    const coordinate = conflictView?.places[visit.place.id]?.coordinates ?? coordinates.get(visit.place.id);
    if (visit.priority === 'WISH' && !placed.has(visit.id) && coordinate
      && !markers.some(marker => marker.id === visit.id)) {
      markers.push({ id: visit.id, coordinate, kind: 'WISH', order: null, label: placeName(editable, visit.place.id) });
    }
  }
  return markers;
}

type ConflictMapLeg = { index: number; from: string; to: string };

function endpointMarkers({ view, conflictView, day }: SceneInput, conflictLegs: readonly ConflictMapLeg[], coordinates: ReadonlyMap<string, LatLng>): MapMarkerSpec[] {
  const markers = new Map<string, MapMarkerSpec>();
  const add = (id: string, placeId: string, kind: 'LODGING' | 'AIRPORT', current?: ResultView) => {
    const coordinate = current?.places[placeId]?.coordinates ?? coordinates.get(placeId);
    if (coordinate && !markers.has(id)) markers.set(id, { id, coordinate, kind, order: null, label: placeName(current ?? view, placeId) });
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
  const addAirports = (legs: readonly { from: string; to: string }[], current?: ResultView) => {
    for (const leg of legs) {
      for (const id of [leg.from, leg.to]) if (airports.has(id)) add(airportMarkerId(id), id, 'AIRPORT', current);
    }
  };
  addAirports(transfers);
  addAirports(conflictLegs, conflictView);
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

function conflictRoutes(coordinates: ReadonlyMap<string, LatLng>, legs: readonly ConflictMapLeg[], current?: ResultView): MapRouteSpec[] {
  return legs.flatMap(leg => {
    const from = current?.places[leg.from]?.coordinates ?? coordinates.get(leg.from);
    const to = current?.places[leg.to]?.coordinates ?? coordinates.get(leg.to);
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
  const coordinates = input.day?.coordinates ?? placeDetailCoordinates(input.view);
  const markers = [...endpointMarkers(input, conflictLegs, coordinates), ...placesMarkers(input, coordinates)];
  const routes = [...legRoutes(input), ...conflictRoutes(coordinates, conflictLegs, input.conflictView)];
  const focusIds = markers.filter(marker => marker.kind === 'PLACED' || marker.kind === 'LODGING').map(marker => marker.id);
  return { markers, routes, focusIds: focusIds.length ? focusIds : markers.map(marker => marker.id) };
}
