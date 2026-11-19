import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { calculateSettings } from '@travel/core/contracts/settings/calculate';
import { defaultLivingSettings } from '@travel/core/contracts/settings/defaults';
import type { SettingsSnapshot, SettingsView } from '@travel/core/contracts/settings/model';
import Settings from '../app/(app)/trips/[id]/settings';
import type { GeneratedTrip } from '../src/api/trips';
import { AuthProvider } from '../src/auth/provider';
import { RootNavigator } from '../src/navigation/root-navigator';
import { deferred, fixture, json, session } from './helpers';

const snapshot: SettingsSnapshot = {
  revision: 'current', timeZone: 'Asia/Tokyo', startDate: '2026-12-01', endDate: '2026-12-03',
  settings: defaultLivingSettings('WHEN_NEEDED'), flights: [],
  fixedVisits: [{ id: 'museum', date: '2026-12-02', time: '11:00', order: null, minutes: 60 }],
};
const savedSnapshot = { ...snapshot, revision: 'updated', settings: { ...snapshot.settings, departureTime: '10:00' } };
const settingsView = (value: SettingsSnapshot): SettingsView => ({
  snapshot: value, calculation: calculateSettings(value, value.settings),
});

const resultBase = {
  itineraryId: 'route', inputHash: 'hash', verification: { verified: true, attempts: 1 },
  transferIssues: [], flightConflicts: [], skippedMeals: [], comparisons: [], efficiency: null,
};
const time = {
  availableMinutes: 1980, visitMinutes: 60, mealMinutes: 360,
  travelMinutesLowerBound: null, requiredMinutesLowerBound: null,
};
const conflict = {
  ...resultBase, status: 'CONFLICT',
  capacity: {
    status: 'CONFLICT', time, recommendation: null, issues: [],
    unplaced: [{ visitId: 'museum', fixed: true, reason: 'UNREACHABLE' }],
  },
} satisfies GeneratedTrip;
const success = {
  ...resultBase, status: 'OK',
  capacity: {
    status: 'OK', time: { ...time, travelMinutesLowerBound: 30, requiredMinutesLowerBound: 450 },
    issues: [], unplaced: [], recommendation: {
      requiredCount: 1, requiredVisitIds: ['museum'], schedule: { days: [], issues: [], unplaced: [] },
    },
  },
} satisfies GeneratedTrip;

function settingsFixture() {
  const f = fixture(JSON.stringify(session));
  const put = jest.fn<Promise<Response>, [RequestInit]>();
  const generate = jest.fn<Promise<Response>, []>();
  const path = '/api/trips/saved-trip';
  f.transport.mockImplementation(async (url, options = {}) => {
    const { pathname } = new URL(String(url));
    if (pathname === `${path}/settings`) {
      if (options.method === 'PUT') return put(options);
      if (!options.method) return json(settingsView(snapshot));
    }
    if (pathname === `${path}/itinerary` && options.method === 'POST') return generate();
    return json({ code: 'NOT_FOUND', error: '요청을 찾을 수 없어요.' }, 404);
  });
  return { ...f, put, generate };
}

async function changeSettings(f: ReturnType<typeof settingsFixture>) {
  await renderRouter({
    _layout: () => <AuthProvider runtime={f.runtime}><RootNavigator /></AuthProvider>,
    login: () => null, '(app)/trips/[id]/settings': Settings,
  }, { initialUrl: '/trips/saved-trip/settings' });
  await fireEvent.changeText(await screen.findByLabelText('기본 외출 시각'), '10:00');
  await fireEvent.press(screen.getByRole('button', { name: '설정 저장' }));
}

test('waits for settings to save and shows the conflict from full revalidation', async () => {
  const f = settingsFixture();
  const save = deferred<Response>();
  const calculation = deferred<Response>();
  f.put.mockReturnValue(save.promise);
  f.generate.mockReturnValue(calculation.promise);
  await changeSettings(f);
  expect(await screen.findByRole('button', { name: '저장 중', busy: true })).toBeDisabled();
  expect(f.put).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(f.put.mock.calls[0][0].body))).toEqual({
    revision: snapshot.revision, settings: savedSnapshot.settings,
  });
  expect(f.generate).not.toHaveBeenCalled();

  await act(async () => { save.resolve(json(settingsView(savedSnapshot))); });
  expect(await screen.findByText('✓ 생활 설정을 저장했어요')).toBeVisible();
  expect(screen.getByRole('button', { name: '전체 동선 재계산 중', busy: true })).toBeDisabled();
  expect(f.generate).toHaveBeenCalledTimes(1);

  await act(async () => { calculation.resolve(json(conflict)); });
  expect(await screen.findByText(/고정 항목이나 이동 조건이 충돌해요/)).toBeVisible();
  expect(screen.getByText(/이동 불가/)).toBeVisible();
  expect(screen.queryByRole('button', { name: '전체 동선 다시 계산' })).toBeNull();
});

test('keeps the saved settings and retries only calculation after a provider failure', async () => {
  const f = settingsFixture();
  f.put.mockResolvedValueOnce(json(settingsView(savedSnapshot)));
  f.generate.mockResolvedValueOnce(json({ code: 'PROVIDER_UNAVAILABLE', error: '지도 서비스 연결에 실패했어요.' }, 503))
    .mockResolvedValueOnce(json(success));
  await changeSettings(f);
  expect(await screen.findByText(/전체 동선을 재계산하지 못했어요.*지도 서비스 연결에 실패했어요/)).toBeVisible();
  expect(screen.getByText('✓ 생활 설정을 저장했어요')).toBeVisible();
  expect(screen.getByLabelText('기본 외출 시각')).toHaveDisplayValue('10:00');
  expect(screen.queryByRole('button', { name: '저장된 설정 다시 불러오기' })).toBeNull();

  await fireEvent.press(screen.getByRole('button', { name: '전체 동선 다시 계산' }));
  expect(await screen.findByText('✓ 이동시간과 영업시간까지 검증했어요')).toBeVisible();
  expect(screen.queryByText(/전체 동선을 재계산하지 못했어요/)).toBeNull();
  expect(screen.getByLabelText('기본 외출 시각')).toHaveDisplayValue('10:00');
  expect(f.put).toHaveBeenCalledTimes(1);
  expect(f.generate).toHaveBeenCalledTimes(2);
});

test('does not start calculation if the settings update is rejected', async () => {
  const f = settingsFixture();
  f.put.mockResolvedValueOnce(json({ code: 'STALE_INPUT', error: '저장된 설정을 다시 불러와 주세요.' }, 409));
  await changeSettings(f);
  expect(await screen.findByText(/저장된 설정을 다시 불러와 주세요/)).toBeVisible();
  expect(screen.getByRole('button', { name: '저장된 설정 다시 불러오기' })).toBeVisible();
  expect(screen.queryByText('✓ 생활 설정을 저장했어요')).toBeNull();
  expect(f.generate).not.toHaveBeenCalled();
});
