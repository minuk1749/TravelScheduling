import type { ScheduleResult, Visit } from '../../scheduler';
import type { Location } from '../../travel-time';
import { localInstant } from './day-plan';
import { ItineraryInputError, type ItineraryPlaces, type PlaceRef, type TripInputs } from './types';

export interface ResolvedPlaces {
  locations: ReadonlyMap<string, Location>;
  /** A visit place maps to `undefined` when its hours are unknown (not the same as `[]`, closed). */
  openingHours: ReadonlyMap<string, Visit['openingHours']>;
}

type TripVisit = TripInputs['visits'][number];

/** An unpinned wish is never placed automatically, so its place details are not needed to schedule. */
const isOptionalWish = (visit: TripVisit) =>
  visit.priority === 'WISH' && visit.fixedDate === undefined && visit.fixedOrder === undefined;

/**
 * One lookup per place per computation: details (hours for the trip dates) for visit places,
 * cached coordinates only for airports and lodgings. A missing place needs user correction,
 * except a place used only by unpinned wishes: those visits are then left out of the schedule.
 */
export async function resolvePlaces(provider: ItineraryPlaces, input: TripInputs, dates: readonly string[]): Promise<ResolvedPlaces> {
  const visitPlaces = new Map(input.visits.map(visit => [visit.place.id, visit.place]));
  const otherPlaces = new Map<string, PlaceRef>();
  const anchors = [...input.flights.map(flight => flight.airport), ...input.lodgings.map(lodging => lodging.place)];
  for (const place of anchors) {
    if (!visitPlaces.has(place.id)) otherPlaces.set(place.id, place);
  }
  const needed = new Set([...anchors.map(place => place.id), ...input.visits.filter(visit => !isOptionalWish(visit)).map(visit => visit.place.id)]);
  const locations = new Map<string, Location>();
  const openingHours = new Map<string, Visit['openingHours']>();
  const missing: Record<string, string> = {};
  await Promise.all([
    ...[...visitPlaces.values()].map(async place => {
      const details = await provider.details({ googlePlaceId: place.googlePlaceId, language: 'ko', dates, timeZone: input.timeZone });
      if (!details && !needed.has(place.id)) return;
      if (!details) return void (missing[`places.${place.googlePlaceId}`] = '장소를 찾을 수 없습니다. 다른 장소를 선택해 주세요.');
      locations.set(place.id, { id: place.id, coordinates: details.coordinates });
      openingHours.set(place.id, details.openingHours);
    }),
    ...[...otherPlaces.values()].map(async place => {
      const location = await provider.location(place.googlePlaceId);
      if (!location) return void (missing[`places.${place.googlePlaceId}`] = '장소를 찾을 수 없습니다. 다른 장소를 선택해 주세요.');
      locations.set(place.id, { id: place.id, coordinates: location.coordinates });
    }),
  ]);
  if (Object.keys(missing).length) throw new ItineraryInputError(missing);
  return { locations, openingHours };
}

/** Trip visits in stored order (the order capacity recommendations reproduce), without unresolved optional wishes. */
export function schedulerVisits(input: TripInputs, places: ResolvedPlaces): Visit[] {
  return input.visits.filter(visit => places.locations.has(visit.place.id)).map(visit => {
    const openingHours = places.openingHours.get(visit.place.id);
    return {
      id: visit.id,
      locationId: visit.place.id,
      coordinates: places.locations.get(visit.place.id)!.coordinates,
      minutes: visit.minutes,
      priority: visit.priority,
      ...(visit.fixedDate === undefined ? {} : { fixedDate: visit.fixedDate }),
      ...(visit.fixedDate !== undefined && visit.fixedTime !== undefined
        ? { fixedStart: localInstant(`${visit.fixedDate}T${visit.fixedTime}`, input.timeZone) } : {}),
      ...(visit.fixedOrder === undefined ? {} : { fixedOrder: visit.fixedOrder }),
      ...(openingHours === undefined ? {} : { openingHours }),
    };
  });
}

/** Scheduled visits whose opening hours are unknown. A closed place has `[]`, which is not unknown. */
export function unknownHoursInSchedule(visits: readonly Visit[], schedule: Pick<ScheduleResult, 'days'> | null): string[] {
  if (!schedule) return [];
  const unknown = new Set(visits.filter(visit => visit.openingHours === undefined).map(visit => visit.id));
  return schedule.days.flatMap(day => day.stops.flatMap(stop => stop.kind === 'VISIT' && unknown.has(stop.visitId) ? [stop.visitId] : []));
}
