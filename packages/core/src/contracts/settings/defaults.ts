import { mealSlotsForCount } from '../../scheduler';
import type { LivingSettings } from './model';

export const flightBuffers = { ARRIVAL: 90, DEPARTURE: 150 } as const;

export function defaultLivingSettings(taxiPolicy: LivingSettings['taxiPolicy']): LivingSettings {
  return {
    departureTime: '09:00', returnTime: '21:00', mealSlots: mealSlotsForCount(2), taxiPolicy, days: [],
    mealWindows: {
      BREAKFAST: { start: '07:30', end: '09:30' },
      LUNCH: { start: '11:30', end: '14:00' },
      DINNER: { start: '17:30', end: '20:30' },
    },
  };
}
