import { Temporal } from '@js-temporal/polyfill';

export const cities = [
  { code: 'TOKYO', name: '도쿄', timeZone: 'Asia/Tokyo', region: 'JP' },
  { code: 'OSAKA', name: '오사카', timeZone: 'Asia/Tokyo', region: 'JP' },
  { code: 'FUKUOKA', name: '후쿠오카', timeZone: 'Asia/Tokyo', region: 'JP' },
  { code: 'TAIPEI', name: '타이베이', timeZone: 'Asia/Taipei', region: 'TW' },
  { code: 'HONG_KONG', name: '홍콩', timeZone: 'Asia/Hong_Kong', region: 'HK' },
  { code: 'BANGKOK', name: '방콕', timeZone: 'Asia/Bangkok', region: 'TH' },
  { code: 'DA_NANG', name: '다낭', timeZone: 'Asia/Ho_Chi_Minh', region: 'VN' },
  { code: 'SINGAPORE', name: '싱가포르', timeZone: 'Asia/Singapore', region: 'SG' },
  { code: 'PARIS', name: '파리', timeZone: 'Europe/Paris', region: 'FR' },
  { code: 'LONDON', name: '런던', timeZone: 'Europe/London', region: 'GB' },
] as const;
export type TripDraft = {
  cityCode: string; timeZone: string; startDate: string; endDate: string;
  taxiPolicy: 'NEVER' | 'WHEN_NEEDED' | 'PREFER';
  luggageOption: 'VIA_LODGING' | 'DIRECT_TO_AIRPORT';
  flights: { direction: 'ARRIVAL' | 'DEPARTURE'; googlePlaceId: string; localDateTime: string }[];
  lodgings: { googlePlaceId: string; checkIn: string; checkOut: string }[];
  visits: { googlePlaceId: string; kind: 'RESTAURANT' | 'ATTRACTION'; minutes: number; priority: 'REQUIRED' | 'WISH' }[];
};
export class TripInputError extends Error {
  constructor(readonly fields: Record<string, string>) { super('입력 내용을 확인해 주세요.'); }
}
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const string = (value: unknown) => typeof value === 'string' ? value.trim() : '';

