import { fireEvent, screen, within } from 'expo-router/testing-library';
import { fillTrip, press, renderTripApp, search, tripFixture, write } from './trip-input-fixture';

jest.mock('react-native-maps', () => ({
  __esModule: true, default: jest.requireActual<typeof import('react-native')>('react-native').View, PROVIDER_GOOGLE: 'google',
}));

test('1-2 and 1-3: empty form, missing fields and invalid dates and times block progress and clear on correction', async () => {
  const f = tripFixture();
  await renderTripApp(f);
  expect(await screen.findByText(/확인할 항목 \d+개/)).toBeVisible();
  expect(screen.getByLabelText('시작일')).toHaveDisplayValue('');
  expect(screen.queryAllByRole('alert')).toHaveLength(0);
  await press('장소 추가하기');
  expect(screen.getByText(/도시를 입력해 주세요/)).toBeVisible();
  await press('도쿄');
  await write('시작일', '2026-12-04');
  await write('종료일', '2026-12-03');
  await press('장소 추가하기');
  expect(screen.getByText(/여행 기간은 시작일부터/)).toBeVisible();
  await write('시작일', '2026-12-01');
  await write('종료일', '2026-12-03');
  expect(screen.queryByText(/여행 기간은 시작일부터/)).toBeNull();
  await write('기본 귀가 시각', '08:00');
  await press('장소 추가하기');
  expect(screen.getByText(/들어오는 시각은 나가는 시각 이후여야 합니다 \(같은 날짜\)/)).toBeVisible();
  await write('기본 귀가 시각', '22:00');
  expect(screen.queryByText(/\(같은 날짜\)/)).toBeNull();
  expect(f.created()).toBeUndefined();
  expect(screen).toHavePathname('/trips/new');
});

test('1-4: empty lodging results offer manual address search and native map POI selection', async () => {
  const key = 'EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY';
  const previous = process.env[key];
  process.env[key] = 'mock-native-key';
  try {
    const f = tripFixture();
    await renderTripApp(f);
    await fireEvent.press(await screen.findByRole('button', { name: '도쿄' }));
    await press('숙소 추가');
    await search('숙소 1 검색', '없는 곳');
    expect(await screen.findByText('검색 결과가 없어요')).toBeVisible();
    await press('주소 직접 입력');
    await search('숙소 1 주소', '1-2-3');
    await fireEvent.press(await screen.findByRole('button', { name: '도쿄 호텔' }));
    expect(screen.getByText('도쿄 호텔')).toBeVisible();
    await press('숙소 추가');
    await search('숙소 2 검색', '없는 곳');
    await fireEvent.press(await screen.findByRole('button', { name: '지도에서 위치 선택' }));
    await fireEvent(await screen.findByTestId('lodging-map'), 'poiClick', {
      nativeEvent: { placeId: 'hotel-b', name: '지도 숙소' },
    });
    expect(screen.getByText('지도 숙소')).toBeVisible();
    expect(screen.queryByTestId('lodging-map')).toBeNull();
  } finally {
    if (previous === undefined) delete process.env[key]; else process.env[key] = previous;
  }
});

test('1-1 and 1-5: complete trip, three-mode profile and date override with arrival, validation and reset', async () => {
  await renderTripApp(tripFixture());
  await fillTrip();
  expect(screen.getByText('✓ 입력 완료')).toBeVisible();
  expect(await screen.findByText(/대중교통 · 이동시간/)).toBeVisible();
  expect(screen.getByText(/택시 · 이동시간 — · 요금 약 500 기본/)).toBeVisible();
  expect(screen.getByText(/도보 · 이동시간 — · 무료/)).toBeVisible();
  expect(screen.getByText('추천 · 필요할 때만')).toBeVisible();
  await press('2026-12-01 수정');
  expect(screen.getByText('✈ 도착 08:00 · 입국 90분')).toBeVisible();
  await write('이날 귀가 시각', '08:00');
  await press('저장');
  expect(screen.getByRole('alert')).toHaveTextContent(/들어오는 시각은 나가는 시각 이후/);
  await write('이날 귀가 시각', '19:00');
  await fireEvent.press(within(screen.getByTestId('form-sheet')).getByRole('button', { name: '0끼' }));
  await press('저장');
  expect(screen.getByText('09:00–19:00 · 0끼')).toBeVisible();
  await press('2026-12-01 수정');
  expect(screen.getByLabelText('이날 귀가 시각')).toHaveDisplayValue('19:00');
  await press('기본값으로');
  expect(screen.queryByText('09:00–19:00 · 0끼')).toBeNull();
});
