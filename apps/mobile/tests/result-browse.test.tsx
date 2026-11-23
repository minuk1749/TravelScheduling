import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { legColors } from '@travel/design-tokens';
import { colors, result } from '../src/theme';
import { json, session } from './helpers';
import { D1, D2, D3, trip, ITINERARY_A, legId, openResult, resultFixture, REVISION, routes } from './result-fixture';

const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const card = (name: string) => screen.getByRole('button', { name });

test('3-1: map-first layout selects the first card and highlights only the leg arriving there', async () => {
  const f = resultFixture();
  await openResult(f);
  expect(screen.getByRole('header', { name: '도쿄' })).toBeVisible();
  expect(screen.getByText('12.3 – 12.5 · 도쿄 호텔')).toBeVisible();
  expect(screen.getByRole('button', { name: '1일 12.3', selected: true })).toBeVisible();
  expect(screen.getByRole('button', { name: '2일 12.4', selected: false })).toBeVisible();
  expect(screen.getByRole('header', { name: '12월 3일 목요일' })).toBeVisible();
  expect(screen.getByText('08:30 – 14:35 · 장소 2곳 · 이동 1시간 55분')).toBeVisible();

  expect(card('1번 도쿄 국립박물관, 11:00부터 12:00까지')).toHaveProp('accessibilityState', expect.objectContaining({ selected: true }));
  expect(screen.getByText('11:00 – 12:00')).toBeVisible();
  expect(screen.getByText('🔒 11:00 예약 고정')).toBeVisible();
  expect(screen.getByText('오는 길 · 도쿄 호텔 · 대기 5분')).toBeVisible();
  expect(screen.getByText('대중교통 25분 · ¥240')).toBeVisible();
  expect(screen.getByRole('button', { name: '택시 14분 약 ¥2,300로 바꾸기' })).toBeEnabled();
  expect(screen.getByTestId('place-card-museum')).toHaveStyle({ borderColor: colors.sky.primary });
  expect(screen.getByText('1 / 2')).toBeVisible();
  expect(screen.getByRole('button', { name: '이전 장소' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '이 장소 수정' })).toBeEnabled();

  expect(screen.getByRole('button', { name: '지도 도쿄 국립박물관', selected: true })).toHaveTextContent('PLACED 1');
  expect(screen.getByRole('button', { name: '지도 아메요코 시장', selected: false })).toHaveTextContent('PLACED 2');
  expect(screen.getByRole('button', { name: '지도 아사쿠사 카페' })).toHaveTextContent('WISH -');
  expect(screen.getByRole('button', { name: '지도 도쿄 호텔' })).toHaveTextContent('LODGING -');
  expect(screen.getByRole('button', { name: '지도 하네다 공항' })).toHaveTextContent('AIRPORT -');
  expect(screen.queryByRole('button', { name: '지도 메이지 신궁' })).toBeNull();
  expect(screen.getByTestId('map-state')).toHaveTextContent('clear focus:lodging:place-hotel,museum,market');
  await waitFor(() => expect(routes()[legId(D1, 'hotel', 'museum')]).toBe(`2 TRANSIT SOLID STRONG ${legColors[1]} ROAD`));
  expect(routes()).toEqual({
    [legId(D1, 'airport', 'hotel', 'AIRPORT')]: `1 TRANSIT DOTTED DIM ${legColors[0]} STRAIGHT`,
    [legId(D1, 'hotel', 'museum')]: `2 TRANSIT SOLID STRONG ${legColors[1]} ROAD`,
    [legId(D1, 'museum', 'market')]: `3 TAXI DOTTED DIM ${legColors[2]} STRAIGHT`,
    [legId(D1, 'market', 'hotel')]: `4 WALK DOTTED DIM ${legColors[3]} STRAIGHT`,
  });
  expect(f.shapes).toHaveBeenCalledTimes(1);
  const [shapesUrl] = f.shapes.mock.calls[0];
  expect(shapesUrl.searchParams.get('inputHash')).toBe(REVISION);
  expect(shapesUrl.searchParams.get('itineraryId')).toBe(ITINERARY_A);
  const request = f.transport.mock.calls.find(([url]) => url === shapesUrl.href);
  expect(new Headers(request?.[1]?.headers).get('Authorization')).toBe(`Bearer ${session.token}`);
  expect(f.auth.getSnapshot().status).toBe('signedIn');
  expect(await f.storage.read()).toBe(JSON.stringify(session));
  expect(screen.getByTestId('map-legend')).toHaveTextContent('━ 이동 · ┈ 도보 · ⌒ 도심 밖 · ★ 희망 1');
});

