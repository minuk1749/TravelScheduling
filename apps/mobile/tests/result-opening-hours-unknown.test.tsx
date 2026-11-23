import { fireEvent, screen, within } from 'expo-router/testing-library';
import { validGeneratedTrip } from '../src/api/result-response';
import { buildDays } from '../src/result/days';
import { HOURS_UNKNOWN_LABEL } from '../src/result/format';
import { json } from './helpers';
import { conflictTrip, openResult, REVISION, resultFixture, trip, view } from './result-fixture';

// T28: unchecked opening hours are a per-place note, separate from the travel-time verification conflict.

const note = new RegExp(HOURS_UNKNOWN_LABEL);

test('the response check accepts the optional list of unchecked places and rejects other shapes', () => {
  const ok = trip(REVISION);
  expect(validGeneratedTrip({ ...ok, openingHoursUnknown: ['museum'] })).toBe(true);
  expect(validGeneratedTrip({ ...ok, openingHoursUnknown: [] })).toBe(true);
  expect(validGeneratedTrip({ ...ok, openingHoursUnknown: 'museum' })).toBe(false);
  expect(validGeneratedTrip({ ...ok, openingHoursUnknown: [1] })).toBe(false);
});

test('only scheduled cards whose hours were not checked carry the note', () => {
  const [first] = buildDays(view, { ...trip(REVISION), openingHoursUnknown: ['museum'] }, null);
  expect(first.cards.map(card => [card.visitId, card.hoursUnknown])).toEqual([['museum', true], ['market', false]]);
  const [plain] = buildDays(view, trip(REVISION), null);
  expect(plain.cards.every(card => !card.hoursUnknown && card.issue === null)).toBe(true);
});

test('the card shows the unchecked-hours note, which is not the failed travel-time verification message', async () => {
  const f = resultFixture();
  f.generate.mockImplementation(async () => json({ ...trip(f.current().revision), openingHoursUnknown: ['museum'] }));
  await openResult(f);
  expect(within(screen.getByTestId('place-card-museum')).getByText(note)).toBeVisible();
  expect(within(screen.getByTestId('place-card-market')).queryByText(note)).toBeNull();
  expect(screen.queryByText(/이동시간 검증을 완료하지 못했어요/)).toBeNull();
});

test('a result without unchecked hours shows no note, and an unverified conflict does not claim unchecked hours', async () => {
  const f = resultFixture();
  await openResult(f);
  expect(screen.queryByText(note)).toBeNull();
  expect(validGeneratedTrip({ ...conflictTrip(REVISION), verification: { verified: false, attempts: 8 } })).toBe(true);
  expect(buildDays(view, conflictTrip(REVISION), null).every(day => day.cards.every(card => !card.hoursUnknown))).toBe(true);
});

test('screen readers hear the unchecked-hours note on the card and the whole-day row, only for the unchecked place', async () => {
  const f = resultFixture();
  f.generate.mockImplementation(async () => json({ ...trip(f.current().revision), openingHoursUnknown: ['museum'] }));
  await openResult(f);
  expect(screen.getByRole('button', { name: `1번 도쿄 국립박물관, 11:00부터 12:00까지, ${HOURS_UNKNOWN_LABEL}` })).toBeVisible();
  expect(screen.getByRole('button', { name: '2번 아메요코 시장, 13:20부터 14:05까지' })).toBeVisible();

  await fireEvent.press(screen.getByRole('button', { name: '전체 일정' }));
  const sheet = within(screen.getByTestId('form-sheet'));
  expect(sheet.getByRole('button', { name: `11:00 도쿄 국립박물관, ${HOURS_UNKNOWN_LABEL}` })).toBeVisible();
  expect(sheet.getByRole('button', { name: '13:20 아메요코 시장' })).toBeVisible();
});
