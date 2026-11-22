import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { json } from './helpers';
import { D3, openResult, plan, resultFixture, trip, view } from './result-fixture';

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