/** Shared client/server validator. Returns only permitted fields; never accepts owner IDs or Google details. */
export function parseTripDraft(raw: unknown, step = 3): TripDraft {
  const data = object(raw), errors: Record<string, string> = {};
  const fail = (key: string, message: string) => { errors[key] = message; };
  const date = (value: unknown, key: string) => {
    const text = string(value);
    try { if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || text.startsWith('0000-') || Temporal.PlainDate.from(text).toString() !== text) throw Error(); }
    catch { fail(key, '올바른 날짜를 입력해 주세요.'); }
    return text;
  };
  const id = (value: unknown, key: string) => {
    const text = string(value);
    if (!/^[A-Za-z0-9_-]{1,255}$/.test(text)) fail(key, '검색 결과에서 장소를 선택해 주세요.');
    return text;
  };
  const cityCode = string(data.cityCode), timeZone = string(data.timeZone);
  if (!cityCode || cityCode.length > 80) fail('cityCode', '도시를 입력해 주세요 (최대 80자).');
  try {
    if (!timeZone || /^[+-]/.test(timeZone) || timeZone === 'Asia/Seoul') throw Error();
    Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(timeZone);
    const city = cities.find(city => city.code === cityCode);
    if (city && city.timeZone !== timeZone) throw Error();
  } catch { fail('timeZone', '해외 도시의 IANA 시간대를 입력해 주세요.'); }
  const startDate = date(data.startDate, 'startDate'), endDate = date(data.endDate, 'endDate');
  if (!errors.startDate && !errors.endDate) {
    const days = Temporal.PlainDate.from(startDate).until(Temporal.PlainDate.from(endDate)).days;
    if (days < 0 || days > 30) fail('endDate', '여행 기간은 시작일부터 1–31일이어야 합니다.');
  }
  const taxiPolicy = data.taxiPolicy;
  if (!['NEVER', 'WHEN_NEEDED', 'PREFER'].includes(taxiPolicy as string)) fail('taxiPolicy', '택시 정책을 선택해 주세요.');
  const luggageOption = data.luggageOption;
  if (!['VIA_LODGING', 'DIRECT_TO_AIRPORT'].includes(luggageOption as string)) fail('luggageOption', '짐 처리 방식을 선택해 주세요.');
  const rows = (key: string, max: number) => {
    const value = data[key];
    if (!Array.isArray(value) || value.length > max) { fail(key, `최대 ${max}개까지 입력할 수 있습니다.`); return []; }
    return value.map(object);
  };
  const flights = rows('flights', 2).map((flight, i) => {
    const key = `flights.${i}`, localDateTime = string(flight.localDateTime);
    if (!['ARRIVAL', 'DEPARTURE'].includes(flight.direction as string)) fail(`${key}.direction`, '항공 방향이 올바르지 않습니다.');
    try {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localDateTime)) throw Error();
      Temporal.PlainDateTime.from(localDateTime).toZonedDateTime(timeZone, { disambiguation: 'reject' });
      const expected = flight.direction === 'ARRIVAL' ? startDate : endDate;
      if (localDateTime.slice(0, 10) !== expected) throw Error();
    } catch { if (step >= 1) fail(`${key}.localDateTime`, '도착은 여행 첫날, 출발은 마지막 날의 유효한 현지 시각이어야 합니다.'); }
    return { direction: flight.direction as 'ARRIVAL' | 'DEPARTURE', googlePlaceId: step >= 1 ? id(flight.googlePlaceId, `${key}.googlePlaceId`) : string(flight.googlePlaceId), localDateTime };
  });
  if (step >= 1) {
    if (flights.length !== 2 || new Set(flights.map(f => f.direction)).size !== 2) fail('flights', '도착·출발 항공편을 각각 입력해 주세요.');
    const arrival = flights.find(f => f.direction === 'ARRIVAL'), departure = flights.find(f => f.direction === 'DEPARTURE');
    if (arrival && departure && arrival.localDateTime >= departure.localDateTime) fail('flights', '출발 시각은 도착 시각 이후여야 합니다.');
  }
  const lodgings = rows('lodgings', 31).map((lodging, i) => {
    const key = `lodgings.${i}`;
    const checkIn = step >= 2 ? date(lodging.checkIn, `${key}.checkIn`) : string(lodging.checkIn);
    const checkOut = step >= 2 ? date(lodging.checkOut, `${key}.checkOut`) : string(lodging.checkOut);
    if (step >= 2 && (checkIn < startDate || checkOut > endDate || checkOut <= checkIn)) fail(key, '숙박 기간은 여행 기간 내에서 체크아웃이 체크인 이후여야 합니다.');
    return { googlePlaceId: step >= 2 ? id(lodging.googlePlaceId, `${key}.googlePlaceId`) : string(lodging.googlePlaceId), checkIn, checkOut };
  });
  if (step >= 2 && startDate !== endDate) {
    const sorted = [...lodgings].sort((a, b) => a.checkIn.localeCompare(b.checkIn));
    let next = startDate;
    for (const lodging of sorted) { if (lodging.checkIn !== next) fail('lodgings', '숙박 기간에 빈 날짜나 겹침이 없도록 입력해 주세요.'); next = lodging.checkOut; }
    if (next !== endDate) fail('lodgings', '여행의 모든 숙박 날짜를 입력해 주세요.');
  }
  const visits = rows('visits', 100).map((visit, i) => {
    const key = `visits.${i}`;
    if (step >= 3) {
      if (!['RESTAURANT', 'ATTRACTION'].includes(visit.kind as string)) fail(`${key}.kind`, '식당 또는 명소를 선택해 주세요.');
      if (!['REQUIRED', 'WISH'].includes(visit.priority as string)) fail(`${key}.priority`, '필수 또는 희망을 선택해 주세요.');
      if (typeof visit.minutes !== 'number' || !Number.isInteger(visit.minutes) || visit.minutes < 1 || visit.minutes > 1440) fail(`${key}.minutes`, '체류시간은 1–1,440분의 정수여야 합니다.');
    }
    return { googlePlaceId: step >= 3 ? id(visit.googlePlaceId, `${key}.googlePlaceId`) : string(visit.googlePlaceId), kind: visit.kind as 'RESTAURANT' | 'ATTRACTION', minutes: visit.minutes as number, priority: visit.priority as 'REQUIRED' | 'WISH' };
  });
  if (step >= 3) {
    if (!visits.length) fail('visits', '방문할 장소를 하나 이상 추가해 주세요.');
    if (new Set(visits.map(v => v.googlePlaceId)).size !== visits.length) fail('visits', '같은 방문 장소를 중복 추가할 수 없습니다.');
  }
  if (Object.keys(errors).length) throw new TripInputError(errors);
  return { cityCode, timeZone, startDate, endDate, taxiPolicy: taxiPolicy as TripDraft['taxiPolicy'], luggageOption: luggageOption as TripDraft['luggageOption'], flights, lodgings, visits };
}
