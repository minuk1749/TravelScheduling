import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { constraintsFrom, type Constraints } from '@travel/core/contracts/results/model';
import { json } from './helpers';
import { conflictTrip, D1, D2, D3, openResult, place, plan, resultFixture, trip, view } from './result-fixture';

const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const sheet = () => within(screen.getByTestId('form-sheet'));
const marker = (id: string) => screen.getByTestId(`marker-${id}`, { includeHiddenElements: true });

test('the wish picker and map select, cancel, reopen, and apply the same visit', async () => {
  const extra = { ...view.input.visits[3], id: 'annex', place: { id: 'place-annex', googlePlaceId: 'google-annex' } };
  const f = resultFixture({ ...view,
    input: { ...view.input, visits: [extra, ...view.input.visits] },
    places: { ...view.places, 'place-annex': { googlePlaceId: 'google-annex', name: '박물관 별관',
      coordinates: { latitude: 35.717, longitude: 139.771 }, attributions: [] } },
  });
  await openResult(f);
  await press('3일 12.5');
  await press('희망 장소에서 추가');
  expect(sheet().getByRole('button', { name: '★ 박물관 별관', selected: true })).toBeVisible();
  expect(marker('annex')).toHaveProp('accessibilityState', expect.objectContaining({ selected: true }));
  await fireEvent.press(sheet().getByRole('button', { name: '★ 아사쿠사 카페' }));
  expect(sheet().getByRole('button', { name: '★ 아사쿠사 카페', selected: true })).toBeVisible();
  expect(marker('cafe')).toHaveProp('accessibilityState', expect.objectContaining({ selected: true }));
  expect(marker('annex')).toHaveProp('accessibilityState', expect.objectContaining({ selected: false }));
  await fireEvent.press(sheet().getByRole('button', { name: '취소' }));
  expect(marker('cafe')).toHaveProp('accessibilityState', expect.objectContaining({ selected: false }));
  expect(f.save).not.toHaveBeenCalled();

  await press('희망 장소에서 추가');
  expect(marker('annex')).toHaveProp('accessibilityState', expect.objectContaining({ selected: true }));
  await fireEvent.press(sheet().getByRole('button', { name: '★ 아사쿠사 카페' }));
  f.generate.mockImplementationOnce(async () => json(trip(f.current().revision, plan({ cafeOnDay3: true }))));
  await fireEvent.press(sheet().getByRole('button', { name: '3일차에 추가하고 다시 계산' }));
  await waitFor(() => expect(f.generate).toHaveBeenCalledTimes(2));
  const wishes = f.current().input.visits.filter(visit => visit.priority === 'WISH');
  expect(wishes.filter(visit => visit.fixedDate === D3).map(visit => visit.id)).toEqual(['cafe']);
  expect(marker('cafe')).toHaveTextContent('PLACED 1');
  expect(marker('cafe')).toHaveProp('accessibilityState', expect.objectContaining({ selected: true }));
});

function wishConflict(revision: string) {
  const result = conflictTrip(revision);
  result.capacity.unplaced = [{ visitId: 'cafe', reason: 'TIME_WINDOW', fixed: true }];
  result.capacity.issues = [];
  return result;
}

async function addBookedWishOnDayThree(originalDate: string) {
  const visits = view.input.visits.map(visit => visit.id === 'cafe'
    ? { ...visit, fixedDate: originalDate, fixedTime: '10:20', fixedOrder: 0 } : visit);
  const f = resultFixture({ ...view, input: { ...view.input, visits } });
  const original = constraintsFrom(f.current().input);
  const calculated: Constraints[] = [];
  f.generate.mockResolvedValueOnce(json(wishConflict(f.current().revision))).mockImplementation(async () => {
    calculated.push(constraintsFrom(f.current().input));
    return json(trip(f.current().revision, plan({ cafeOnDay3: true })));
  });

  await openResult(f);
  expect(screen.getByText('⚠ 고정 조건 충돌 1건')).toBeVisible();
  expect(screen.getByRole('button', { name: '희망 장소 추가, 1곳 중 선택' })).toBeEnabled();
  await press('아사쿠사 카페 고정 수정');
  expect(sheet().getByLabelText('고정 시각')).toHaveDisplayValue('10:20');
  await fireEvent.press(sheet().getByRole('button', { name: '취소' }));
  expect(marker('cafe')).toHaveTextContent('WISH -');
  await press('지도 아사쿠사 카페');
  await fireEvent.press(sheet().getByRole('button', { name: '3일차 12.5' }));
  await fireEvent.press(sheet().getByRole('button', { name: '3일차에 추가하고 다시 계산' }));
  expect(await screen.findByText('3일차에 추가하고 다시 계산했어요')).toBeVisible();
  expect(marker('cafe')).toHaveTextContent('PLACED 1');
  return { f, original, calculated };
}

