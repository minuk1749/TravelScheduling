import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';
import { constraintsFrom, type LegEdit } from '@travel/core/contracts/results/model';
import { deferred, json } from './helpers';
import { conflictTrip, D1, D2, openResult, place, resultFixture, view } from './result-fixture';

const airport: LegEdit = { date: D1, from: place('airport'), to: place('hotel'), mode: 'TAXI' };
const day: LegEdit = { date: D1, from: place('hotel'), to: place('museum'), mode: 'TRANSIT' };
const otherDate: LegEdit = { ...airport, date: D2 };
const reverse: LegEdit = { ...day, from: day.to, to: day.from };
const releaseAirport = '하네다 공항 → 도쿄 호텔 · 택시 고정 해제하고 다시 계산';
const releaseDay = '도쿄 호텔 → 도쿄 국립박물관 · 대중교통 고정 해제하고 다시 계산';
const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));

// The server reports airport NO_ROUTE in transferIssues and day UNREACHABLE in capacity.issues.
// Neither response has a route comparison to edit. Use the reported date and directed place IDs.
function savedConflict(revision: string, fixes: readonly LegEdit[]) {
  const result = conflictTrip(revision);
  result.capacity.unplaced = [];
  result.capacity.issues = [];
  if (fixes.includes(airport)) {
    result.transferIssues = [{ date: D1, direction: 'ARRIVAL', from: airport.from, to: airport.to, reason: 'NO_ROUTE' }];
  }
  if (fixes.includes(day)) {
    result.capacity.unplaced = [{ visitId: 'museum', reason: 'UNREACHABLE', fixed: true }];
    result.capacity.issues = [{ date: D1, reason: 'UNREACHABLE', from: day.from, to: day.to }];
  }
  return result;
}

const fixture = (legModes: LegEdit[]) => resultFixture({ ...view, input: { ...view.input, legModes } });

test('an initial airport conflict releases only the chosen saved mode before POST, and undo can restore it', async () => {
  const f = fixture([day, airport, otherDate, reverse]);
  f.generate.mockResolvedValueOnce(json(savedConflict(view.revision, [airport])));
  await openResult(f);
  expect(screen.queryByRole('button', { name: '변경 취소' })).toBeNull();
  expect(screen.queryByRole('button', { name: releaseDay })).toBeNull();
  expect(f.save).not.toHaveBeenCalled();

  const before = constraintsFrom(f.current().input), after = { ...before, legModes: [day, otherDate, reverse] };
  const save = f.save.getMockImplementation()!;
  const pending = deferred<void>();
  f.save.mockImplementationOnce(async options => { await pending.promise; return save(options); });
  await press(releaseAirport);
  await waitFor(() => expect(f.save).toHaveBeenCalledTimes(1));
  expect(JSON.parse(String(f.save.mock.calls[0][0].body))).toEqual({ revision: view.revision, constraints: after });
  expect(f.generate).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: releaseAirport })).toBeNull();
  await act(async () => pending.resolve());
  expect(await screen.findByText('이동수단 고정을 해제하고 다시 계산했어요')).toBeVisible();
  expect(f.generate).toHaveBeenCalledTimes(2);
  expect(constraintsFrom(f.current().input)).toEqual(after);
  f.generate.mockImplementationOnce(async () => json(savedConflict(f.current().revision, [airport])));
  await press('되돌리기');
  expect(await screen.findByRole('button', { name: releaseAirport })).toBeVisible();
  expect(constraintsFrom(f.current().input)).toEqual(before);
});

test('separate airport and day causes survive a failed release, POST-only retry, and cancellation of a remaining conflict', async () => {
  const f = fixture([airport, day, otherDate, reverse]);
  f.generate.mockResolvedValueOnce(json(savedConflict(view.revision, [airport, day])));
  await openResult(f);
  expect(screen.getByRole('button', { name: releaseAirport })).toBeVisible();
  expect(screen.getByRole('button', { name: '도쿄 국립박물관 고정 수정' })).toBeVisible();
  await press('2일 12.4');
  expect(screen.queryByRole('button', { name: releaseAirport })).toBeNull();
  await press('1일 12.3');
  f.save.mockRejectedValueOnce(new Error('offline'));
  await press(releaseDay);
  await screen.findByText('⚠ 동선을 계산하지 못했어요');
  expect(f.generate).toHaveBeenCalledTimes(1);
  expect(f.current().input.legModes).toEqual([airport, day, otherDate, reverse]);
  f.generate.mockResolvedValueOnce(json({ code: 'PROVIDER_UNAVAILABLE', error: '계산 실패' }, 503));
  await press('다시 계산');
  await screen.findByText('계산 실패');
  expect(f.current().input.legModes).toEqual([airport, otherDate, reverse]);
  f.generate.mockImplementationOnce(async () => json(savedConflict(f.current().revision, [airport])));
  await press('다시 계산');
  expect(await screen.findByRole('button', { name: releaseAirport })).toBeVisible();
  expect(screen.queryByRole('button', { name: releaseDay })).toBeNull();
  expect(f.save).toHaveBeenCalledTimes(2);
  f.generate.mockImplementationOnce(async () => json(savedConflict(f.current().revision, [airport, day])));
  await press('변경 취소');
  expect(await screen.findByRole('button', { name: releaseDay })).toBeVisible();
  expect(f.current().input.legModes).toEqual([airport, day, otherDate, reverse]);
  expect(screen.queryByRole('button', { name: '변경 취소' })).toBeNull();
});

test('a route issue without an exact date and direction match offers no mode release', async () => {
  const f = fixture([otherDate, reverse]);
  f.generate.mockResolvedValueOnce(json(savedConflict(view.revision, [airport, day])));
  await openResult(f);
  expect(screen.queryByRole('button', { name: /고정 해제하고 다시 계산/ })).toBeNull();
  expect(f.save).not.toHaveBeenCalled();
});
