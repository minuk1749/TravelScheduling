import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { router } from 'expo-router';
import { calculateSettings } from '@travel/core/contracts/settings/calculate';
import { defaultLivingSettings } from '@travel/core/contracts/settings/defaults';
import type { SettingsSnapshot } from '@travel/core/contracts/settings/model';
import SavedTrip from '../app/(app)/trips/[id]/index';
import Generate from '../app/(app)/trips/[id]/generate';
import Settings from '../app/(app)/trips/[id]/settings';
import { AuthProvider } from '../src/auth/provider';
import { MapAdapterProvider } from '../src/map/provider';
import { RootNavigator } from '../src/navigation/root-navigator';
import { FakeResultMap } from './fake-result-map';
import { deferred, json } from './helpers';
import { conflictTrip, D1, D3, plan, resultFixture, trip, view } from './result-fixture';

const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const departure = () => screen.getByLabelText('기본 외출 시각');

function fixture() {
  const f = resultFixture();
  let current: SettingsSnapshot = { revision: view.revision, timeZone: view.input.timeZone, startDate: D1, endDate: D3,
    settings: defaultLivingSettings('WHEN_NEEDED'), flights: [], fixedVisits: [{ id: 'museum', date: D1, time: '11:00', order: null, minutes: 60 }] };
  const read = () => json({ snapshot: current, calculation: calculateSettings(current, current.settings) });
  const readSettings = jest.fn(read);
  const save = jest.fn<Promise<Response>, [RequestInit]>().mockImplementation(async options => {
    const body = JSON.parse(String(options.body));
    if (body.revision !== current.revision) return json({ code: 'STALE_INPUT', error: '저장 충돌' }, 409);
    current = { ...current, revision: `settings-${body.settings.departureTime}`, settings: body.settings };
    return read();
  });
  f.read.mockImplementation(() => json({ ...view, revision: current.revision, input: { ...view.input,
    activity: { start: current.settings.departureTime, end: current.settings.returnTime } } }));
  f.readRevision.mockImplementation(() => json({ revision: current.revision }));
  f.shapes.mockImplementation(async url => json({ inputHash: url.searchParams.get('inputHash'),
    itineraryId: url.searchParams.get('itineraryId'), legs: [] }));
  f.generate.mockImplementation(async () => {
    if (current.settings.departureTime === '13:00') {
      const result = conflictTrip(current.revision);
      result.capacity.unplaced = [{ visitId: 'museum', fixed: true, reason: 'TIME_WINDOW' }];
      result.capacity.issues = [];
      return json(result);
    }
    return json(trip(current.revision, plan({ marketStart: current.revision === view.revision ? '13:20' : '13:10' })));
  });
  const transport = f.transport.getMockImplementation()!;
  f.transport.mockImplementation((url, options = {}) => String(url).endsWith('/settings')
    ? options.method === 'PUT' ? save(options) : Promise.resolve(readSettings()) : transport(url, options));
  return { ...f, readSettings, saveSettings: save };
}

async function openTrip(f: ReturnType<typeof fixture>) {
  await renderRouter({
    _layout: () => <AuthProvider runtime={f.runtime}><MapAdapterProvider map={FakeResultMap}><RootNavigator /></MapAdapterProvider></AuthProvider>,
    login: () => null, '(app)/index': () => null, '(app)/trips/[id]/index': SavedTrip,
    '(app)/trips/[id]/generate': Generate, '(app)/trips/[id]/settings': Settings,
  }, { initialUrl: '/trips/trip' });
  await screen.findByRole('button', { name: '동선 만들기' });
}

test.each(['OK', 'CONFLICT'])('returning from the result to settings opens the saved calculation (%s) and backs out to the trip', async outcome => {
  const f = fixture();
  await openTrip(f);
  await press('동선 만들기');
  await screen.findByTestId('place-card-row');
  await press('여행 조건 수정');
  await fireEvent.changeText(await screen.findByLabelText('기본 외출 시각'), outcome === 'OK' ? '10:00' : '13:00');
  await press('설정 저장');
  expect(await screen.findByText('✓ 생활 설정을 저장했어요')).toBeVisible();
  expect(await screen.findByText(outcome === 'OK' ? /이동시간과 영업시간까지 검증/ : /고정 항목이나 이동 조건이 충돌/)).toBeVisible();
  const readsBeforeOpening = f.read.mock.calls.length;
  await press('동선 보기');
  expect(await screen.findByTestId('result-map')).toBeVisible();
  if (outcome === 'OK') {
    expect(await screen.findByRole('button', { name: '2번 아메요코 시장, 13:10부터 13:55까지' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '2번 아메요코 시장, 13:20부터 14:05까지' })).toBeNull();
  } else {
    expect(await screen.findByText('⚠ 고정 조건 충돌 1건')).toBeVisible();
    await press('도쿄 국립박물관 고정 수정');
    const sheet = within(screen.getByTestId('form-sheet'));
    expect(sheet.getByLabelText('고정 시각')).toHaveDisplayValue('11:00');
    await fireEvent.press(sheet.getByRole('button', { name: '취소' }));
  }
  expect(f.read).toHaveBeenCalledTimes(readsBeforeOpening + 1);
  expect(f.generate).toHaveBeenCalledTimes(2);
  await press('뒤로');
  expect(await screen.findByRole('button', { name: '동선 만들기' })).toBeVisible();
  expect(screen).toHavePathname('/trips/trip');
  expect(f.generate).toHaveBeenCalledTimes(2);
  expect(f.saveSettings).toHaveBeenCalledTimes(1);
});