test('card paging, card press and marker press keep the card, marker and arriving leg on the same place', async () => {
  const f = resultFixture();
  await openResult(f);
  await press('다음 장소');
  expect(card('2번 아메요코 시장, 13:20부터 14:05까지')).toHaveProp('accessibilityState', expect.objectContaining({ selected: true }));
  expect(screen.getByRole('button', { name: '다음 장소' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '지도 아메요코 시장', selected: true })).toBeVisible();
  expect(routes()[legId(D1, 'museum', 'market')]).toMatch(/^3 TAXI DOTTED STRONG/);
  expect(routes()[legId(D1, 'hotel', 'museum')]).toMatch(/ DIM /);
  expect(screen.getByText('오는 길 · 도쿄 국립박물관 · 숙소 복귀 14:35')).toBeVisible();
  expect(screen.getByText('택시 20분 · 약 ¥3,100')).toBeVisible();
  expect(screen.getByRole('button', { name: '대중교통 30분 ¥200로 바꾸기' })).toBeEnabled();
  expect(screen.getByRole('button', { name: '택시 14분 약 ¥2,300로 바꾸기' })).toBeDisabled();

  await fireEvent.press(screen.getByRole('button', { name: '지도 도쿄 국립박물관' }));
  expect(card('1번 도쿄 국립박물관, 11:00부터 12:00까지')).toHaveProp('accessibilityState', expect.objectContaining({ selected: true }));
  expect(routes()[legId(D1, 'hotel', 'museum')]).toMatch(/ STRONG /);
  await fireEvent.press(card('2번 아메요코 시장, 13:20부터 14:05까지'));
  expect(screen.getByRole('button', { name: '지도 아메요코 시장', selected: true })).toBeVisible();
  await press('이전 장소');
  expect(screen.getByRole('button', { name: '지도 도쿄 국립박물관', selected: true })).toBeVisible();
});

test('3-2: the whole-day sheet lists endpoints, moves with outside-centre marks, meals and efficiency', async () => {
  const f = resultFixture();
  await openResult(f);
  await press('전체 일정');
  const sheet = within(screen.getByTestId('form-sheet'));
  expect(sheet.getByRole('header', { name: '12월 3일 목요일 전체 일정' })).toBeVisible();
  expect(sheet.getByText('✈ 공항 도착 · 하네다 공항')).toBeVisible();
  expect(sheet.getByText('대중교통 40분 · ¥500 · 도심 밖')).toBeVisible();
  expect(sheet.getByText('점심 식사')).toBeVisible();
  expect(sheet.getByText('도보 30분')).toBeVisible();
  expect(sheet.getAllByText('⌂ 숙소 도착 · 도쿄 호텔')).toHaveLength(2);
  expect(sheet.getByText('⌂ 숙소 출발 · 도쿄 호텔')).toBeVisible();
  expect(sheet.getByText('대중교통·도보만 · 3시간 25분 · ¥1,340')).toBeVisible();
  expect(sheet.getByText('선택한 이동 · 2시간 55분 · 약 ¥4,040')).toBeVisible();
  expect(sheet.getByText('30분 단축')).toBeVisible();
  const order = screen.getAllByText(/^(08:00|11:00|12:00|13:20|14:35)$/).map(node => node.props.children);
  expect(order).toEqual(['08:00', '11:00', '12:00', '13:20', '14:35']);

  await fireEvent.press(sheet.getByRole('button', { name: '13:20 아메요코 시장' }));
  expect(screen.queryByTestId('form-sheet')).toBeNull();
  expect(card('2번 아메요코 시장, 13:20부터 14:05까지')).toHaveProp('accessibilityState', expect.objectContaining({ selected: true }));
});

