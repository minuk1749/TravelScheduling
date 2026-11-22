import { renderRouter, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';
import type { LegComparison, TripInputs } from '@travel/core/contracts/itinerary';
import { parseConstraints } from '@travel/core/contracts/results/input';
import type { ResultView } from '@travel/core/contracts/results/model';
import type { SavedRouteShapesResponse } from '@travel/core/contracts/route-shapes';
import Generate from '../app/(app)/trips/[id]/generate';
import type { GeneratedTrip } from '../src/api/trips';
import { AuthProvider } from '../src/auth/provider';
import { MapAdapterProvider } from '../src/map/provider';
import { RootNavigator } from '../src/navigation/root-navigator';
import { FakeResultMap } from './fake-result-map';
import { fixture, json, session } from './helpers';

export const [D1, D2, D3] = ['2026-12-03', '2026-12-04', '2026-12-05'];
export const REVISION = 'a'.repeat(64);
export const ITINERARY_A = '468dbb8e-0da8-48ef-92db-98618031e476';
const names = {
  airport: '하네다 공항', hotel: '도쿄 호텔', museum: '도쿄 국립박물관', market: '아메요코 시장',
  shrine: '메이지 신궁', cafe: '아사쿠사 카페',
} as const;
type Name = keyof typeof names;
const points: Record<Name, [number, number]> = {
  airport: [35.5494, 139.7798], hotel: [35.6812, 139.7671], museum: [35.7156, 139.7745],
  market: [35.7101, 139.7748], shrine: [35.6764, 139.6993], cafe: [35.7148, 139.7967],
};
export const place = (id: Name) => `place-${id}`;
const ref = (id: Name) => ({ id: place(id), googlePlaceId: `google-${id}` });
const visit = (id: Name, minutes: number, extra: Partial<TripInputs['visits'][number]> = {}): TripInputs['visits'][number] =>
  ({ id, place: ref(id), kind: 'ATTRACTION', minutes, priority: 'REQUIRED', ...extra });

export const view: ResultView = {
  revision: REVISION,
  places: Object.fromEntries((Object.keys(names) as Name[]).map(id => [place(id), {
    googlePlaceId: `google-${id}`, name: names[id], attributions: [],
    coordinates: { latitude: points[id][0], longitude: points[id][1] },
  }])),
  input: {
    id: 'trip', cityCode: 'TOKYO', timeZone: 'Asia/Tokyo', startDate: D1, endDate: D3,
    activity: { start: '09:00', end: '21:00' }, mealSlots: ['LUNCH'],
    mealWindows: { BREAKFAST: { start: '07:00', end: '09:00' }, LUNCH: { start: '11:30', end: '14:00' }, DINNER: { start: '17:30', end: '20:00' } },
    taxiPolicy: 'WHEN_NEEDED', luggageOption: 'VIA_LODGING', arrivalBufferMinutes: 90, departureBufferMinutes: 150,
    daySettings: [], legModes: [],
    flights: [{ direction: 'ARRIVAL', airport: ref('airport'), localDateTime: `${D1}T08:00` }],
    lodgings: [{ place: ref('hotel'), checkIn: D1, checkOut: D3 }],
    visits: [visit('museum', 60, { fixedDate: D1, fixedTime: '11:00' }), visit('market', 45), visit('shrine', 50),
      visit('cafe', 40, { kind: 'RESTAURANT', priority: 'WISH' })],
  },
};

/** Local Tokyo wall time on a date → UTC instant. */
export const at = (date: string, time: string) => new Date(`${date}T${time}:00+09:00`).toISOString().replace('.000Z', 'Z');
const estimate = (minutes: number, fare: number | null) => ({ minutes, fare });
type Alternatives = LegComparison['alternatives'];
function leg(date: string, kind: 'DAY' | 'AIRPORT', from: Name, to: Name, departure: string, mode: 'TRANSIT' | 'TAXI' | 'WALK',
  minutes: number, fare: number | null, alternatives: Alternatives, fixed = false): LegComparison {
  return { date, kind, from: place(from), to: place(to), departure: at(date, departure),
    selected: { mode, minutes, fare, fixed }, baseline: { mode: 'TRANSIT', minutes, fare }, alternatives };
}
const stop = (date: string, id: Name, start: string, end: string) =>
  ({ kind: 'VISIT' as const, visitId: id, start: at(date, start), end: at(date, end) });
const scheduleLeg = (comparison: LegComparison) => ({
  from: comparison.from, to: comparison.to, mode: comparison.selected.mode, fixed: comparison.selected.fixed,
  fare: comparison.selected.fare, start: comparison.departure,
  end: new Date(Date.parse(comparison.departure) + comparison.selected.minutes * 60_000).toISOString(),
});

export type Plan = { comparisons: LegComparison[]; stops: Record<string, ReturnType<typeof stop | typeof meal>[]> };
const meal = (date: string, start: string, end: string) => ({ kind: 'MEAL' as const, slot: 'LUNCH' as const, start: at(date, start), end: at(date, end) });

/** Day 1: airport → hotel → museum (fixed 11:00) → lunch → market → hotel. Day 2: shrine without taxi or fare. Day 3 empty. */
export function plan(options: { museumLeg?: 'TRANSIT' | 'TAXI'; marketStart?: string; cafeOnDay3?: boolean } = {}): Plan {
  const taxi = options.museumLeg === 'TAXI';
  const [marketStart, marketEnd] = options.marketStart === '13:10' ? ['13:10', '13:55'] : ['13:20', '14:05'];
  const comparisons = [
    leg(D1, 'AIRPORT', 'airport', 'hotel', '08:30', 'TRANSIT', 40, 500, { TRANSIT: estimate(40, 500), TAXI: estimate(35, 9000) }),
    leg(D1, 'DAY', 'hotel', 'museum', '10:30', taxi ? 'TAXI' : 'TRANSIT', taxi ? 14 : 25, taxi ? 2300 : 240,
      { TRANSIT: estimate(25, 240), TAXI: estimate(14, 2300) }, taxi),
    leg(D1, 'DAY', 'museum', 'market', '13:00', 'TAXI', marketStart === '13:10' ? 10 : 20, 3100, { TRANSIT: estimate(30, 200), TAXI: estimate(20, 3100) }),
    leg(D1, 'DAY', 'market', 'hotel', marketEnd, 'WALK', 30, 0, { WALK: estimate(30, 0), TRANSIT: estimate(20, 180) }),
    leg(D2, 'DAY', 'hotel', 'shrine', '09:00', 'TRANSIT', 30, null, { TRANSIT: estimate(30, null) }),
    leg(D2, 'DAY', 'shrine', 'hotel', '10:20', 'TRANSIT', 30, 200, { TRANSIT: estimate(30, 200) }),
    ...(options.cafeOnDay3 ? [leg(D3, 'DAY', 'hotel', 'cafe', '10:00', 'TRANSIT', 20, 180, { TRANSIT: estimate(20, 180) }),
      leg(D3, 'DAY', 'cafe', 'hotel', '11:00', 'TRANSIT', 20, 180, { TRANSIT: estimate(20, 180) })] : []),
  ];
  return { comparisons, stops: {
    [D1]: [stop(D1, 'museum', '11:00', '12:00'), meal(D1, '12:00', '13:00'), stop(D1, 'market', marketStart, marketEnd)],
    [D2]: [stop(D2, 'shrine', '09:30', '10:20')],
    [D3]: options.cafeOnDay3 ? [stop(D3, 'cafe', '10:20', '11:00')] : [],
  } };
}

export function trip(inputHash: string, { comparisons, stops }: Plan = plan()): GeneratedTrip {
  const days = [D1, D2, D3].map(date => ({ date, timeZone: 'Asia/Tokyo', stops: stops[date],
    legs: comparisons.filter(row => row.date === date && row.kind === 'DAY').map(scheduleLeg) }));
  const schedule = { days, unplaced: [], issues: [] };
  return {
    itineraryId: ITINERARY_A, inputHash, status: 'OK', verification: { verified: true, attempts: 2 },
    transferIssues: [], flightConflicts: [], skippedMeals: [], comparisons,
    efficiency: { currency: 'JPY', transitMinutes: 205, selectedMinutes: 175, transitFare: 1340, selectedFare: 4040 },
    capacity: { status: 'OK', unplaced: [], issues: [], recommendation: { requiredCount: 3, requiredVisitIds: ['museum', 'market', 'shrine'], schedule },
      time: { availableMinutes: 1800, visitMinutes: 155, mealMinutes: 60, travelMinutesLowerBound: 100, requiredMinutesLowerBound: 315 } },
  };
}

export function conflictTrip(inputHash: string): GeneratedTrip {
  const base = trip(inputHash);
  return { ...base, status: 'CONFLICT', comparisons: [], efficiency: null,
    capacity: { ...base.capacity, status: 'CONFLICT', recommendation: null,
      unplaced: [{ visitId: 'market', reason: 'FIXED_ORDER', fixed: true }],
      issues: [{ date: D1, reason: 'UNREACHABLE', from: place('museum'), to: place('market') }] } };
}

/** Polyline of two points near the hotel and museum (Google sample encoding). */
export const ROAD = '_p~iF~ps|U_ulLnnqC';

export function resultFixture(initial: ResultView = view) {
  const f = fixture(JSON.stringify(session));
  let current = initial;
  let revision = 0;
  const generate = jest.fn<Promise<Response>, []>().mockImplementation(async () => json(trip(current.revision)));
  const save = jest.fn<Promise<Response>, [RequestInit]>().mockImplementation(async options => {
    const body = JSON.parse(String(options.body));
    if (body.revision !== current.revision) return json({ code: 'STALE_INPUT', error: '저장된 설정을 다시 불러와 주세요.' }, 409);
    const parsed = parseConstraints(body.constraints, current.input);
    const edits = new Map(parsed.visits.map(row => [row.id, row]));
    const visits = current.input.visits.map(row => {
      const edit = edits.get(row.id)!;
      return { ...row, priority: edit.priority, fixedDate: edit.fixedDate ?? undefined,
        fixedTime: edit.fixedTime ?? undefined, fixedOrder: edit.fixedOrder ?? undefined };
    });
    current = { ...current, revision: String(++revision).padStart(64, 'b'), input: { ...current.input, visits, legModes: parsed.legModes } };
    return json({ input: current.input, revision: current.revision });
  });
  const read = jest.fn(() => json(current));
  const shapes = jest.fn<Promise<Response>, [URL]>().mockImplementation(async () => json({
    inputHash: current.revision, itineraryId: ITINERARY_A,
    legs: trip(current.revision).comparisons.map(row => ({ date: row.date, kind: row.kind, from: row.from, to: row.to,
      mode: row.selected.mode, shape: row.from === place('hotel') && row.to === place('museum')
        ? { status: 'OK', encodedPolyline: ROAD } : { status: 'NONE' } })),
  } satisfies SavedRouteShapesResponse));
  f.transport.mockImplementation(async (input, options = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/trips/trip/itinerary' && options.method === 'POST') return generate();
    if (url.pathname === '/api/trips/trip/itinerary/shapes') return shapes(url);
    if (url.pathname === '/api/trips/trip/constraints') return options.method === 'PUT' ? save(options) : read();
    return json({ code: 'NOT_FOUND', error: '요청을 찾을 수 없어요.' }, 404);
  });
  return { ...f, generate, save, read, shapes, current: () => current };
}

export async function openResult(f: ReturnType<typeof resultFixture>) {
  await renderRouter({
    _layout: () => <AuthProvider runtime={f.runtime}><MapAdapterProvider map={FakeResultMap}><RootNavigator /></MapAdapterProvider></AuthProvider>,
    login: () => null, '(app)/index': () => null, '(app)/trips/[id]/index': () => <Text>저장한 여행</Text>,
    '(app)/trips/[id]/settings': () => <Text>하루 생활</Text>, '(app)/trips/[id]/generate': Generate,
  }, { initialUrl: '/trips/trip/generate' });
  await screen.findByTestId('place-panel');
}

/** Drawn routes as "order mode line emphasis color pathKind", keyed by route ID. */
export function routes(): Record<string, string> {
  return Object.fromEntries(screen.queryAllByTestId(/^route-/).map(node =>
    [String(node.props.testID).slice('route-'.length), [node.props.children].flat().join('')]));
}
export const legId = (date: string, from: Name, to: Name, kind = 'DAY') => [date, kind, place(from), place(to)].join('|');
