import { fireEvent, screen, within } from 'expo-router/testing-library';
import { json } from './helpers';
import { conflictTrip, D1, ITINERARY_A, legId, openResult, place, resultFixture, view } from './result-fixture';

const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const sheet = () => within(screen.getByTestId('form-sheet'));

test('after a stale write the map and timeline keep the successful airport trip while the conflict editor uses the refreshed input', async () => {
  const f = resultFixture(), airport = place('airport'), hotel = place('hotel'), shrine = place('shrine');
  const originalAirport = view.places[airport]!, originalHotel = view.places[hotel]!, originalShrine = view.places[shrine]!;
  const updatedShrine = { ...originalShrine, name: '메이지 신궁 새 안내', coordinates: { latitude: 35.675, longitude: 139.7 } };
  const latest = { ...view, revision: 'f'.repeat(64), places: { ...view.places, [airport]: null, [hotel]: null, [shrine]: updatedShrine },
    input: { ...view.input, visits: view.input.visits.map(v => v.id === 'shrine' ? { ...v, fixedDate: D1, fixedTime: '09:30' } : v),
      legModes: [{ date: D1, from: airport, to: hotel, mode: 'TRANSIT' as const }] } };
  const arrival = legId(D1, 'airport', 'hotel', 'AIRPORT');
  await openResult(f);
  expect(await screen.findByTestId('marker-airport:' + airport)).toBeVisible();
  expect(screen.getByTestId('straight-' + arrival)).toHaveTextContent(JSON.stringify([originalAirport.coordinates, originalHotel.coordinates]));
  f.save.mockResolvedValueOnce(json({ code: 'STALE_INPUT', error: '다른 기기에서 입력이 바뀌었어요.' }, 409));
  await press('택시 14분 약 ¥2,300로 바꾸기');
  await screen.findByText('⚠ 동선을 계산하지 못했어요');
  f.read.mockReturnValueOnce(json(latest));
  const conflict = conflictTrip(latest.revision);
  conflict.itineraryId = '24542ffe-2457-4ccf-894b-7b0e46d25b87';
  conflict.capacity.unplaced = [{ visitId: 'shrine', reason: 'TIME_WINDOW', fixed: true }];
  conflict.capacity.issues = [];
  f.generate.mockResolvedValueOnce(json(conflict));
  await press('다시 계산');

  expect(await screen.findByRole('button', { name: updatedShrine.name + ' 고정 수정' })).toBeEnabled();
  expect(screen.getByTestId('coordinate-airport:' + airport)).toHaveTextContent(JSON.stringify(originalAirport.coordinates));
  expect(screen.getByTestId('coordinate-lodging:' + hotel)).toHaveTextContent(JSON.stringify(originalHotel.coordinates));
  expect(screen.getByTestId('straight-' + arrival)).toHaveTextContent(JSON.stringify([originalAirport.coordinates, originalHotel.coordinates]));
  expect(screen.getByRole('button', { name: '지도 ' + updatedShrine.name, selected: true })).toBeVisible();
  expect(screen.getByTestId('coordinate-shrine')).toHaveTextContent(JSON.stringify(updatedShrine.coordinates));
  await press('전체 일정');
  const transfer = within(sheet().getByTestId('schedule-leg-' + arrival));
  expect(transfer.getByText(/도심 밖/)).toBeVisible();
  expect(transfer.getByText(/하네다 공항 → 도쿄 호텔/)).toBeVisible();
  expect(sheet().queryByText(updatedShrine.name)).toBeNull();
  await fireEvent.press(sheet().getByRole('button', { name: '닫기' }));
  await press(updatedShrine.name + ' 고정 수정');
  expect(sheet().getByLabelText('고정 시각')).toHaveDisplayValue('09:30');
  expect(sheet().getByRole('button', { name: '1일차 12.3', selected: true })).toBeVisible();
  await fireEvent.press(sheet().getByRole('button', { name: '취소' }));
  await press('여행 전체 이동수단 고정 보기');
  expect(sheet().getByRole('button', { name: /대중교통 고정 해제/ })).toBeEnabled();
  await fireEvent.press(sheet().getByRole('button', { name: '취소' }));
  await press('2일 12.4');
  expect(screen.getByRole('button', { name: '지도 ' + originalShrine.name })).toBeVisible();
  expect(screen.getByTestId('coordinate-shrine')).toHaveTextContent(JSON.stringify(originalShrine.coordinates));
  await press('전체 일정');
  expect(sheet().getByRole('button', { name: '09:30 ' + originalShrine.name })).toBeVisible();
  expect(f.shapes.mock.calls.map(([url]) => url.searchParams.get('itineraryId'))).toEqual([ITINERARY_A]);
});
