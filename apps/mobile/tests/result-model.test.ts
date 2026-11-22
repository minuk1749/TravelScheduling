import { legColors } from '@travel/design-tokens';
import { constraintsFrom } from '@travel/core/contracts/results/model';
import { roadShapeKey } from '../src/map/geometry';
import { mapScene } from '../src/map/scene';
import {
  findVisit, initialSelection, legEmphasis, pagerState, pendingLegKeys, reconcileSelection, selectDate, selectedCard,
  stepSelection, swipeTarget,
} from '../src/map/selection';
import { conflictCauses } from '../src/result/conflicts';
import { buildDays, placedVisitIds, tripDates } from '../src/result/days';
import { asWish, movedSummary, onDate, withLegMode, withVisit } from '../src/result/edits';
import { dateTitle, durationLabel, fixedLabel, freeTime, legLabel, moneyLabel, swapLabel } from '../src/result/format';
import { colors } from '../src/theme';
import { conflictTrip, D1, D2, D3, legId, place, plan, REVISION, trip, view } from './result-fixture';

const days = buildDays(view, trip(REVISION), null);
const [first, second, third] = days;

test('builds one day per trip date with numbered cards, arriving legs, waits and the lodging return', () => {
  expect(tripDates(D1, D3)).toEqual([D1, D2, D3]);
  expect(days.map(day => [day.date, day.number, day.cards.length, day.legs.length])).toEqual([[D1, 1, 2, 4], [D2, 2, 1, 2], [D3, 3, 0, 0]]);
  const [museum, market] = first.cards;
  expect(museum).toMatchObject({ visitId: 'museum', number: 1, fixed: '11:00 예약 고정', wait: 5, returnAt: null, changed: false });
  expect(museum.arrival).toMatchObject({ key: legId(D1, 'hotel', 'museum'), order: 2, fromName: '도쿄 호텔', color: legColors[1],
    swap: { mode: 'TAXI', estimate: { minutes: 14, fare: 2300 } }, outside: false });
  expect(market.arrival).toMatchObject({ mode: 'TAXI', swap: { mode: 'TRANSIT', estimate: { minutes: 30, fare: 200 } } });
  expect(market.returnAt).toBe('2026-12-03T05:35:00Z');
  expect(first.legs[0]).toMatchObject({ kind: 'AIRPORT', outside: true });
  expect(first.legs[3]).toMatchObject({ mode: 'WALK', swap: null, outside: false });
  expect(second.cards[0].arrival).toMatchObject({ outside: true, fare: null, swap: { mode: 'TAXI', estimate: null } });
  expect([first.start, first.end, first.travelMinutes]).toEqual(['2026-12-02T23:30:00Z', '2026-12-03T05:35:00Z', 115]);
  expect([third.start, third.end, third.travelMinutes]).toEqual([null, null, 0]);
  expect(placedVisitIds(days)).toEqual(new Set(['museum', 'market', 'shrine']));
});

test('timeline rows order endpoints, legs, visits and meals by time', () => {
  expect(first.rows.map(row => row.kind === 'ENDPOINT' ? row.role : row.kind)).toEqual(
    ['AIRPORT_ARRIVAL', 'LEG', 'LODGING_IN', 'LODGING_OUT', 'LEG', 'VISIT', 'MEAL', 'LEG', 'VISIT', 'LEG', 'LODGING_IN']);
  expect(first.rows[0]).toMatchObject({ at: '2026-12-02T23:00:00Z', name: '하네다 공항' });
  expect(second.rows.map(row => row.kind === 'ENDPOINT' ? row.role : row.kind)).toEqual(['LODGING_OUT', 'LEG', 'VISIT', 'LEG', 'LODGING_IN']);
});

test('marks moved visits against the previous calculation for the card and toast', () => {
  const moved = buildDays(view, trip(REVISION, plan({ museumLeg: 'TAXI', marketStart: '13:10' })), trip(REVISION));
  expect(moved[0].cards.map(card => [card.visitId, card.shift, card.changed])).toEqual([['museum', 0, false], ['market', -10, true]]);
  expect(movedSummary(moved)).toBe('아메요코 시장 10분 당겨짐');
  expect(movedSummary(days)).toBeNull();
});

test('conflict causes list fixed visits first and become selectable cards when they have no position', () => {
  const conflict = conflictTrip(REVISION);
  const causes = conflictCauses(view, conflict);
  expect(causes).toEqual([
    { visitId: 'market', date: null, message: '고정 순서 충돌', leg: null },
    { visitId: null, date: D1, message: '도쿄 국립박물관 → 아메요코 시장 · 이동 불가', leg: { date: D1, from: place('museum'), to: place('market') } },
  ]);
  expect(conflictCauses(view, trip(REVISION))).toEqual([]);
  const withBase = buildDays(view, trip(REVISION), null, causes);
  expect(withBase[0].cards[1]).toMatchObject({ visitId: 'market', issue: '고정 순서 충돌', number: 2 });
  expect(initialSelection(withBase, causes)).toEqual({ date: D1, index: 1 });
  const alone = buildDays(view, null, null, causes);
  expect(alone[0].cards).toEqual([expect.objectContaining({ visitId: 'market', number: null, start: null, arrival: null, issue: '고정 순서 충돌' })]);
  expect(conflictCauses(view, { ...conflict, verification: { verified: false, attempts: 8 } }).at(-1)?.message).toMatch(/검증/);
});

