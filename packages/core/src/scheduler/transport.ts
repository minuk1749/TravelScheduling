export type TravelMode = 'TRANSIT' | 'WALK' | 'TAXI';
export type TaxiPolicy = 'NEVER' | 'WHEN_NEEDED' | 'PREFER';

export interface RouteEstimate {
  minutes: number;
  /** Both fares must use the same city currency. Null means unknown. */
  fare: number | null;
}

export interface RouteOptions {
  TRANSIT?: RouteEstimate;
  WALK?: RouteEstimate;
  /** Drive duration, excluding pickup wait. */
  TAXI?: RouteEstimate;
}

export function selectTravelMode(
  routes: RouteOptions,
  policy: TaxiPolicy,
  options: {
    fixedMode?: TravelMode;
    luggage?: boolean;
    callBufferMinutes?: number | null;
    efficiencyThreshold?: number | null;
  } = {},
): (RouteEstimate & { mode: TravelMode; fixed: boolean }) | null {
  const { TRANSIT: transit, WALK: walk, TAXI: drive } = routes;
  const taxi = drive && { ...drive, minutes: drive.minutes + (options.callBufferMinutes ?? 10) };
  const shortWalk = walk && walk.minutes <= 15;
  const baseline = shortWalk || !transit ? 'WALK' : 'TRANSIT';
  let mode: TravelMode = baseline;

  if (options.fixedMode) {
    mode = options.fixedMode;
  } else if (taxi && policy === 'WHEN_NEEDED') {
    const reference = baseline === 'WALK' ? walk : transit;
    const saved = reference ? reference.minutes - taxi.minutes : 0;
    if (options.luggage || !transit || (
      saved >= 20 && reference?.fare != null && taxi.fare != null &&
      options.efficiencyThreshold != null &&
      (taxi.fare - reference.fare) / saved <= options.efficiencyThreshold
    )) {
      mode = 'TAXI';
    }
  } else if (taxi && policy === 'PREFER' && !shortWalk) {
    mode = transit && transit.minutes < taxi.minutes ? 'TRANSIT' : 'TAXI';
  }

  const route = mode === 'TAXI' ? taxi : routes[mode];
  return route ? { ...route, mode, fixed: options.fixedMode !== undefined } : null;
}
