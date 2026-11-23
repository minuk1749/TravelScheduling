import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { typography } from '@travel/design-tokens';
import { constraintsFrom, type Constraints } from '@travel/core/contracts/results/model';
import type { SharedItinerary } from '@travel/core/contracts/sharing';
import type { TripCreation } from '@travel/core/contracts/trips/create';
import { createDatabasePool } from '../../src/lib/db';
import { migrate } from '../../src/lib/migrations';
import { hashOpaqueToken } from '../../src/lib/opaque-token';
import { expectMarkers, installMapsDouble } from '../helpers/e2e-maps';
import { expectJson, signIn, upsertCityProfile, type Generated } from './support/app-client';
import { googleIdToken } from './support/google-key';

const TRAVELER = 'e2e-google-traveler', STRANGER = 'e2e-google-stranger';
/** Every visit is long (300 min) so six required places cannot fit three days; teamLab is a short wish. */
const VISITS = [
  { name: 'Senso-ji Temple', minutes: 300 }, { name: 'Tokyo Skytree', minutes: 300 }, { name: 'Meiji Jingu', minutes: 300 },
  { name: 'Shibuya Sky', minutes: 300 }, { name: 'Tsukiji Market', minutes: 300, kind: 'RESTAURANT' }, { name: 'Tokyo Tower', minutes: 300 },
  { name: 'teamLab Planets', minutes: 60, wish: true },
] as const;
const WISH = 'teamLab Planets';

const pool = createDatabasePool();
const removeTestUsers = () => pool.query('DELETE FROM users WHERE google_id = ANY($1::text[])', [[TRAVELER, STRANGER]]);
test.beforeAll(async () => {
  // CI may run e2e on a database that unit tests left empty; apply the (idempotent) schema first.
  const client = await pool.connect();
  try { await migrate(client); } finally { client.release(); }
  await removeTestUsers();
  await upsertCityProfile(pool);
});
test.afterAll(async () => { await removeTestUsers(); await pool.end(); });

const tokyoTime = (instant: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }).format(new Date(instant));
const scheduled = (result: Generated) => result.capacity.recommendation!.schedule.days;
const placedVisits = (result: Generated) => scheduled(result).flatMap(day => day.stops.flatMap(stop => stop.kind === 'VISIT' ? [stop.visitId] : []));
const withPriorities = (constraints: Constraints, required: readonly string[]): Constraints => ({
  ...constraints, visits: constraints.visits.map(visit => ({ ...visit, priority: required.includes(visit.id) ? 'REQUIRED' : 'WISH' })),
});

/**
 * Flows 1–10 as the mobile app performs them over HTTP with a Bearer session, against the real Next server, session API,
 * route handlers, services and PostgreSQL. Only Google is replaced: its ID token signing keys, Places and Routes behind
 * the server's fetch (tests/e2e/support/google-doubles.mjs), and the Maps JavaScript API on the share page (e2e-maps.ts).
 */
