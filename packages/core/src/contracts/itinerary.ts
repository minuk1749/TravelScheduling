import type {
  CapacityResult, MealSlot, MealWindows, RouteEstimate, TaxiPolicy, TimeWindow, TravelMode, Visit,
} from '../scheduler';

export const ITINERARY_REQUEST_HEADER = 'Idempotency-Key';

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
  legModes?: readonly { date: string; from: string; to: string; mode: TravelMode }[];
  visits: readonly {
    id: string; place: PlaceRef; kind: 'RESTAURANT' | 'ATTRACTION';
    minutes: number; priority: Visit['priority'];
    fixedDate?: string; fixedTime?: string; fixedOrder?: number;
  }[];
}

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

/**
 * NO_ROUTE: no permitted mode connects the airport leg. UNVERIFIED: no queried departure was
 * confirmed to reach the airport by the check-in deadline within the re-query limit.
 */
export type TransferIssue = {
  date: string; direction: 'ARRIVAL' | 'DEPARTURE'; from: string; to: string; reason: 'NO_ROUTE' | 'UNVERIFIED';
};
/** `arrivalReadyAt` is when the arrival transfer ends; `departureStartBy` is the latest departure-transfer start. */
export type FlightConflict = { date: string; arrivalReadyAt: string; departureStartBy: string };

/** A confirmed fixed airport transfer shortened another local date's activity window. date is the saved flight/leg date. */
export type AirportTransferLimit = { date: string; from: string; to: string; mode: TravelMode; start: string; end: string; affectedDate: string };

export interface ItineraryResult {
  /** Flight-adjusted activity windows in the generation response. Older results can omit them. */
  availableByDate?: Readonly<Record<string, TimeWindow | null>>;
  /** Conflict responses may identify the saved leg and exact reserved interval behind a cross-date limit. */
  airportTransferLimits?: readonly AirportTransferLimit[];
  /** CONFLICT also covers airport transfer/flight issues and an unverified re-query loop. */
  status: CapacityResult['status'];
  capacity: CapacityResult;
  /** Travel times were re-queried at the actual departures. Says nothing about opening hours. */
  verification: { verified: boolean; attempts: number };
  /**
   * Visit IDs in the displayed schedule whose opening hours could not be checked (a closed place is
   * rejected, never listed here). Results generated since T28 always carry the list: an empty array
   * means every scheduled visit's hours were known. Absent means the result predates T28 and whether
   * hours were known was not recorded, so consumers must not read absence as "all known".
   */
  openingHoursUnknown?: readonly string[];
  transferIssues: readonly TransferIssue[];
  /** Flight days where immigration plus the arrival transfer ends after the departure transfer must start. */
  flightConflicts: readonly FlightConflict[];
  /** Meal slots dropped on flight days because no usable window remains around the flight. */
  skippedMeals: readonly { date: string; slot: MealSlot }[];
  comparisons: readonly LegComparison[];
  efficiency: EfficiencySummary | null;
}

