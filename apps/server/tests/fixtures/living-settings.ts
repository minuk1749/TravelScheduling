import { DEFAULT_MEAL_WINDOWS } from '../../src/scheduler';
import type { SettingsSnapshot } from '../../src/settings/model';
export const settingsSnapshot: SettingsSnapshot = {
  timeZone: 'Asia/Tokyo', startDate: '2026-12-01', endDate: '2026-12-03', revision: 'initial',
  settings: { departureTime: '09:00', returnTime: '21:00', mealSlots: ['LUNCH', 'DINNER'],
    mealWindows: structuredClone(DEFAULT_MEAL_WINDOWS), taxiPolicy: 'WHEN_NEEDED', days: [] },
  flights: [{ direction: 'ARRIVAL', localDateTime: '2026-12-01T09:00', bufferMinutes: 90 },
    { direction: 'DEPARTURE', localDateTime: '2026-12-03T18:00', bufferMinutes: 150 }],
  fixedVisits: [{ id: 'fixed-museum', date: '2026-12-02', time: '10:00', minutes: 60, order: 0 }],
};