test('T25 Bearer journey: login → create → settings → over capacity → select required → re-verify → result → edit → share → withdraw', async ({ request, browser }, testInfo) => {
  test.setTimeout(180_000);

  // Flow 1: without a session every user API is 401; a Google ID token from another app is refused; the app's token signs in.
  await expectJson(request.post('/api/trips', { data: {} }), 401, 'UNAUTHENTICATED');
  await expectJson(request.post('/api/session', { data: { idToken: googleIdToken({ sub: TRAVELER, email: 't@example.test', aud: 'other-app' }) } }), 401, 'INVALID_GOOGLE_TOKEN');
  const app = await signIn(request, TRAVELER, 'traveler@example.test');
  const stranger = await signIn(request, STRANGER, 'stranger@example.test');
  const stored = await pool.query<{ token_hash: string }>(
    'SELECT s.token_hash FROM mobile_sessions s JOIN users u ON u.id = s.user_id WHERE u.google_id = $1', [TRAVELER]);
  expect(stored.rows.map(row => row.token_hash), 'only the hash is stored').toEqual([hashOpaqueToken(app.token)]);
  expect(await app.list()).toEqual({ trips: [] });

  // Flows 2–3: the city profile recommends a taxi policy; places come from (fake) Google search; the trip is saved to PostgreSQL.
  const profile = await expectJson<{ profile: { currency: string } | null; recommendedPolicy: string }>(app.get('/api/city-profiles?cityCode=TOKYO'), 200);
  expect(profile.profile?.currency).toBe('JPY');
  expect(profile.recommendedPolicy, 'Tokyo recommends "only when needed" before the traveler picks a policy').toBe('WHEN_NEEDED');
  const airport = await app.placeId('Haneda Airport'), hotel = await app.placeId('Ginza Hotel');
  const trip: TripCreation = {
    cityCode: 'TOKYO', timeZone: 'Asia/Tokyo', startDate: '2026-12-01', endDate: '2026-12-03', taxiPolicy: 'NEVER', luggageOption: 'VIA_LODGING',
    flights: [{ direction: 'ARRIVAL', googlePlaceId: airport, localDateTime: '2026-12-01T09:00' }, { direction: 'DEPARTURE', googlePlaceId: airport, localDateTime: '2026-12-03T18:00' }],
    lodgings: [{ googlePlaceId: hotel, checkIn: '2026-12-01', checkOut: '2026-12-03' }],
    visits: [],
  };
  for (const visit of VISITS) {
    trip.visits.push({ googlePlaceId: await app.placeId(visit.name), kind: 'kind' in visit ? visit.kind : 'ATTRACTION', minutes: visit.minutes, priority: 'wish' in visit ? 'WISH' : 'REQUIRED' });
  }
  const { id } = await app.createTrip(trip);
  expect(await app.list()).toEqual({ trips: [{ id, cityCode: 'TOKYO', startDate: '2026-12-01', endDate: '2026-12-03' }] });
  expect((await pool.query('SELECT taxi_policy, city_code FROM trips WHERE id = $1', [id])).rows[0]).toEqual({ taxi_policy: 'NEVER', city_code: 'TOKYO' });
  expect((await pool.query('SELECT count(*)::int AS n FROM trip_places WHERE trip_id = $1', [id])).rows[0].n).toBe(VISITS.length);
  await expectJson(app.get(`/api/trips/${id}`), 200);
  await expectJson(stranger.get(`/api/trips/${id}`), 403, 'FORBIDDEN');
  await expectJson(app.get(`/api/trips/${randomUUID()}`), 404, 'NOT_FOUND');

  // Flow 4: living settings load what was saved; a change is stored (a stale revision is refused) and reaches the next calculation.
  const settings = await app.settings(id);
  expect(settings.snapshot.settings.taxiPolicy).toBe('NEVER');
  expect(settings.calculation.scope).toBe('TIME_WINDOWS');
  const changed = await app.saveSettings(id, settings.snapshot.revision, { ...settings.snapshot.settings, taxiPolicy: 'PREFER' });
  await expectJson(app.put(`/api/trips/${id}/settings`, { revision: settings.snapshot.revision, settings: settings.snapshot.settings }), 409, 'STALE_INPUT');
  expect((await app.settings(id)).snapshot).toEqual(changed.snapshot);
  expect((await pool.query('SELECT taxi_policy FROM trips WHERE id = $1', [id])).rows[0].taxi_policy).toBe('PREFER');
  await expectJson(stranger.get(`/api/trips/${id}/settings`), 403, 'FORBIDDEN');

  // Flow 5: the full recalculation is over capacity with a recommended required set smaller than the six requested.
  const key = randomUUID();
  const over = await app.generate(id, key);
  expect(over.status).toBe('OVER_CAPACITY');
  const { requiredCount, requiredVisitIds: recommended } = over.capacity.recommendation!;
  expect(requiredCount, 'the recommended maximum shown to the traveler').toBeGreaterThan(0);
  expect(requiredCount).toBeLessThan(6);
  expect(new Set(recommended).size).toBe(requiredCount);
  expect(placedVisits(over).filter(visit => recommended.includes(visit)), 'the preview places every recommended required visit').toHaveLength(requiredCount);
  expect((await app.generate(id, key)).itineraryId, 'a retried request returns the same saved result').toBe(over.itineraryId);

  // Flow 6: choose exactly the recommended places as required, then re-verify the saved input.
  const saved = await app.savedInput(id);
  expect(saved.revision).toBe(over.inputHash);
  const names = Object.fromEntries(saved.input.visits.map(visit => [visit.id, saved.places[visit.place.id]?.name ?? '']));
  expect(Object.values(names).sort()).toEqual(VISITS.map(visit => visit.name).sort());
  const selected = await app.saveConstraints(id, saved.revision, withPriorities(constraintsFrom(saved.input), recommended));
  await expectJson(app.put(`/api/trips/${id}/constraints`, { revision: saved.revision, constraints: constraintsFrom(saved.input) }), 409, 'STALE_INPUT');
  const verified = await app.generate(id);
  expect(verified.status).toBe('OK');
  expect(verified.inputHash).toBe(selected.revision);
  for (const visit of recommended) expect(placedVisits(verified)).toContain(visit);
  expect(verified.verification.verified).toBe(true);

  // Flow 7: the result compares transit and taxi with fares on every leg, follows the saved PREFER policy, and has road shapes.
  expect(verified.comparisons.length).toBeGreaterThan(0);
  for (const leg of verified.comparisons) {
    for (const mode of ['TRANSIT', 'TAXI'] as const) {
      const alternative = leg.alternatives[mode], label = `${leg.from}→${leg.to} ${mode}`;
      expect(alternative?.fare, label).toEqual(expect.any(Number));
      expect(Number.isFinite(alternative?.minutes) && alternative!.minutes >= 0, `${label} minutes`).toBe(true);
    }
  }
  expect(verified.efficiency?.currency).toBe('JPY');
  expect(verified.comparisons.some(leg => leg.selected.mode === 'TAXI')).toBe(true);
  const shapes = await app.shapes(id, verified);
  expect(shapes.itineraryId).toBe(verified.itineraryId);
  expect(shapes.legs).toHaveLength(verified.comparisons.length);
  for (const leg of shapes.legs) expect(leg.shape.status).toBe('OK');
  await expectJson(stranger.get(`/api/trips/${id}/itinerary/shapes?inputHash=${verified.inputHash}`), 403, 'FORBIDDEN');

  // Flow 8: add the wish place to a date/time/order (releasing one required place), then pin a leg to transit; both persist.
  const wishId = saved.input.visits.find(visit => names[visit.id] === WISH)!.id;
  const released = recommended.at(-1)!;
  const edits = await app.savedInput(id);
  const constraints = constraintsFrom(edits.input);
  constraints.visits = constraints.visits.map(visit => visit.id === wishId ? { ...visit, fixedDate: '2026-12-02', fixedTime: '15:00', fixedOrder: 0 }
    : visit.id === released ? { ...visit, priority: 'WISH' } : visit);
  await app.saveConstraints(id, edits.revision, constraints);
  const dated = await app.generate(id);
  expect(dated.status).toBe('OK');
  const pinned = dated.comparisons.find(leg => leg.kind === 'DAY')!;
  const withLeg = await app.savedInput(id);
  await app.saveConstraints(id, withLeg.revision, { ...constraintsFrom(withLeg.input), legModes: [{ date: pinned.date, from: pinned.from, to: pinned.to, mode: 'TRANSIT' }] });
  const edited = await app.generate(id);
  expect(edited.status).toBe('OK');
  const reopened = await app.savedInput(id);
  expect(reopened.revision).toBe(edited.inputHash);
  expect(reopened.input.visits.find(visit => visit.id === wishId)).toMatchObject({ priority: 'WISH', fixedDate: '2026-12-02', fixedTime: '15:00', fixedOrder: 0 });
  expect(reopened.input.legModes).toEqual([{ date: pinned.date, from: pinned.from, to: pinned.to, mode: 'TRANSIT' }]);
  const secondDay = scheduled(edited).find(day => day.date === '2026-12-02')!;
  const firstVisit = secondDay.stops.find(stop => stop.kind === 'VISIT')!;
  expect(firstVisit).toMatchObject({ kind: 'VISIT', visitId: wishId });
  expect(tokyoTime(firstVisit.start)).toBe('15:00');
  expect(edited.comparisons.find(leg => leg.date === pinned.date && leg.from === pinned.from && leg.to === pinned.to)?.selected)
    .toMatchObject({ mode: 'TRANSIT', fixed: true });
  const expectedPlaced = [...recommended.filter(visit => visit !== released), wishId].sort();
  expect([...placedVisits(edited)].sort()).toEqual(expectedPlaced);

  // Flow 9: the owner issues a read-only link; an anonymous reader gets the same saved result without owner settings.
  const { path } = await app.share(id);
  expect(path).toMatch(/^\/share\/[A-Za-z0-9_-]{43}$/);
  await expectJson(stranger.post(`/api/trips/${id}/share`), 403, 'FORBIDDEN');
  const sharedResponse = await request.get(path.replace('/share/', '/api/share/'));
  expect(sharedResponse.headers()['referrer-policy']).toBe('no-referrer');
  const shared = await expectJson<SharedItinerary>(sharedResponse, 200);
  expect(shared.result.capacity.recommendation?.schedule.days).toEqual(scheduled(edited));
  expect(Object.keys(shared.view.input).sort()).toEqual(['endDate', 'startDate', 'timeZone', 'visits']);
  // The only web page left renders that saved result at 375px with the app's design tokens and no editing controls.
  const reader = await browser.newContext({ viewport: { width: 375, height: 812 }, serviceWorkers: 'block' });
  const anonymous = await reader.newPage();
  await installMapsDouble(anonymous);
  await anonymous.goto(path);
  const sharedPage = anonymous.getByRole('main');
  await expect(sharedPage.getByText('일정을 만들었습니다')).toBeVisible();
  await expect(sharedPage).toHaveCSS('background-color', 'rgb(242, 244, 246)');
  await expect(sharedPage).toHaveCSS('font-family', /^Pretendard,/);
  const heading = sharedPage.getByRole('heading', { name: '공유 여행 일정', exact: true });
  await expect(heading).toHaveCSS('font-size', `${typography.title.size}px`);
  await expect(heading).toHaveCSS('font-weight', `${typography.title.weight}`);
  const fontWeights = await anonymous.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter(font => font.family === 'Pretendard' && font.status === 'loaded').map(font => font.weight).sort();
  });
  expect(fontWeights).toEqual([String(typography.body.weight), String(typography.title.weight)]);
  await expect(sharedPage.locator('.result-stop')).toHaveCount(scheduled(edited).reduce((count, day) => count + day.stops.length, 0));
  await expect(sharedPage.locator('.result-leg > p', { hasText: '수단 고정' })).toHaveCount(1);
  await expectMarkers(anonymous, Object.fromEntries(saved.input.visits.map(visit => [names[visit.id], expectedPlaced.includes(visit.id) ? 'placed' : 'wish'])));
  await expect(anonymous.locator('input, select, textarea, fieldset')).toHaveCount(0);
  expect(await anonymous.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await anonymous.screenshot({ path: testInfo.outputPath('journey-share-375.png'), fullPage: true });
  await reader.close();
  // Re-issuing invalidates the previous link.
  const { path: rotated } = await app.share(id);
  await expectJson(request.get(path.replace('/share/', '/api/share/')), 404, 'NOT_FOUND');
  await expectJson(request.get(rotated.replace('/share/', '/api/share/')), 200);

  // Flow 10: logout revokes only that device's session; withdrawal deletes the user, trips, sessions and the shared link.
  const otherDevice = await signIn(request, TRAVELER, 'traveler@example.test');
  await expectJson(otherDevice.delete('/api/session'), 204);
  await expectJson(otherDevice.get('/api/trips'), 401, 'UNAUTHENTICATED');
  await expectJson(app.get('/api/trips'), 200);
  await expectJson(stranger.delete('/api/account'), 204);
  await expectJson(app.get(`/api/trips/${id}`), 200);
  await expectJson(app.delete('/api/account'), 204);
  await expectJson(app.get('/api/trips'), 401, 'UNAUTHENTICATED');
  await expectJson(request.get(rotated.replace('/share/', '/api/share/')), 404, 'NOT_FOUND');
  expect((await pool.query('SELECT count(*)::int AS n FROM users WHERE google_id = ANY($1::text[])', [[TRAVELER, STRANGER]])).rows[0].n).toBe(0);
  expect((await pool.query('SELECT count(*)::int AS n FROM trips WHERE id = $1', [id])).rows[0].n).toBe(0);
});
