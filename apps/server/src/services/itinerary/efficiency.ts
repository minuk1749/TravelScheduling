import type { CityProfile } from '../../fare';
import { selectTravelMode, type RouteEstimate, type RouteOptions, type TravelMode } from '../../scheduler';
import type { EfficiencySummary, LegComparison, RouteAlternatives } from './types';

type ProfileRules = Pick<CityProfile, 'callBufferMinutes' | 'efficiencyThreshold'> | null;
const MODES: readonly TravelMode[] = ['TRANSIT', 'WALK', 'TAXI'];

/** Stage 8 per-leg comparison. Mode rules (pickup wait, walking threshold) stay in the scheduler. */
export function compareLeg(
  leg: Pick<LegComparison, 'date' | 'kind' | 'from' | 'to' | 'departure' | 'selected'>,
  options: RouteOptions,
  profile: ProfileRules,
): LegComparison {
  const rules = { callBufferMinutes: profile?.callBufferMinutes, efficiencyThreshold: profile?.efficiencyThreshold };
  const alternatives: RouteAlternatives = {};
  for (const mode of MODES) {
    const choice = options[mode] && selectTravelMode(options, 'NEVER', { ...rules, fixedMode: mode });
    if (choice) alternatives[mode] = { minutes: choice.minutes, fare: choice.fare };
  }
  const transitOnly = selectTravelMode(options, 'NEVER', rules);
  return {
    ...leg,
    baseline: transitOnly && { mode: transitOnly.mode, minutes: transitOnly.minutes, fare: transitOnly.fare },
    alternatives,
  };
}

function total(values: readonly (number | null)[]): number | null {
  let sum = 0;
  for (const value of values) {
    if (value === null) return null;
    sum += value;
  }
  return sum;
}

/** Trip-wide totals for the policy result versus transit/walking only, on the same timeline. */
export function summarize(comparisons: readonly LegComparison[], currency: string | null): EfficiencySummary {
  const baselines = comparisons.map(leg => leg.baseline);
  const complete = baselines.every((baseline): baseline is RouteEstimate & { mode: TravelMode } => baseline !== null);
  return {
    currency,
    transitMinutes: complete ? total(baselines.map(baseline => baseline.minutes)) : null,
    selectedMinutes: total(comparisons.map(leg => leg.selected.minutes)) ?? 0,
    transitFare: complete ? total(baselines.map(baseline => baseline.fare)) : null,
    selectedFare: total(comparisons.map(leg => leg.selected.fare)),
  };
}
