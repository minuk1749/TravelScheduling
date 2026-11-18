import type { ScheduleResult } from '../scheduler';
import type { ItineraryResult, LegComparison } from '../services/itinerary/types';

/**
 * `itineraries.details` JSONB written by T12 and read back by sharing. Keeping the encoder and the
 * completeness check next to the type means a new field changes one file, not writer and reader separately.
 */
export type ItineraryDetails = {
  schedule: 'FULL' | 'RECOMMENDATION' | null;
  time: ItineraryResult['capacity']['time']; issues: ScheduleResult['issues'];
  recommendation: { requiredCount: number; requiredVisitIds: string[] } | null;
  verification: ItineraryResult['verification']; transferIssues: ItineraryResult['transferIssues'];
  flightConflicts: ItineraryResult['flightConflicts']; skippedMeals: ItineraryResult['skippedMeals'];
  /** Airport legs; day legs live in the normalized `legs` rows. */
  transfers: LegComparison[];
};

export function encodeItineraryDetails(result: ItineraryResult, schedule: ScheduleResult | null): ItineraryDetails {
  const { capacity } = result;
  return {
    schedule: schedule ? (capacity.status === 'OK' ? 'FULL' : 'RECOMMENDATION') : null,
    time: capacity.time,
    issues: capacity.issues,
    recommendation: capacity.recommendation && {
      requiredCount: capacity.recommendation.requiredCount, requiredVisitIds: capacity.recommendation.requiredVisitIds,
    },
    verification: result.verification,
    transferIssues: result.transferIssues,
    flightConflicts: result.flightConflicts,
    skippedMeals: result.skippedMeals,
    transfers: result.comparisons.filter(leg => leg.kind === 'AIRPORT'),
  };
}

/** Legacy rows predate some fields and cannot be displayed as verified itineraries. */
export function isCompleteItineraryDetails(details: Partial<ItineraryDetails>): details is ItineraryDetails {
  return Boolean(details.time && details.issues && details.verification && details.transfers
    && details.transferIssues && details.flightConflicts && details.skippedMeals);
}
