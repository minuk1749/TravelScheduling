import type { MealSlot, MealWindows, TaxiPolicy, DayWindowResult } from '../scheduler';

export type MealCount = 0 | 1 | 2 | 3;
export interface LivingSettings {
  departureTime: string;
  returnTime: string;
  mealSlots: MealSlot[];
  mealWindows: MealWindows;
  taxiPolicy: TaxiPolicy;
  days: { date: string; departureTime: string | null; returnTime: string | null; mealSlots: MealSlot[] | null }[];
}
export interface SettingsContext {
  timeZone: string;
  startDate: string;
  endDate: string;
  settings: LivingSettings;
  flights: { direction: 'ARRIVAL' | 'DEPARTURE'; localDateTime: string; bufferMinutes: number }[];
  fixedVisits: { id: string; date: string | null; time: string | null; order: number | null; minutes: number }[];
}
export interface SettingsSnapshot extends SettingsContext { revision: string }
export interface SettingsCalculation {
  scope: 'TIME_WINDOWS';
  taxiPolicy: TaxiPolicy;
  days: { date: string; result: DayWindowResult }[];
  conflicts: { date: string | null; visitId?: string; message: string }[];
}
export interface SettingsView { snapshot: SettingsSnapshot; calculation: SettingsCalculation }
export class SettingsError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
