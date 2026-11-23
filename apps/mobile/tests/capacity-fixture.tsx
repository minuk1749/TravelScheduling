import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';
import type { TripInputs } from '@travel/core/contracts/itinerary';
import { parseConstraints } from '@travel/core/contracts/results/input';
import type { ResultView } from '@travel/core/contracts/results/model';
import { calculateSettings } from '@travel/core/contracts/settings/calculate';
import { defaultLivingSettings } from '@travel/core/contracts/settings/defaults';
import type { SettingsSnapshot } from '@travel/core/contracts/settings/model';
import Generate from '../app/(app)/trips/[id]/generate';
import Settings from '../app/(app)/trips/[id]/settings';
import type { GeneratedTrip } from '../src/api/trips';
import { AuthProvider } from '../src/auth/provider';
import { MapAdapterProvider } from '../src/map/provider';
import { RootNavigator } from '../src/navigation/root-navigator';
import { FakeResultMap } from './fake-result-map';
import { fixture, json, session } from './helpers';

const day = '2026-12-01';
const ref = (id: string) => ({ id: `place-${id}`, googlePlaceId: `google-${id}` });
const visit = (id: string): TripInputs['visits'][number] => ({
  id, place: ref(id), kind: id === 'cafe' ? 'RESTAURANT' : 'ATTRACTION', minutes: 60,
  priority: id === 'cafe' ? 'WISH' : 'REQUIRED',
});
const visitNames = { museum: '도쿄 미술관', shrine: '사찰', coast: '해변', cafe: '카페' };
const settingsSnapshot: SettingsSnapshot = {
  revision: 'settings-current', startDate: day, endDate: day, timeZone: 'Asia/Tokyo',
  settings: defaultLivingSettings('WHEN_NEEDED'), flights: [],
  fixedVisits: [{ id: 'museum', date: day, time: '11:00', order: 0, minutes: 60 }],
};
export const initialView: ResultView = {
  revision: 'original',
  places: Object.fromEntries(Object.entries(visitNames).map(([id, name]) => [ref(id).id, {
    googlePlaceId: ref(id).googlePlaceId, name, coordinates: { latitude: 35.68, longitude: 139.76 }, attributions: [],
  }])),
  input: {
    id: 'trip', cityCode: 'TOKYO', startDate: day, endDate: day, timeZone: 'Asia/Tokyo',
    activity: { start: '09:00', end: '18:00' }, arrivalBufferMinutes: 90, departureBufferMinutes: 120,
    mealSlots: [], mealWindows: settingsSnapshot.settings.mealWindows, taxiPolicy: 'WHEN_NEEDED',
    luggageOption: 'DIRECT_TO_AIRPORT', daySettings: [], flights: [], lodgings: [],
    legModes: [{ date: day, from: ref('shrine').id, to: ref('museum').id, mode: 'WALK' }],
    visits: [{ ...visit('museum'), fixedDate: day, fixedTime: '11:00', fixedOrder: 0 }, visit('shrine'), visit('coast'), visit('cafe')],
  },
};

const base = {
  itineraryId: 'itinerary', verification: { verified: true, attempts: 2 },
  transferIssues: [], flightConflicts: [], skippedMeals: [], comparisons: [], efficiency: null,
};
const time = {
  availableMinutes: 180, visitMinutes: 180, mealMinutes: 0,
  travelMinutesLowerBound: 30, requiredMinutesLowerBound: 210,
};
const schedule = {
  days: [{ date: day, timeZone: 'Asia/Tokyo', legs: [], stops: [
    { kind: 'VISIT' as const, visitId: 'museum', start: `${day}T02:00:00Z`, end: `${day}T03:00:00Z` },
    { kind: 'VISIT' as const, visitId: 'shrine', start: `${day}T03:30:00Z`, end: `${day}T04:30:00Z` },
  ] }], issues: [], unplaced: [],
};
export const excess = {
  ...base, status: 'OVER_CAPACITY', inputHash: 'original',
  capacity: { status: 'OVER_CAPACITY', time, issues: [],
    unplaced: [{ visitId: 'coast', fixed: false, reason: 'TIME_WINDOW' }],
    recommendation: { requiredCount: 2, requiredVisitIds: ['museum', 'shrine'], schedule },
  },
} satisfies GeneratedTrip;
export const success = {
  ...base, status: 'OK', inputHash: 'saved',
  capacity: { status: 'OK', time, issues: [], unplaced: [], recommendation: excess.capacity.recommendation },
} satisfies GeneratedTrip;
export const conflict = {
  ...base, status: 'CONFLICT', inputHash: 'saved',
  capacity: { status: 'CONFLICT', time, recommendation: null,
    unplaced: [{ visitId: 'coast', fixed: false, reason: 'UNREACHABLE' }],
    issues: [{ date: day, reason: 'UNREACHABLE', from: ref('museum').id, to: ref('coast').id }],
  },
} satisfies GeneratedTrip;

