import { Temporal } from '@js-temporal/polyfill';
import type { TimeWindow } from '../scheduler';
import { PlaceProviderError } from './index';

type Point = { day: number; hour: number; minute: number };
type Period = { open: Point; close?: Point };

export function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PlaceProviderError('INVALID_RESPONSE');
  }
  return value as Record<string, unknown>;
}

function point(value: unknown): Point {
  const data = object(value);
  // Google omits zero-valued protobuf fields.
  const day = data.day ?? 0, hour = data.hour ?? 0, minute = data.minute ?? 0;
  for (const [value, max] of [[day, 6], [hour, 23], [minute, 59]]) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > Number(max)) {
      throw new PlaceProviderError('INVALID_RESPONSE');
    }
  }
  return { day: day as number, hour: hour as number, minute: minute as number };
}

/** Project regular weekly hours into requested local days. Holiday overrides are not inferred. */
export function openingWindows(value: unknown, dates: readonly string[], timeZone: string): TimeWindow[] | undefined {
  if (value === undefined) return undefined;
  const raw = object(value).periods;
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new PlaceProviderError('INVALID_RESPONSE');
  const periods: Period[] = raw.map(value => {
    const period = object(value);
    return { open: point(period.open), ...(period.close === undefined ? {} : { close: point(period.close) }) };
  });
  const alwaysOpen = periods.length === 1 && !periods[0].close &&
    periods[0].open.day === 0 && periods[0].open.hour === 0 && periods[0].open.minute === 0;
  if (!alwaysOpen && periods.some(period => !period.close)) throw new PlaceProviderError('INVALID_RESPONSE');
  const windows: { start: number; end: number }[] = [];
  const instant = (date: Temporal.PlainDate, hour = 0, minute = 0) =>
    date.toPlainDateTime({ hour, minute }).toZonedDateTime(timeZone, { disambiguation: 'reject' }).epochMilliseconds;
  try {
    for (const text of dates) {
      const date = Temporal.PlainDate.from(text);
      const startOfDay = instant(date), endOfDay = instant(date.add({ days: 1 }));
      if (alwaysOpen) {
        windows.push({ start: startOfDay, end: endOfDay });
        continue;
      }
      for (const { open, close } of periods) {
        if (!close) continue;
        const daysBack = ((date.dayOfWeek % 7) - open.day + 7) % 7;
        let span = (close.day - open.day + 7) % 7;
        if (span === 0 && close.hour * 60 + close.minute <= open.hour * 60 + open.minute) span = 7;
        // A near-week-long period can still be open before this week's opening on the same weekday.
        for (const previousWeek of [0, 7]) {
          const openDate = date.subtract({ days: daysBack + previousWeek });
          const closeDate = openDate.add({ days: span });
          if (Temporal.PlainDate.compare(closeDate, date) < 0) continue;
          const start = Math.max(startOfDay, instant(openDate, open.hour, open.minute));
          const end = Math.min(endOfDay, instant(closeDate, close.hour, close.minute));
          if (start < end) windows.push({ start, end });
        }
      }
    }
  } catch {
    // DST ambiguity in upstream hours is not a client input error or "closed".
    throw new PlaceProviderError('INVALID_RESPONSE');
  }
  windows.sort((a, b) => a.start - b.start);
  const merged: typeof windows = [];
  for (const window of windows) {
    const last = merged.at(-1);
    if (last && window.start <= last.end) last.end = Math.max(last.end, window.end);
    else merged.push({ ...window });
  }
  return merged.map(window => ({ start: new Date(window.start).toISOString(), end: new Date(window.end).toISOString() }));
}
