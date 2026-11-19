import type { CityProfile } from '../fare';
import type { DayWindowResult, MealSlot, TimeWindow } from './index';
import type { RouteOptions, TaxiPolicy, TravelMode } from './transport';

export interface Visit {
  id: string;
  locationId: string;
  coordinates: { latitude: number; longitude: number };
  minutes: number;
  priority: 'REQUIRED' | 'WISH';
  fixedDate?: string;
  /** Instant with an explicit UTC offset. */
  fixedStart?: string;
  /** Zero-based position among visits on the day. */
  fixedOrder?: number;
  /** Instant windows for the entire trip. Omit when hours are unknown. */
  openingHours?: readonly TimeWindow[];
}

export interface SchedulingDay {
  date: string;
  window: DayWindowResult;
  startLocationId: string;
  endLocationId: string;
  routes: ReadonlyMap<string, ReadonlyMap<string, RouteOptions>>;
  /** Overrides and luggage flags apply to directed pairs on this date. */
  legSettings?: ReadonlyMap<string, ReadonlyMap<string, { mode?: TravelMode; luggage?: boolean }>>;
}

export interface ScheduleInput {
  days: readonly SchedulingDay[];
  visits: readonly Visit[];
  mealMinutes: Readonly<Record<MealSlot, number>>;
  taxiPolicy: TaxiPolicy;
  cityProfile?: Pick<CityProfile, 'callBufferMinutes' | 'efficiencyThreshold'>;
}

type Timed = { start: string; end: string };
type Stop = Timed & ({ kind: 'VISIT'; visitId: string } | { kind: 'MEAL'; slot: MealSlot });
type Leg = Timed & {
  from: string;
  to: string;
  mode: TravelMode;
  fixed: boolean;
  fare: number | null;
};
type Failure = 'TIME_WINDOW' | 'UNREACHABLE' | 'FIXED_ORDER';

export interface ScheduleResult {
  days: { date: string; timeZone: string; stops: Stop[]; legs: Leg[] }[];
  unplaced: { visitId: string; reason: Failure | 'WISH'; fixed: boolean }[];
  issues: (
    | { date: string; reason: 'MEAL_UNAVAILABLE'; slot: MealSlot }
    | { date: string; reason: 'UNREACHABLE'; from: string; to: string }
    | { date: string; reason: 'TIME_WINDOW' }
  )[];
}

