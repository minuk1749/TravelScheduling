import type { TripDraft } from '../../src/trips/input';
import type { CityProfile } from '../../src/fare';
export const tripDraft: TripDraft = {
  cityCode: 'TOKYO', timeZone: 'Asia/Tokyo', startDate: '2026-12-01', endDate: '2026-12-03',
  taxiPolicy: 'WHEN_NEEDED', luggageOption: 'VIA_LODGING',
  flights: [ { direction: 'ARRIVAL', googlePlaceId: 'airport', localDateTime: '2026-12-01T09:00' },
    { direction: 'DEPARTURE', googlePlaceId: 'airport', localDateTime: '2026-12-03T18:00' } ],
  lodgings: [ { googlePlaceId: 'hotel-a', checkIn: '2026-12-01', checkOut: '2026-12-02' },
    { googlePlaceId: 'hotel-b', checkIn: '2026-12-02', checkOut: '2026-12-03' } ],
  visits: [ { googlePlaceId: 'museum', kind: 'ATTRACTION', minutes: 90, priority: 'REQUIRED' },
    { googlePlaceId: 'restaurant', kind: 'RESTAURANT', minutes: 60, priority: 'WISH' } ],
};
// Synthetic values only. Never seed production profiles from this fixture.
export const cityProfile: CityProfile = {
  cityCode: 'TOKYO', country: 'JP', currency: 'JPY', transitCoverage: '테스트 철도망', transitHours: '05:00–23:00',
  taxiBaseFare: 100, taxiFarePerKm: 20, taxiFarePerMinute: 5, nightSurcharge: 0.2, nightStart: '22:00', nightEnd: '05:00',
  callBufferMinutes: 10, efficiencyThreshold: 30, rideHailingApps: ['테스트 앱'], source: 'https://example.test/fares', updatedAt: '2026-11-18T00:00:00.000Z',
};
