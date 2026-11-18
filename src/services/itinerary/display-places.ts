import type { ResultDisplayView } from '../../results/model';
import type { ItineraryPlaces, PlaceRef } from './types';

/** Fresh metadata, deduplicated per request; Google display content is never persisted. */
export async function displayPlaces(
  provider: Pick<ItineraryPlaces, 'details'>, refs: readonly PlaceRef[], timeZone: string, date: string,
): Promise<ResultDisplayView['places']> {
  const unique = new Map(refs.map(ref => [ref.googlePlaceId, ref]));
  const entries = await Promise.all([...unique].map(async ([googlePlaceId]) => {
    const place = await provider.details({ googlePlaceId, language: 'ko', timeZone, dates: [date] });
    return [googlePlaceId, place && { googlePlaceId: place.googlePlaceId, name: place.name,
      coordinates: place.coordinates, attributions: place.attributions }] as const;
  }));
  const places = new Map(entries);
  return Object.fromEntries(refs.map(ref => [ref.id, places.get(ref.googlePlaceId) ?? null]));
}
