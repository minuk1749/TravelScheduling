import { fireEvent, screen, within } from 'expo-router/testing-library';
import { reservationSummary } from '../src/result/edits';
import { json } from './helpers';
import { at, D1, openResult, plan, resultFixture, trip, view } from './result-fixture';

const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));

test.each([false, true])('a reservation edit and its undo report a changed reservation (retry after save: %s)', async retry => {
  const f = resultFixture();
  await openResult(f);
  await press('이 장소 수정');
  const edit = within(screen.getByTestId('form-sheet'));
  await fireEvent.changeText(edit.getByLabelText('고정 시각'), '10:55');
  if (retry) f.generate.mockResolvedValueOnce(json({ code: 'PROVIDER_UNAVAILABLE', error: '다시 시도해 주세요.' }, 503));
  f.generate.mockImplementationOnce(async () => {
    const data = plan();
    const museum = data.stops[D1].find(row => row.kind === 'VISIT' && row.visitId === 'museum')!;
    museum.start = at(D1, '10:55');
    museum.end = at(D1, '11:55');
    return json(trip(f.current().revision, data));
  });
  await fireEvent.press(edit.getByRole('button', { name: '적용하고 다시 계산' }));
  if (retry) {
    await screen.findByText('⚠ 동선을 계산하지 못했어요');
    await press('다시 계산');
  }
  const toast = within(await screen.findByTestId('result-toast'));
  expect(f.current().input.visits.find(visit => visit.id === 'museum')?.fixedTime).toBe('10:55');
  expect(toast.getByText(/고정 예약이 바뀌었어요/)).toBeVisible();
  expect(toast.queryByText(/고정 예약은 그대로예요/)).toBeNull();
  expect(f.save).toHaveBeenCalledTimes(1);
  await fireEvent.press(toast.getByRole('button', { name: '되돌리기' }));
  await screen.findByText('되돌리고 다시 계산했어요');
  expect(f.current().input.visits.find(visit => visit.id === 'museum')?.fixedTime).toBe('11:00');
  expect(within(screen.getByTestId('result-toast')).getByText(/고정 예약이 바뀌었어요/)).toBeVisible();
});

test('reservations match by visit, local date and time independently of input order', () => {
  const booked = view.input.visits[0];
  const alsoBooked = { ...view.input.visits[1], fixedDate: D1, fixedTime: '15:00' };
  expect(reservationSummary([], [])).toBeNull();
  expect(reservationSummary([booked, alsoBooked], [alsoBooked, booked])).toBe('고정 예약은 그대로예요');
  for (const after of [[], [alsoBooked], [{ ...booked, fixedDate: '2026-12-04' }], [{ ...booked, id: 'other' }]]) {
    expect(reservationSummary([booked], after)).toBe('고정 예약이 바뀌었어요');
  }
  expect(reservationSummary([booked], [booked, alsoBooked])).toBe('고정 예약이 바뀌었어요');
});
