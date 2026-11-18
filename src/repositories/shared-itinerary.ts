import type { PoolClient } from 'pg';
import type { ScheduleResult, TravelMode } from '../scheduler';
import type { ItineraryResult, LegComparison, TripInputs } from '../services/itinerary/types';
import type { ItineraryDisplayResult } from '../results/model';

type Details = {
  time: ItineraryResult['capacity']['time']; issues: ScheduleResult['issues'];
  recommendation: { requiredCount: number; requiredVisitIds: string[] } | null;
  verification: ItineraryResult['verification']; transfers: LegComparison[];
  transferIssues: ItineraryResult['transferIssues']; flightConflicts: ItineraryResult['flightConflicts'];
  skippedMeals: ItineraryResult['skippedMeals'];
};
type StoredResult = {
  id: string; input_hash: string; status: ItineraryResult['status'];
  unplaced: ScheduleResult['unplaced']; efficiency_summary: ItineraryResult['efficiency'];
  details: Partial<Details>;
};
type StoredStop = {
  day_plan_id: string; kind: 'VISIT' | 'MEAL'; trip_place_id: string;
  meal_slot: 'BREAKFAST' | 'LUNCH' | 'DINNER'; arrival_time: Date; departure_time: Date;
};
type StoredLeg = {
  day_plan_id: string; from_place_id: string; to_place_id: string;
  selected_mode: TravelMode; user_fixed: boolean; departure_time: Date; arrival_time: Date;
  fare: string | null; alternatives: { baseline: LegComparison['baseline']; options: LegComparison['alternatives'] };
};

/** Reads the existing normalized T12 storage, with a constant number of queries. */
export async function readSharedResult(client: PoolClient, input: TripInputs, inputHash: string): Promise<ItineraryDisplayResult | null> {
  const row = (await client.query<StoredResult>(`SELECT id, input_hash, status, unplaced, efficiency_summary, details
    FROM itineraries WHERE trip_id = $1 ORDER BY generation DESC LIMIT 1`, [input.id])).rows[0];
  if (!row || row.input_hash !== inputHash) return null;
  const d = row.details;
  // Legacy rows without the T12 details cannot be displayed as verified itineraries.
  if (!d.time || !d.issues || !d.verification || !d.transfers || !d.transferIssues || !d.flightConflicts || !d.skippedMeals) return null;
  const comparisons = [...d.transfers];
  const base = { time: d.time, unplaced: row.unplaced, issues: d.issues };
  let capacity: ItineraryDisplayResult['capacity'];
  if (row.status === 'CONFLICT') {
    capacity = { ...base, status: 'CONFLICT', recommendation: null };
  } else {
    if (!d.recommendation) return null;
    const days = (await client.query<{ id: string; date: string }>(
      'SELECT id, date::text FROM day_plans WHERE itinerary_id = $1 ORDER BY date', [row.id],
    )).rows;
    const stops = (await client.query<StoredStop>(`SELECT s.* FROM stops s JOIN day_plans d ON d.id = s.day_plan_id
      WHERE d.itinerary_id = $1 ORDER BY d.date, s.position`, [row.id])).rows;
    const legs = (await client.query<StoredLeg>(`SELECT l.* FROM legs l JOIN day_plans d ON d.id = l.day_plan_id
      WHERE d.itinerary_id = $1 ORDER BY d.date, l.position`, [row.id])).rows;
    const byId = new Map(days.map(day => [day.id, {
      date: day.date, timeZone: input.timeZone, stops: [] as ScheduleResult['days'][number]['stops'],
      legs: [] as ScheduleResult['days'][number]['legs'],
    }]));
    for (const stop of stops) {
      const times = { start: stop.arrival_time.toISOString(), end: stop.departure_time.toISOString() };
      byId.get(stop.day_plan_id)!.stops.push(stop.kind === 'VISIT'
        ? { ...times, kind: 'VISIT', visitId: stop.trip_place_id }
        : { ...times, kind: 'MEAL', slot: stop.meal_slot });
    }
    for (const leg of legs) {
      const day = byId.get(leg.day_plan_id)!;
      const minutes = (leg.arrival_time.getTime() - leg.departure_time.getTime()) / 60_000;
      const fare = leg.fare === null ? null : Number(leg.fare);
      const start = leg.departure_time.toISOString();
      day.legs.push({ from: leg.from_place_id, to: leg.to_place_id, start, end: leg.arrival_time.toISOString(),
        mode: leg.selected_mode, fixed: leg.user_fixed, fare });
      comparisons.push({ date: day.date, kind: 'DAY', from: leg.from_place_id, to: leg.to_place_id, departure: start,
        selected: { mode: leg.selected_mode, fixed: leg.user_fixed, minutes, fare },
        baseline: leg.alternatives.baseline, alternatives: leg.alternatives.options });
    }
    capacity = { ...base, status: row.status, recommendation: { ...d.recommendation,
      schedule: { days: [...byId.values()] } } };
  }
  return { status: row.status, capacity, comparisons, efficiency: row.efficiency_summary,
    verification: d.verification, transferIssues: d.transferIssues,
    flightConflicts: d.flightConflicts, skippedMeals: d.skippedMeals };
}
