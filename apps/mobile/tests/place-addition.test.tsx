import { act, fireEvent, screen, within } from 'expo-router/testing-library';
import { generationKeys, deferred, json } from './helpers';
import { fillTrip, press, renderTripApp, search, tripFixture, write } from './trip-input-fixture';

jest.mock('react-native-maps', () => ({
  __esModule: true, default: jest.requireActual<typeof import('react-native')>('react-native').View, PROVIDER_GOOGLE: 'google',
}));

test('2-2, 2-3 and 2-5: empty list, searchable pending state and clearing an empty search', async () => {
  const f = tripFixture();
  await renderTripApp(f);
  await fillTrip();
  await press('장소 추가하기');
  expect(screen.getByText('추가한 장소가 없어요')).toBeVisible();
  const delayed = deferred<Response>();
  f.transport.mockReturnValueOnce(delayed.promise);
  await search('장소 검색', '없는 곳');
  expect(screen.getByRole('progressbar', { name: '검색 중' })).toBeVisible();
  await act(async () => { delayed.resolve(json({ places: [], attribution: 'Google Maps' })); });
  expect(await screen.findByText('검색 결과가 없어요')).toBeVisible();
  await press('검색어 지우기');
  expect(screen.getByLabelText('장소 검색')).toHaveDisplayValue('');
  expect(screen.queryByText('검색 결과가 없어요')).toBeNull();
});

test('2-1, 2-4 and 2-6: list counts, duplicate toast, fixed condition error, editing and deletion', async () => {
  const f = tripFixture();
  await renderTripApp(f);
  await fillTrip();
  await press('장소 추가하기');
  await search('장소 검색', '미술관');
  await fireEvent.press(await screen.findByRole('button', { name: '도쿄 미술관 추가' }));
  await fireEvent(screen.getByLabelText('시각 고정'), 'valueChange', true);
  await write('고정 시각', '13:00');
  await press('저장');
  expect(screen.getByRole('alert')).toHaveTextContent(/고정 시각에는 날짜/);
  await fireEvent(screen.getByLabelText('날짜 고정'), 'valueChange', true);
  await press('2026-12-02');
  await fireEvent(screen.getByLabelText('순서 고정'), 'valueChange', true);
  await write('고정 순서 (1부터)', '1');
  await press('+15분');
  await press('저장');
  expect(screen.getByText('명소 · 75분')).toBeVisible();
  expect(screen.getByText(/고정 · 2026-12-02 13:00 · 1번째/)).toBeVisible();
  await press('추가됨');
  expect(screen.getByText('✓ 이미 추가한 장소예요')).toBeVisible();
  await press('닫기');
  await press('도쿄 미술관 설정');
  await press('☆ 희망 · 지도에만 표시');
  await press('식당');
  await press('저장');
  expect(screen.getByText('필수 0곳 · 희망 1곳')).toBeVisible();
  expect(screen.queryByText(/고정 · 2026-12-02/)).toBeNull();
  await press('명소 0');
  expect(screen.getByText('이 유형으로 추가한 장소가 없어요')).toBeVisible();
  await press('식당 1');
  await press('도쿄 미술관 설정');
  await press('삭제');
  expect(screen.getByText('추가한 장소가 없어요')).toBeVisible();
});

