import { cities, TripInputError, type TripDraft } from '@travel/core/contracts/trips/input';
import { ApiFailure } from '../../api/client';

export const taxiLabels = { NEVER: '사용 안 함', WHEN_NEEDED: '필요할 때만', PREFER: '선호' } as const;
export const kindLabels = { ATTRACTION: '명소', RESTAURANT: '식당' } as const;
export const cityName = (code: string) => cities.find(city => city.code === code)?.name ?? code;
export const titleForTrip = ({ cityCode, startDate, endDate }: Pick<TripDraft, 'cityCode' | 'startDate' | 'endDate'>) =>
  `${cityName(cityCode)} · ${startDate}–${endDate}`;
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : '다시 시도해 주세요.';

export function fieldErrors(error: unknown): Record<string, string> {
  if (error instanceof TripInputError) return error.fields;
  if (error instanceof ApiFailure && error.fields && !Array.isArray(error.fields)) return Object.fromEntries(Object.entries(error.fields));
  return {};
}
