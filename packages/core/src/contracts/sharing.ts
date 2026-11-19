import type { ItineraryDisplayResult, ResultDisplayView } from './results/model';

export type SharedItinerary = { view: ResultDisplayView; result: ItineraryDisplayResult };
export const isShareToken = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token);
