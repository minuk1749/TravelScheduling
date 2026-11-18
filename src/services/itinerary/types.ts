import type { CityProfile } from '../../fare';
import type { PlaceProvider } from '../../places';
import type {
  CapacityResult, MealSlot, MealWindows, RouteEstimate, TaxiPolicy, TimeWindow, TravelMode, Visit,
} from '../../scheduler';
import type { TravelTimeProvider } from '../../travel-time';

/** `id` is `places.id` (scheduler location ID); `googlePlaceId` is only for provider lookups. */
export type PlaceRef = { id: string; googlePlaceId: string };
export type LuggageOption = 'VIA_LODGING' | 'DIRECT_TO_AIRPORT';

/** Validated snapshot of the stored trip. Local dates/times are wall-clock values in `timeZone`. */
export interface TripInputs {
  id: string;
  cityCode: string;
  timeZone: string;
  startDate: string;
  endDate: string;
  activity: TimeWindow;
  mealSlots: readonly MealSlot[];
  mealWindows: MealWindows;
  taxiPolicy: TaxiPolicy;
  luggageOption: LuggageOption;
  arrivalBufferMinutes: number;
  departureBufferMinutes: number;
  daySettings: readonly {
    date: string; departureTime: string | null; returnTime: string | null;
    mealSlots: readonly MealSlot[] | null;
  }[];
  flights: readonly { direction: 'ARRIVAL' | 'DEPARTURE'; airport: PlaceRef; localDateTime: string }[];
  lodgings: readonly { place: PlaceRef; checkIn: string; checkOut: string }[];
  visits: readonly {
    id: string; place: PlaceRef; kind: 'RESTAURANT' | 'ATTRACTION';
    minutes: number; priority: Visit['priority'];
    fixedDate?: string; fixedTime?: string; fixedOrder?: number;
  }[];
}

export type TripLoad =
  | { status: 'READY'; input: TripInputs; inputHash: string }
  | { status: 'INCOMPLETE'; fields: readonly string[] };

/** TAXI minutes here include the pickup wait; fares are in `EfficiencySummary.currency`. */
export type RouteAlternatives = Partial<Record<TravelMode, RouteEstimate>>;

export interface LegComparison {
  date: string;
  /** DAY legs follow the daily route order; AIRPORT legs are the flight-day transfers. */
  kind: 'DAY' | 'AIRPORT';
  from: string;
  to: string;
  /** Actual departure instant the alternatives were queried for. */
  departure: string;
  selected: RouteEstimate & { mode: TravelMode; fixed: boolean };
  /** Transit/walk-only choice for the same leg, or null when neither is possible. */
  baseline: (RouteEstimate & { mode: TravelMode }) | null;
  alternatives: RouteAlternatives;
}

export interface EfficiencySummary {
  currency: string | null;
  /** Null when some leg has no transit or walking route. */
  transitMinutes: number | null;
  selectedMinutes: number;
  /** Null when any contributing fare is unknown; unknown fares are never summed as 0. */
  transitFare: number | null;
  selectedFare: number | null;
}

export interface ItineraryResult {
  /** CONFLICT also covers unreachable airport transfers and an unverified re-query loop. */
  status: CapacityResult['status'];
  capacity: CapacityResult;
  verification: { verified: boolean; attempts: number };
  transferIssues: readonly { date: string; direction: 'ARRIVAL' | 'DEPARTURE'; from: string; to: string }[];
  /** Meal slots dropped on flight days because no usable window remains around the flight. */
  skippedMeals: readonly { date: string; slot: MealSlot }[];
  comparisons: readonly LegComparison[];
  efficiency: EfficiencySummary | null;
}

export type SaveOutcome = { status: 'SAVED'; itineraryId: string } | { status: 'STALE' };

export interface ItineraryRepository {
  loadInputs(tripId: string): Promise<TripLoad | null>;
  /** Must lock the trip and re-check the input hash; returns STALE when inputs changed. */
  saveItinerary(tripId: string, inputHash: string, result: ItineraryResult): Promise<SaveOutcome>;
}

export interface CityProfileSource {
  findByCityCode(cityCode: string): Promise<CityProfile | null>;
}

export type ItineraryPlaces = Pick<PlaceProvider, 'details' | 'location'>;

export interface ItineraryDependencies {
  repository: ItineraryRepository;
  profiles: CityProfileSource;
  places: ItineraryPlaces;
  travel: TravelTimeProvider;
}

export type GenerateOutcome =
  | { status: 'NOT_FOUND' }
  | { status: 'INCOMPLETE'; fields: readonly string[] }
  | { status: 'STALE' }
  | { status: 'SAVED'; itineraryId: string; result: ItineraryResult };

/** The stored trip cannot be scheduled until the listed fields are corrected. */
export class ItineraryInputError extends Error {
  constructor(readonly fields: Record<string, string>) {
    super('일정을 만들 수 없는 입력이 있습니다. 여행 정보를 확인해 주세요.');
  }
}