test('date chips select the first card of the day; 3-7 shows unknown fare and a disabled taxi chip', async () => {
  const f = resultFixture();
  await openResult(f);
  await press('다음 장소');
  await press('2일 12.4');
  expect(screen.getByRole('button', { name: '2일 12.4', selected: true })).toBeVisible();
  expect(screen.getByRole('header', { name: '12월 4일 금요일' })).toBeVisible();
  expect(card('1번 메이지 신궁, 09:30부터 10:20까지')).toHaveProp('accessibilityState', expect.objectContaining({ selected: true }));
  expect(screen.getByText('대중교통 30분 · 요금 —')).toBeVisible();
  expect(screen.getByRole('button', { name: '택시 정보 없음' })).toBeDisabled();
  expect(screen.getByText('택시 정보 없음')).toHaveStyle({ color: colors.gray.disabled });
  expect(routes()[legId(D2, 'hotel', 'shrine')]).toBe(`1 TRANSIT DOTTED STRONG ${legColors[0]} STRAIGHT`);
  expect(screen.queryByRole('button', { name: '지도 하네다 공항' })).toBeNull();
  await press('전체 일정');
  expect(within(screen.getByTestId('form-sheet')).getByText('⌂ 숙소 출발 · 도쿄 호텔')).toBeVisible();
});

test('3-6: an empty date shows free time and wish addition without a pager, and only lodging and wish markers', async () => {
  const f = resultFixture();
  f.generate.mockResolvedValueOnce(json({ ...trip(REVISION), availableByDate: {
    [D3]: { start: '2026-12-05T06:00:00Z', end: '2026-12-05T10:30:00Z' },
  } }));
  await openResult(f);
  await press('3일 12.5');
  expect(screen.getByText('배치된 장소 없음')).toBeVisible();
  expect(screen.getByText('여유 시간 15:00 – 19:30 · 4시간 30분')).toBeVisible();
  expect(screen.getByRole('button', { name: '희망 장소에서 추가' })).toBeVisible();
  expect(screen.queryByRole('button', { name: '다음 장소' })).toBeNull();
  expect(screen.queryByRole('button', { name: '이 장소 수정' })).toBeNull();
  expect(routes()).toEqual({});
  expect(screen.getAllByRole('button', { name: /^지도 / }).map(node => node.props.accessibilityLabel))
    .toEqual(['지도 도쿄 호텔', '지도 아사쿠사 카페']);
  expect(screen.getByText('장소 0곳 · 이동 0분')).toBeVisible();
});

test('unselected cards carry the translucent veil; failed shape loading draws straight lines and retries', async () => {
  const f = resultFixture();
  f.shapes.mockResolvedValueOnce(json({ code: 'PROVIDER_UNAVAILABLE', error: '지도 서비스에 연결하지 못했습니다.' }, 503));
  await openResult(f);
  expect(await screen.findByRole('button', { name: '경로 모양 다시 불러오기' })).toBeVisible();
  expect(routes()[legId(D1, 'hotel', 'museum')]).toMatch(/TRANSIT DOTTED STRONG .* STRAIGHT$/);
  expect(routes()[legId(D1, 'airport', 'hotel', 'AIRPORT')]).toMatch(/TRANSIT DOTTED DIM .* STRAIGHT$/);
  const veils = screen.getAllByTestId('place-card-veil', { includeHiddenElements: true });
  expect(veils).toHaveLength(1);
  expect(veils[0]).toHaveStyle({ opacity: result.overlay.unselected });
  await press('경로 모양 다시 불러오기');
  await waitFor(() => expect(routes()[legId(D1, 'hotel', 'museum')]).toMatch(/ROAD$/));
  expect(f.shapes).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('button', { name: '경로 모양 다시 불러오기' })).toBeNull();
  expect(f.generate).toHaveBeenCalledTimes(1);
  expect(f.read).toHaveBeenCalledTimes(1);
});
