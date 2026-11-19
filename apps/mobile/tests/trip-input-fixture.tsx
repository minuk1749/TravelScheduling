import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { calculateSettings } from '@travel/core/contracts/settings/calculate';
import type { SettingsSnapshot } from '@travel/core/contracts/settings/model';
import { parseTripCreation, type TripCreation } from '@travel/core/contracts/trips/create';
import { flightBuffers } from '@travel/core/contracts/settings/defaults';
import { AuthProvider } from '../src/auth/provider';
import { RootNavigator } from '../src/navigation/root-navigator';
import Home from '../app/(app)/index';
import Login from '../app/login';
import NewTrip from '../app/(app)/trips/new';
import SavedTrip from '../app/(app)/trips/[id]/index';
import Settings from '../app/(app)/trips/[id]/settings';
import Generate from '../app/(app)/trips/[id]/generate';
import { fixture, json, session } from './helpers';

const names: Record<string, string> = {
  airport: '나리타 공항', hotel: '도쿄 호텔', museum: '도쿄 미술관', cafe: '도쿄 카페', city: '도쿄',
};
const place = (id: string) => ({ googlePlaceId: id, name: names[id], attributions: [] });
const ref = (id: string) => ({ id, googlePlaceId: id });

export function tripFixture() {
  const f = fixture(JSON.stringify(session));
  let created: TripCreation | undefined;
  let snapshot: SettingsSnapshot;
  let revision = 1;
  const id = 'new-trip';
  f.transport.mockImplementation(async (url, options) => {
    const { pathname, searchParams } = new URL(String(url));
    const method = options?.method ?? 'GET';
    if (pathname === '/api/trips' && method === 'GET') {
      return json({ trips: created ? [{ id, cityCode: created.cityCode, startDate: created.startDate, endDate: created.endDate }] : [] });
    }
    if (pathname === '/api/trips' && method === 'POST') {
      created = parseTripCreation(JSON.parse(String(options?.body)));
      if (!created.settings) throw new Error('초기 생활 설정이 필요합니다.');
      snapshot = { ...created, settings: created.settings, revision: String(revision),
        flights: created.flights.map(flight => ({ ...flight, bufferMinutes: flightBuffers[flight.direction] })), fixedVisits: [] };
      return json({ id }, 201);
    }
    if (pathname === '/api/city-profiles') return json({
      profile: { transitCoverage: '도쿄 철도망', transitHours: '05:00–23:00', taxiBaseFare: 500,
        taxiFarePerKm: 100, taxiFarePerMinute: 40, currency: 'JPY', callBufferMinutes: 8,
        source: 'https://travel.example/fares', updatedAt: '2026-11-19T00:00:00Z' },
      recommendedPolicy: 'WHEN_NEEDED',
    });
    if (pathname === '/api/places') {
      const byQuery: Record<string, string[]> = {
        공항: ['airport'], 호텔: ['hotel'], 미술관: ['museum'], 카페: ['cafe'], 도쿄: ['city'], '1-2-3': ['hotel'],
      };
      return json({ places: (byQuery[searchParams.get('query') ?? ''] ?? []).map(place), attribution: 'Google Maps' });
    }
    if (pathname === '/api/places/city') return json({ place: { coordinates: { latitude: 35.68, longitude: 139.76 } } });
    if (pathname.endsWith('/itinerary')) return json({ status: 'OK', inputHash: 'saved', itineraryId: 'new-route' });
    if (pathname.endsWith('/settings')) {
      if (method === 'PUT') {
        const body = JSON.parse(String(options?.body));
        if (body.revision !== snapshot.revision) return json({ code: 'STALE_INPUT', error: '다시 불러와 주세요.' }, 409);
        snapshot = { ...snapshot, settings: body.settings, revision: String(++revision) };
      }
      return json({ snapshot, calculation: calculateSettings(snapshot, snapshot.settings) });
    }
    if (pathname.endsWith('/constraints') && created) {
      return json({ revision: snapshot.revision,
        input: { ...created,
          visits: created.visits.map(visit => ({ ...visit, place: ref(visit.googlePlaceId) })),
          flights: created.flights.map(flight => ({ ...flight, airport: ref(flight.googlePlaceId) })),
          lodgings: created.lodgings.map(lodging => ({ ...lodging, place: ref(lodging.googlePlaceId) })),
        }, places: Object.fromEntries(Object.keys(names).map(id => [id, place(id)])),
      });
    }
    return json({ code: 'NOT_FOUND', error: '요청을 찾을 수 없어요.' }, 404);
  });
  return { ...f, created: () => created };
}

export async function renderTripApp(f: ReturnType<typeof tripFixture>, initialUrl = '/trips/new') {
  return renderRouter({
    _layout: () => <AuthProvider runtime={f.runtime}><RootNavigator /></AuthProvider>,
    login: Login, '(app)/index': Home, '(app)/trips/new': NewTrip, '(app)/trips/[id]/index': SavedTrip,
    '(app)/trips/[id]/settings': Settings, '(app)/trips/[id]/generate': Generate,
  }, { initialUrl });
}

export const write = (label: string, value: string) => fireEvent.changeText(screen.getByLabelText(label), value);
export const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));

export async function search(label: string, query: string) {
  await write(label, query);
  await fireEvent(screen.getByLabelText(label), 'submitEditing');
}

export async function fillTrip() {
  await fireEvent.press(await screen.findByRole('button', { name: '도쿄' }));
  await write('시작일', '2026-12-01');
  await write('종료일', '2026-12-03');
  await search('도착 공항 검색', '공항');
  await fireEvent.press(await screen.findByRole('button', { name: '나리타 공항' }));
  await write('도착 현지 시각', '08:00');
  await search('출발 공항 검색', '공항');
  await fireEvent.press(await screen.findByRole('button', { name: '나리타 공항' }));
  await write('출발 현지 시각', '21:00');
  await press('숙소 추가');
  await search('숙소 1 검색', '호텔');
  await fireEvent.press(await screen.findByRole('button', { name: '도쿄 호텔' }));
}
