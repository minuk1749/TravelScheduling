import { Temporal } from '@js-temporal/polyfill';
import type { ItineraryDisplayResult, ResultDisplayView } from './model';
export const MODES = { TRANSIT: '대중교통', TAXI: '택시', WALK: '도보' } as const;
export const MEALS = { BREAKFAST: '아침', LUNCH: '점심', DINNER: '저녁' } as const;
export const REASONS = { TIME_WINDOW: '시간창 부족', UNREACHABLE: '이동 불가', FIXED_ORDER: '고정 순서 충돌', MEAL_UNAVAILABLE: '식사 시간 부족', WISH: '희망 장소', NO_ROUTE: '공항 이동 불가', UNVERIFIED: '공항 이동 시각 검증 실패' } as const;
export const localTime = (instant: string, zone: string) => Temporal.Instant.from(instant).toZonedDateTimeISO(zone).toPlainTime().toString({ smallestUnit: 'minute' });
export const localDateTime = (instant: string, zone: string) => Temporal.Instant.from(instant).toZonedDateTimeISO(zone).toPlainDateTime().toString({ smallestUnit: 'minute' }).replace('T', ' ');
export const money = (amount: number | null, currency: string | null) => amount === null || !currency ? '요금 정보 없음' : `${Math.round(amount).toLocaleString('ko-KR')} ${currency} (추정)`;
export const minutes = (amount: number | null) => amount === null ? '정보 없음' : `${Math.ceil(amount)}분`;
export const placeName = (view: ResultDisplayView, id: string) => view.places[id]?.name ?? '장소 정보 없음';
export const visitName = (view: ResultDisplayView, id: string) => placeName(view, view.input.visits.find(v => v.id === id)?.place.id ?? '');
export function displayedSchedule(result: ItineraryDisplayResult | null) {
  return result && result.status !== 'CONFLICT' && result.verification.verified ? result.capacity.recommendation?.schedule : undefined;
}
export function mapMarkers(view: ResultDisplayView, result: ItineraryDisplayResult | null) {
  const placed = new Set(displayedSchedule(result)?.days.flatMap(d => d.stops.flatMap(s => s.kind === 'VISIT' ? [s.visitId] : [])));
  return view.input.visits.flatMap(visit => {
    const place = view.places[visit.place.id];
    return place ? [{ id: visit.id, name: place.name, coordinates: place.coordinates,
      state: placed.has(visit.id) ? 'PLACED' as const : visit.priority === 'WISH' ? 'WISH' as const : 'UNPLACED' as const }] : [];
  });
}
export type MapMarker = ReturnType<typeof mapMarkers>[number];
export const MARKER_LABELS = { PLACED: '● 배치', WISH: '☆ 희망', UNPLACED: '△ 미배치' } as const;