test('reselecting the booked wish date after an initial conflict recalculates with both fixes and creates no undo', async () => {
  const { f, original, calculated } = await addBookedWishOnDayThree(D3);
  expect(f.save).not.toHaveBeenCalled();
  expect(calculated).toEqual([original]);
  expect(screen.queryByRole('button', { name: '되돌리기' })).toBeNull();
});

test('moving a booked wish after an initial conflict preserves the booked time and order in the PUT, calculation and undo', async () => {
  const { f, original, calculated } = await addBookedWishOnDayThree(D2);
  const moved = { ...original, visits: original.visits.map(visit => visit.id === 'cafe' ? { ...visit, fixedDate: D3 } : visit) };
  expect(f.save).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(f.save.mock.calls[0][0].body)).constraints).toEqual(moved);
  expect(calculated).toEqual([moved]);

  f.generate.mockImplementationOnce(async () => {
    calculated.push(constraintsFrom(f.current().input));
    return json(wishConflict(f.current().revision));
  });
  await press('되돌리기');
  expect(await screen.findByText('⚠ 고정 조건 충돌 1건')).toBeVisible();
  expect(f.save).toHaveBeenCalledTimes(2);
  expect(JSON.parse(String(f.save.mock.calls[1][0].body)).constraints).toEqual(original);
  expect(calculated).toEqual([moved, original]);
});

test.each([D1, D3])('a rejected wish on %s keeps the historical numbered stop and can be moved from the current wish list', async date => {
  const cafe = place('cafe'), original = view.places[cafe]!;
  const renamed = { ...original, name: '카페 새 출입구', coordinates: { latitude: 35.715, longitude: 139.797 } };
  const booked = (fixedDate: string) => view.input.visits.map(visit => visit.id === 'cafe'
    ? { ...visit, fixedDate, fixedTime: '10:20', fixedOrder: 0 } : visit);
  const f = resultFixture({ ...view, input: { ...view.input, visits: booked(D3) } });
  f.generate.mockResolvedValueOnce(json(trip(view.revision, plan({ cafeOnDay3: true }))));
  await openResult(f);
  f.save.mockResolvedValueOnce(json({ code: 'STALE_INPUT', error: '다른 기기에서 입력이 바뀌었어요.' }, 409));
  await press('택시 14분 약 ¥2,300로 바꾸기');
  await screen.findByText('⚠ 동선을 계산하지 못했어요');
  const latest = { ...view, revision: 'f'.repeat(64), places: { ...view.places, [cafe]: renamed },
    input: { ...view.input, visits: booked(date) } };
  f.read.mockReturnValueOnce(json(latest));
  f.generate.mockResolvedValueOnce(json(wishConflict(latest.revision)));
  await press('다시 계산');
  await screen.findByRole('button', { name: renamed.name + ' 고정 수정' });
  if (date === D1) {
    expect(screen.getByRole('button', { name: '지도 ' + renamed.name })).toHaveTextContent('WISH -');
    expect(screen.getByTestId('coordinate-cafe')).toHaveTextContent(JSON.stringify(renamed.coordinates));
    await press('지도 ' + renamed.name);
    expect(sheet().getByText('★ ' + renamed.name)).toBeVisible();
    await fireEvent.press(sheet().getByRole('button', { name: '취소' }));
    await press('3일 12.5');
  }
  expect(screen.getByRole('button', { name: '지도 ' + original.name })).toHaveTextContent('PLACED 1');
  expect(screen.getByTestId('coordinate-cafe')).toHaveTextContent(JSON.stringify(original.coordinates));
  await press('지도 ' + original.name);
  expect(screen.queryByTestId('form-sheet')).toBeNull();
  await press('희망 장소 추가, 1곳 중 선택');
  expect(sheet().getByRole('button', { name: '★ ' + renamed.name, selected: true })).toBeVisible();
  expect(marker('cafe')).toHaveTextContent('WISH -');
  expect(marker('cafe')).toHaveProp('accessibilityState', { selected: true });
  expect(screen.getByTestId('map-state', { includeHiddenElements: true })).toHaveTextContent(/focus:.*\bcafe\b/);
  expect(screen.getByTestId('coordinate-cafe', { includeHiddenElements: true })).toHaveTextContent(JSON.stringify(renamed.coordinates));
  await fireEvent.press(sheet().getByRole('button', { name: '2일차 12.4' }));
  expect(sheet().getByRole('button', { name: '2일차에 추가하고 다시 계산' })).toBeEnabled();
  await fireEvent.press(sheet().getByRole('button', { name: '취소' }));
  expect(marker('cafe')).toHaveTextContent('PLACED 1');
  expect(screen.getByTestId('coordinate-cafe')).toHaveTextContent(JSON.stringify(original.coordinates));
});