test('a direct settings edit can stay on the form; a new draft drops its old result and reopening settings reads the saved input', async () => {
  const f = fixture();
  await openTrip(f);
  await press('하루 생활 수정');
  await fireEvent.changeText(await screen.findByLabelText('기본 외출 시각'), '10:00');
  await press('설정 저장');
  await screen.findByRole('button', { name: '동선 보기' });
  expect(f.generate).toHaveBeenCalledTimes(1);
  expect(departure()).toHaveDisplayValue('10:00');
  await fireEvent.changeText(departure(), '13:00');
  expect(screen.queryByRole('button', { name: '동선 보기' })).toBeNull();
  expect(screen.queryByText('✓ 생활 설정을 저장했어요')).toBeNull();
  f.generate.mockResolvedValueOnce(json({ code: 'PROVIDER_UNAVAILABLE', error: '경로 조회 실패' }, 503));
  await press('설정 저장');
  expect(await screen.findByText(/경로 조회 실패/)).toBeVisible();
  expect(screen.queryByRole('button', { name: '동선 보기' })).toBeNull();
  await press('전체 동선 다시 계산');
  await screen.findByRole('button', { name: '동선 보기' });
  await press('동선 보기');
  expect(await screen.findByText('⚠ 고정 조건 충돌 1건')).toBeVisible();
  await press('여행 조건 수정');
  expect(await screen.findByLabelText('기본 외출 시각')).toHaveDisplayValue('13:00');
  expect(screen.queryByRole('button', { name: '동선 보기' })).toBeNull();
  expect(f.readSettings).toHaveBeenCalledTimes(2);
  expect(f.saveSettings).toHaveBeenCalledTimes(2);
  expect(f.generate).toHaveBeenCalledTimes(3);
});

test.each(['save', 'calculation'])('leaving settings during the %s ignores a late response', async stage => {
  const f = fixture(), pending = deferred<Response>();
  if (stage === 'save') f.saveSettings.mockReturnValueOnce(pending.promise);
  else f.generate.mockReturnValueOnce(pending.promise);
  await openTrip(f);
  await press('하루 생활 수정');
  await fireEvent.changeText(await screen.findByLabelText('기본 외출 시각'), '10:00');
  await press('설정 저장');
  const expectedGenerations = stage === 'save' ? 0 : 1;
  await waitFor(() => expect(stage === 'save' ? f.saveSettings : f.generate).toHaveBeenCalledTimes(1));
  const endpoint = stage === 'save' ? '/settings' : '/itinerary';
  const request = f.transport.mock.calls.find(([url, options]) => String(url).endsWith(endpoint) && options?.method)?.[1];
  await act(async () => router.back());
  await screen.findByRole('button', { name: '동선 만들기' });
  expect(request?.signal?.aborted).toBe(true);
  await act(async () => pending.resolve(stage === 'save' ? f.readSettings() : json(trip(view.revision))));
  expect(screen).toHavePathname('/trips/trip');
  expect(screen.queryByTestId('result-map')).toBeNull();
  expect(f.saveSettings).toHaveBeenCalledTimes(1);
  expect(f.generate).toHaveBeenCalledTimes(expectedGenerations);
});

test('opening the saved result after another device edits the trip calculates once for the new input', async () => {
  const f = fixture();
  await openTrip(f);
  await press('하루 생활 수정');
  await fireEvent.changeText(await screen.findByLabelText('기본 외출 시각'), '10:00');
  await press('설정 저장');
  await screen.findByRole('button', { name: '동선 보기' });
  const revision = 'later-settings';
  f.read.mockReturnValueOnce(json({ ...view, revision, input: { ...view.input, activity: { start: '13:00', end: '18:00' } } }));
  f.generate.mockResolvedValueOnce(json(conflictTrip(revision)));
  await press('동선 보기');
  expect(await screen.findByText(/고정 조건 충돌/)).toBeVisible();
  expect(screen.queryByRole('button', { name: '2번 아메요코 시장, 13:10부터 13:55까지' })).toBeNull();
  expect(f.saveSettings).toHaveBeenCalledTimes(1);
  expect(f.generate).toHaveBeenCalledTimes(2);
});
