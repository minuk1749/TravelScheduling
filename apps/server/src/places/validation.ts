import { Temporal } from '@js-temporal/polyfill';
import { PlaceInputError, type PlaceDetailsRequest, type PlaceSearchRequest } from './index';

export function placeId(value: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,255}$/.test(value)) {
    throw new PlaceInputError('googlePlaceId가 올바르지 않습니다.');
  }
  return value;
}

export function searchRequest(input: PlaceSearchRequest): PlaceSearchRequest {
  if (input.language !== 'ko' || typeof input.query !== 'string') {
    throw new PlaceInputError('검색어와 한국어 설정이 필요합니다.');
  }
  const query = input.query.trim().replace(/\s+/gu, ' ');
  const regionCode = input.regionCode?.toUpperCase();
  if (!query || query.length > 200 || (regionCode !== undefined && !/^[A-Z]{2}$/.test(regionCode))) {
    throw new PlaceInputError('검색어는 1–200자, 지역 코드는 두 영문자여야 합니다.');
  }
  return { query, language: 'ko', ...(regionCode ? { regionCode } : {}) };
}

export function detailsRequest(input: PlaceDetailsRequest): PlaceDetailsRequest {
  placeId(input.googlePlaceId);
  if (input.language !== 'ko' || !Array.isArray(input.dates) || input.dates.length > 31) {
    throw new PlaceInputError('한국어 설정과 최대 31개의 날짜가 필요합니다.');
  }
  try {
    if (!input.timeZone || /^[+-]/.test(input.timeZone)) throw new RangeError();
    Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(input.timeZone);
    for (const date of input.dates) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Temporal.PlainDate.from(date).toString() !== date) {
        throw new RangeError();
      }
    }
  } catch {
    throw new PlaceInputError('날짜 또는 IANA 시간대가 올바르지 않습니다.');
  }
  return { ...input, dates: [...new Set(input.dates)].sort() };
}