test('selection, paging and swipes stay inside the selected day', () => {
  const selection = initialSelection(days);
  expect(selection).toEqual({ date: D1, index: 0 });
  expect(selectedCard(days, selection)?.visitId).toBe('museum');
  expect(stepSelection(days, selection, -1)).toEqual(selection);
  expect(stepSelection(days, selection, 1)).toEqual({ date: D1, index: 1 });
  expect(stepSelection(days, { date: D1, index: 1 }, 1)).toEqual({ date: D1, index: 1 });
  expect(pagerState(0, 2)).toEqual({ position: 1, count: 2, previous: false, next: true });
  expect(pagerState(1, 2)).toEqual({ position: 2, count: 2, previous: true, next: false });
  expect(pagerState(0, 0)).toEqual({ position: 0, count: 0, previous: false, next: false });
  expect(selectDate(D3)).toEqual({ date: D3, index: 0 });
  expect(selectedCard(days, selectDate(D3))).toBeNull();
  expect(findVisit(days, 'shrine')).toEqual({ date: D2, index: 0 });
  expect(findVisit(days, 'cafe')).toBeNull();
  const stride = 312;
  expect(swipeTarget(0, -100, 0, 3, stride)).toBe(1);
  expect(swipeTarget(1, 50, 0, 3, stride)).toBe(1);
  expect(swipeTarget(1, 90, 0, 3, stride)).toBe(0);
  expect(swipeTarget(0, -20, -1.5, 3, stride)).toBe(1);
  expect(swipeTarget(0, -700, -2, 3, stride)).toBe(2);
  expect(swipeTarget(0, 300, 1, 3, stride)).toBe(0);
});

test('a recalculation keeps the same visit selected, else the same date', () => {
  const added = buildDays(view, trip(REVISION, plan({ cafeOnDay3: true })), null);
  expect(reconcileSelection(added, { date: D1, index: 1 }, 'cafe')).toEqual({ date: D3, index: 0 });
  expect(reconcileSelection(added, { date: D1, index: 1 }, 'market')).toEqual({ date: D1, index: 1 });
  expect(reconcileSelection(added, { date: D2, index: 4 }, 'gone')).toEqual({ date: D2, index: 0 });
});

test('highlighted legs: arriving leg (3-1), both legs of the edited place (3-3), pending legs hidden (3-5), all faded (3-8/3-9)', () => {
  const [museum, market] = first.cards;
  const by = (map: Map<string, string>) => Object.fromEntries(first.legs.map(leg => [leg.order, map.get(leg.key)]));
  expect(by(legEmphasis(first, museum, 'BROWSE'))).toEqual({ 1: 'DIM', 2: 'STRONG', 3: 'DIM', 4: 'DIM' });
  expect(by(legEmphasis(first, market, 'EDIT'))).toEqual({ 1: 'DIM', 2: 'DIM', 3: 'STRONG', 4: 'STRONG' });
  const change = { kind: 'MODE' as const, leg: { key: legId(D1, 'hotel', 'museum'), date: D1, from: place('hotel'), to: place('museum') }, mode: 'TAXI' as const };
  const pending = pendingLegKeys(days, change, view.input);
  expect(by(legEmphasis(first, museum, 'CALCULATING', pending))).toEqual({ 1: 'STRONG', 2: 'HIDDEN', 3: 'STRONG', 4: 'STRONG' });
  expect([...pendingLegKeys(days, { kind: 'VISIT', visitId: 'market' }, view.input)]).toEqual([legId(D1, 'museum', 'market'), legId(D1, 'market', 'hotel')]);
  expect(pendingLegKeys(days, { kind: 'UNDO', of: change }, view.input)).toEqual(pending);
  expect(pendingLegKeys(days, { kind: 'RETRY' }, view.input).size).toBe(6);
  expect(pendingLegKeys(days, null, view.input).size).toBe(0);
  expect(new Set(legEmphasis(first, museum, 'CONFLICT').values())).toEqual(new Set(['DIM']));
  expect(new Set(legEmphasis(first, museum, 'PREVIOUS').values())).toEqual(new Set(['DIM']));
});

