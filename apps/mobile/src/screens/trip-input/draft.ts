import type { PlaceSummary } from '@travel/core/contracts/places';
import type { FixedVisit } from '@travel/core/contracts/results/fixed-visit';
import { defaultLivingSettings, flightBuffers } from '@travel/core/contracts/settings/defaults';
import { parseSettings } from '@travel/core/contracts/settings/input';
import { cities, parseTripDraft, type TripDraft } from '@travel/core/contracts/trips/input';
import type { Errors } from '../../components/input/fields';
import { fieldErrors } from './presentation';

type PlaceSelection = { place?: PlaceSummary };
type Flight = PlaceSelection & { direction: 'ARRIVAL' | 'DEPARTURE'; time: string };
type Lodging = PlaceSelection & { key: number; checkIn: string; checkOut: string };
export type DraftVisit = TripDraft['visits'][number] & FixedVisit & { place: PlaceSummary };

export function initialDraft() {
  return {
    cityCode: '', timeZone: '', startDate: '', endDate: '',
    luggageOption: 'VIA_LODGING' as TripDraft['luggageOption'],
    flights: [{ direction: 'ARRIVAL', time: '' }, { direction: 'DEPARTURE', time: '' }] as Flight[],
    lodgings: [] as Lodging[],
    settings: defaultLivingSettings('WHEN_NEEDED'),
  };
}

export type TripFormDraft = ReturnType<typeof initialDraft>;

export function flightInputs(draft: TripFormDraft) {
  return draft.flights.map(({ direction, time, place }) => ({
    direction, googlePlaceId: place?.googlePlaceId ?? '',
    localDateTime: `${(direction === 'ARRIVAL' ? draft.startDate : draft.endDate).trim()}T${time.trim()}`,
  }));
}

export function validateForm(draft: TripFormDraft) {
  const input = {
    cityCode: draft.cityCode.trim(), timeZone: draft.timeZone.trim(), startDate: draft.startDate.trim(), endDate: draft.endDate.trim(),
    flights: flightInputs(draft),
    lodgings: draft.lodgings.map(({ place, checkIn, checkOut }) => ({ googlePlaceId: place?.googlePlaceId, checkIn, checkOut })),
    luggageOption: draft.luggageOption, taxiPolicy: draft.settings.taxiPolicy, visits: [],
  };
  let tripErrors: Errors = {};
  let settingsErrors: Errors = {};
  try { parseTripDraft(input, 2); } catch (error) { tripErrors = fieldErrors(error); }
  const { startDate, endDate, timeZone } = tripErrors;
  if (!startDate && !endDate && !timeZone) {
    try { parseSettings(draft.settings, input); }
    catch (error) {
      settingsErrors = Object.fromEntries(Object.entries(fieldErrors(error)).map(([field, msg]) => [`settings.${field}`, msg]));
    }
  }
  return { input, errors: { ...tripErrors, ...settingsErrors } };
}

export const flightFacts = (draft: TripFormDraft) =>
  flightInputs(draft).map(flight => ({ ...flight, bufferMinutes: flightBuffers[flight.direction] }));

export function regionFor(cityCode: string) {
  return cities.find(city => city.code === cityCode)?.region;
}