test('input → save → reopen: trip, lodging, fixed place and settings round trip over authenticated HTTP', async () => {
  const f = tripFixture();
  await renderTripApp(f, '/');
  await fireEvent.press(await screen.findByRole('button', { name: '여행 만들기' }));
  await fillTrip();
  await press('선호');
  await press('2026-12-02 수정');
  await write('이날 외출 시각', '10:00');
  await fireEvent.press(within(screen.getByTestId('form-sheet')).getByRole('button', { name: '0끼' }));
  await press('저장');
  await press('장소 추가하기');
  await search('장소 검색', '미술관');
  await fireEvent.press(await screen.findByRole('button', { name: '도쿄 미술관 추가' }));
  await fireEvent(screen.getByLabelText('날짜 고정'), 'valueChange', true);
  await press('2026-12-02');
  await press('+15분');
  await press('저장');
  await press('동선 만들기');
  expect(await screen.findByRole('header', { name: '도쿄' })).toBeVisible();
  await press('2일 12.2');
  expect(screen.getByRole('button', { name: '1번 도쿄 미술관, 11:00부터 12:15까지', selected: true })).toBeVisible();
  expect(screen.getByText('🔒 날짜 고정')).toBeVisible();
  expect(f.created()).toMatchObject({
    cityCode: 'TOKYO', timeZone: 'Asia/Tokyo', taxiPolicy: 'PREFER',
    flights: [{ googlePlaceId: 'airport', localDateTime: '2026-12-01T08:00' }, { googlePlaceId: 'airport' }],
    lodgings: [{ googlePlaceId: 'hotel', checkIn: '2026-12-01', checkOut: '2026-12-03' }],
    visits: [{ googlePlaceId: 'museum', fixedDate: '2026-12-02', minutes: 75 }],
    settings: { taxiPolicy: 'PREFER', days: [{ date: '2026-12-02', departureTime: '10:00', mealSlots: [] }] },
  });
  expect(f.created()?.visits[0]).not.toHaveProperty('place');
  await press('뒤로');
  expect(await screen.findByText(/도쿄 호텔 · 2026-12-01/)).toBeVisible();
  expect(screen.getByText(/고정 · 2026-12-02/)).toBeVisible();
  await press('뒤로');
  await fireEvent.press(await screen.findByRole('button', { name: '도쿄 · 2026-12-01–2026-12-03' }));
  expect(await screen.findByText('명소 · 75분')).toBeVisible();
  await press('하루 생활 수정');
  expect(await screen.findByText('10:00–21:00 · 0끼')).toBeVisible();
  expect(screen.getByRole('button', { name: '선호', selected: true })).toBeVisible();
  await write('기본 귀가 시각', '22:00');
  await press('설정 저장');
  expect(await screen.findByText('✓ 생활 설정을 저장했어요')).toBeVisible();
  expect(await screen.findByText('✓ 이동시간과 영업시간까지 검증했어요')).toBeVisible();
  await press('뒤로');
  await fireEvent.press(await screen.findByRole('button', { name: '하루 생활 수정' }));
  expect(await screen.findByText('10:00–22:00 · 0끼')).toBeVisible();
  expect(screen.getByLabelText('기본 귀가 시각')).toHaveDisplayValue('22:00');
  expect(f.transport.mock.calls.filter(([url]) => String(url).includes('/api/')).every(([, options]) =>
    new Headers(options?.headers).has('Authorization'))).toBe(true);
});

test('retrying itinerary generation reuses the saved trip after a provider failure', async () => {
  const f = tripFixture();
  const transport = f.transport.getMockImplementation()!;
  f.transport.mockImplementation(async (url, options) => {
    if (String(url).endsWith('/itinerary')) {
      f.transport.mockImplementation(transport);
      return json({ code: 'PROVIDER_UNAVAILABLE', error: '이동 정보를 불러오지 못했어요.' }, 503);
    }
    return transport(url, options);
  });
  await renderTripApp(f);
  await fillTrip();
  await press('장소 추가하기');
  await search('장소 검색', '미술관');
  await fireEvent.press(await screen.findByRole('button', { name: '도쿄 미술관 추가' }));
  await press('저장');
  await press('동선 만들기');
  expect(await screen.findByText('입력한 장소와 고정 조건은 그대로 있어요')).toBeVisible();
  await press('다시 계산');
  expect(await screen.findByRole('header', { name: '도쿄' })).toBeVisible();
  expect(screen.getByText('배치된 장소 없음')).toBeVisible();
  const writes = f.transport.mock.calls.filter(([, options]) => options?.method === 'POST').map(([url]) => new URL(String(url)).pathname);
  expect(writes).toEqual(['/api/trips', '/api/trips/new-trip/itinerary', '/api/trips/new-trip/itinerary']);
  const [initial, retry] = generationKeys(f);
  expect(retry).toBe(initial);
  await press('뒤로');
  await fireEvent.press(await screen.findByRole('button', { name: '동선 만들기' }));
  expect(await screen.findByRole('header', { name: '도쿄' })).toBeVisible();
  const keys = generationKeys(f);
  expect(keys).toHaveLength(3);
  expect(keys[2]).not.toBe(initial);
});