test('map scene: placed, wish, lodging and airport markers, line style by mode/outside, red conflict leg', () => {
  const base = { view, card: first.cards[0], placed: placedVisitIds(days), shapes: new Map(), causes: [], pending: new Set<string>() };
  const scene = mapScene({ ...base, day: first, focus: 'BROWSE' });
  expect(scene.markers.map(marker => [marker.id, marker.kind, marker.order])).toEqual([
    ['lodging:place-hotel', 'LODGING', null], ['airport:place-airport', 'AIRPORT', null],
    ['museum', 'PLACED', 1], ['market', 'PLACED', 2], ['cafe', 'WISH', null]]);
  expect(scene.focusIds).toEqual(['lodging:place-hotel', 'museum', 'market']);
  expect(scene.routes.map(route => [route.order, route.line, route.emphasis, route.path.kind])).toEqual([
    [1, 'DOTTED', 'DIM', 'STRAIGHT'], [2, 'DOTTED', 'STRONG', 'STRAIGHT'], [3, 'DOTTED', 'DIM', 'STRAIGHT'], [4, 'DOTTED', 'DIM', 'STRAIGHT']]);
  const road = [{ latitude: 1, longitude: 2 }, { latitude: 3, longitude: 4 }];
  const shapes = new Map(first.legs.map(leg => [roadShapeKey(leg.key, leg.mode), road]));
  const withRoads = mapScene({ ...base, day: first, focus: 'BROWSE', shapes }).routes;
  expect(withRoads.map(route => route.line)).toEqual(['FLOATING', 'SOLID', 'SOLID', 'DOTTED']);
  for (const route of withRoads) expect(route.path).toEqual({ kind: 'ROAD', points: road });
  const wrongMode = new Map([[roadShapeKey(first.legs[1].key, 'TAXI'), road]]);
  const fallback = mapScene({ ...base, day: first, focus: 'BROWSE', shapes: wrongMode }).routes[1];
  expect(fallback).toMatchObject({ line: 'DOTTED', path: { kind: 'STRAIGHT', from: first.legs[1].fromPoint, to: first.legs[1].toPoint } });
  expect(mapScene({ ...base, day: third, card: null, focus: 'BROWSE' }).markers.map(marker => marker.kind)).toEqual(['LODGING', 'WISH']);
  const causes = conflictCauses(view, conflictTrip(REVISION));
  const conflict = mapScene({ ...base, day: first, focus: 'CONFLICT', causes });
  expect(conflict.routes.filter(route => route.emphasis !== 'DIM')).toEqual([{ id: 'conflict:1', order: 2, mode: 'TRANSIT',
    color: colors.red.text, line: 'FLOATING', emphasis: 'CONFLICT', path: expect.objectContaining({ kind: 'STRAIGHT' }) }]);
  expect(mapScene({ ...base, day: second, focus: 'CONFLICT', causes }).routes.every(route => route.emphasis === 'DIM')).toBe(true);
});

test('labels for times, fares, swaps, dates, fixed conditions and free time', () => {
  expect([durationLabel(45), durationLabel(60), durationLabel(135), durationLabel(14.2)]).toEqual(['45분', '1시간', '2시간 15분', '15분']);
  expect([moneyLabel(240, 'JPY'), moneyLabel(2300, 'JPY', true), moneyLabel(null, 'JPY'), moneyLabel(5, 'CHF')]).toEqual(['¥240', '약 ¥2,300', '요금 —', '5 CHF']);
  expect([legLabel('TRANSIT', 25, 240, 'JPY'), legLabel('TAXI', 14, 2300, 'JPY'), legLabel('WALK', 12, 0, 'JPY')])
    .toEqual(['대중교통 25분 · ¥240', '택시 14분 · 약 ¥2,300', '도보 12분']);
  expect([swapLabel({ mode: 'TAXI', estimate: { minutes: 14, fare: 2300 } }, 'JPY'), swapLabel({ mode: 'TAXI', estimate: null }, 'JPY')])
    .toEqual(['택시 14분 약 ¥2,300', '택시 정보 없음']);
  expect(dateTitle('2026-12-04')).toBe('12월 4일 금요일');
  expect([fixedLabel({ fixedDate: D1, fixedTime: '15:00' }), fixedLabel({ fixedDate: D1, fixedOrder: 1 }), fixedLabel({ fixedDate: D1 }), fixedLabel({})])
    .toEqual(['15:00 예약 고정', '2번째 순서 고정', '날짜 고정', null]);
  expect(freeTime({ ...view.input, daySettings: [{ date: D2, departureTime: '10:30', returnTime: null, mealSlots: null }] }, D2))
    .toBe('여유 시간 10:30 – 21:00 · 10시간 30분');
});

test('constraint edits replace one leg mode or visit and turn wishes into dated additions', () => {
  const original = constraintsFrom(view.input);
  const leg = { date: D1, from: place('hotel'), to: place('museum') };
  const taxi = withLegMode(original, leg, 'TAXI');
  expect(withLegMode(taxi, leg, 'WALK').legModes).toEqual([{ ...leg, mode: 'WALK' }]);
  const museum = original.visits[0];
  expect(asWish(museum)).toEqual({ id: 'museum', priority: 'WISH', fixedDate: null, fixedTime: null, fixedOrder: null });
  const cafe = onDate(original.visits[3], D3);
  expect(withVisit(original, cafe).visits[3]).toEqual({ id: 'cafe', priority: 'WISH', fixedDate: D3, fixedTime: null, fixedOrder: null });
  expect(withVisit(original, cafe).visits.slice(0, 3)).toEqual(original.visits.slice(0, 3));
});