export function capacityFixture() {
  const f = fixture(JSON.stringify(session));
  let current = initialView;
  const generate = jest.fn<Promise<Response>, []>().mockImplementation(() => Promise.resolve(json({ ...excess, inputHash: current.revision })));
  const save = jest.fn<Promise<Response>, [RequestInit]>().mockImplementation(async options => {
    const { revision, constraints } = JSON.parse(String(options.body));
    if (revision !== current.revision) return json({ code: 'STALE_INPUT', error: '저장된 설정을 다시 불러와 주세요.' }, 409);
    const parsed = parseConstraints(constraints, current.input);
    const byId = new Map(parsed.visits.map(row => [row.id, row]));
    const visits = current.input.visits.map(row => {
      const edit = byId.get(row.id)!;
      return { ...row, priority: edit.priority, fixedDate: edit.fixedDate ?? undefined,
        fixedTime: edit.fixedTime ?? undefined, fixedOrder: edit.fixedOrder ?? undefined };
    });
    current = { ...current, revision: 'saved', input: { ...current.input, visits, legModes: parsed.legModes } };
    return json({ input: current.input, revision: current.revision });
  });
  const read = jest.fn(() => json(current));
  const settings = jest.fn((options: RequestInit) => {
    const snapshot = options.method === 'PUT' ? { ...settingsSnapshot, revision: 'settings-saved',
      settings: JSON.parse(String(options.body)).settings } : settingsSnapshot;
    return json({ snapshot, calculation: calculateSettings(snapshot, snapshot.settings) });
  });
  f.transport.mockImplementation(async (url, options = {}) => {
    const { pathname, searchParams } = new URL(String(url));
    if (pathname === '/api/trips/trip/itinerary' && options.method === 'POST') return generate();
    if (pathname === '/api/trips/trip/constraints' && !options.method && searchParams.get('fields') === 'revision') return json({ revision: current.revision });
    if (pathname === '/api/trips/trip/constraints') return options.method === 'PUT' ? save(options) : read();
    if (pathname === '/api/trips/trip/settings') return settings(options);
    return json({ code: 'NOT_FOUND', error: '요청을 찾을 수 없어요.' }, 404);
  });
  return { ...f, generate, save, read, settings, current: () => current };
}

export async function openCapacity(f: ReturnType<typeof capacityFixture>, section = 'generate') {
  await renderRouter({
    _layout: () => <AuthProvider runtime={f.runtime}><MapAdapterProvider map={FakeResultMap}><RootNavigator /></MapAdapterProvider></AuthProvider>,
    login: () => null, '(app)/index': () => null, '(app)/trips/[id]/index': () => <Text>저장한 여행</Text>,
    '(app)/trips/[id]/generate': Generate, '(app)/trips/[id]/settings': Settings,
  }, { initialUrl: `/trips/trip/${section}` });
}

export const button = (name: string) => screen.getByRole('button', { name });
export const press = (name: string) => fireEvent.press(button(name));
export const checkbox = (name: string) => screen.getByRole('checkbox', { name: `${name} 필수` });
export const toggle = (name: string) => fireEvent.press(checkbox(name));
