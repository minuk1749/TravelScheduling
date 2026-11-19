import type { MealSlot, MealWindows, TaxiPolicy, DayWindowResult } from '../../scheduler';
import type { ApiErrorCode } from '../errors';

export type MealCount = 0 | 1 | 2 | 3;
export interface LivingSettings {
  departureTime: string;
  returnTime: string;
  mealSlots: MealSlot[];
  mealWindows: MealWindows;
  taxiPolicy: TaxiPolicy;
  days: { date: string; departureTime: string | null; returnTime: string | null; mealSlots: MealSlot[] | null }[];
}
export interface SettingsContext {
  timeZone: string;
  startDate: string;
  endDate: string;
  settings: LivingSettings;
  flights: { direction: 'ARRIVAL' | 'DEPARTURE'; localDateTime: string; bufferMinutes: number }[];
  fixedVisits: { id: string; date: string | null; time: string | null; order: number | null; minutes: number }[];
}
export interface SettingsSnapshot extends SettingsContext { revision: string }
export interface SettingsCalculation {
  scope: 'TIME_WINDOWS';
  taxiPolicy: TaxiPolicy;
  days: { date: string; result: DayWindowResult }[];
  conflicts: { date: string | null; visitId?: string; message: string }[];
}
export interface SettingsView { snapshot: SettingsSnapshot; calculation: SettingsCalculation }
const DEFAULT_CODES: Readonly<Record<number, ApiErrorCode>> = {
  400: 'INVALID_JSON', 401: 'UNAUTHENTICATED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 405: 'METHOD_NOT_ALLOWED',
  409: 'INCOMPLETE_TRIP', 413: 'PAYLOAD_TOO_LARGE', 415: 'UNSUPPORTED_MEDIA_TYPE',
};
/** `code` defaults by status; a 409 caused by a concurrent edit passes `STALE_INPUT` explicitly. */
export class SettingsError extends Error {
  readonly code: ApiErrorCode;
  constructor(readonly status: number, message: string, code?: ApiErrorCode) {
    super(message);
    this.code = code ?? DEFAULT_CODES[status] ?? 'INTERNAL';
  }
}

