import type { SchedulingDay } from '../../scheduler';
import type { TripInputs } from './types';

/** Overlay user modes while retaining the day planner's luggage metadata. */
export function applyLegModes(day: SchedulingDay, modes: TripInputs['legModes']): SchedulingDay {
  const settings = new Map(day.legSettings);
  for (const leg of modes ?? []) {
    if (leg.date !== day.date) continue;
    const row = new Map(settings.get(leg.from));
    row.set(leg.to, { ...row.get(leg.to), mode: leg.mode });
    settings.set(leg.from, row);
  }
  return { ...day, legSettings: settings };
}
