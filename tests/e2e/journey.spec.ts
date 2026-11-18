import { expect, test, type Page } from '@playwright/test';
import { cityProfile } from '../fixtures/trip-input';
import { createDatabasePool } from '../../src/lib/db';
import { migrate } from '../../src/lib/migrations';
import { clickMarker, expectMarkers, installMapsDouble } from '../helpers/e2e-maps';
import { pick } from '../helpers/e2e-places';

const next = (page: Page) => page.getByRole('button', { name: '다음', exact: true }).click();
const revalidate = (page: Page) => page.getByRole('button', { name: '저장하고 동선 재검증' }).click();
const GOOGLE_ID = 'e2e-google-user';

/** Every visit is long (300 min) so six required places cannot fit three days; teamLab is a short wish. */
const VISITS = [
  { name: 'Senso-ji Temple', minutes: 300 }, { name: 'Tokyo Skytree', minutes: 300 }, { name: 'Meiji Jingu', minutes: 300 },
  { name: 'Shibuya Sky', minutes: 300 }, { name: 'Tsukiji Market', minutes: 300, kind: 'RESTAURANT' }, { name: 'Tokyo Tower', minutes: 300 },
  { name: 'teamLab Planets', minutes: 60, wish: true },
] as const;
const REQUIRED_STATES = { 'Senso-ji Temple': 'unplaced', 'Tokyo Skytree': 'unplaced', 'Meiji Jingu': 'unplaced', 'Shibuya Sky': 'unplaced', 'Tsukiji Market': 'unplaced', 'Tokyo Tower': 'unplaced', 'teamLab Planets': 'wish' } as const;

const pool = createDatabasePool();
const removeTestUser = () => pool.query('DELETE FROM users WHERE google_id = $1', [GOOGLE_ID]);
test.beforeAll(async () => {
  // CI may run e2e on a database that unit tests left empty; apply the (idempotent) schema first.
  const client = await pool.connect();
  try { await migrate(client); } finally { client.release(); }
  await removeTestUser();
  await pool.query(`INSERT INTO city_profiles (city_code, country, currency, transit_coverage, transit_hours, taxi_base_fare, taxi_fare_per_km,
      taxi_fare_per_minute, night_surcharge, night_start, night_end, call_buffer_minutes, efficiency_threshold, ride_hailing_apps, source, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    ON CONFLICT (city_code) DO UPDATE SET country = EXCLUDED.country, currency = EXCLUDED.currency, transit_coverage = EXCLUDED.transit_coverage,
      transit_hours = EXCLUDED.transit_hours, taxi_base_fare = EXCLUDED.taxi_base_fare, taxi_fare_per_km = EXCLUDED.taxi_fare_per_km,
      taxi_fare_per_minute = EXCLUDED.taxi_fare_per_minute, night_surcharge = EXCLUDED.night_surcharge, night_start = EXCLUDED.night_start,
      night_end = EXCLUDED.night_end, call_buffer_minutes = EXCLUDED.call_buffer_minutes, efficiency_threshold = EXCLUDED.efficiency_threshold,
      ride_hailing_apps = EXCLUDED.ride_hailing_apps, source = EXCLUDED.source, updated_at = EXCLUDED.updated_at`,
  [cityProfile.cityCode, cityProfile.country, cityProfile.currency, cityProfile.transitCoverage, cityProfile.transitHours, cityProfile.taxiBaseFare,
    cityProfile.taxiFarePerKm, cityProfile.taxiFarePerMinute, cityProfile.nightSurcharge, cityProfile.nightStart, cityProfile.nightEnd,
    cityProfile.callBufferMinutes, cityProfile.efficiencyThreshold, JSON.stringify(cityProfile.rideHailingApps), cityProfile.source, cityProfile.updatedAt]);
});
test.afterAll(async () => { await removeTestUser(); await pool.end(); });

/** Browser stand-in for accounts.google.com: bounces the authorization request straight back to the callback with a code. */
async function fakeGoogleConsent(page: Page) {
  const seen: URL[] = [];
  await page.route('https://accounts.google.com/o/oauth2/v2/auth*', route => {
    const url = new URL(route.request().url());
    seen.push(url);
    // Come back to the origin the browser session (and its state/PKCE cookies) belongs to.
    const back = new URL(new URL(url.searchParams.get('redirect_uri')!).pathname, page.url());
    // The nonce travels inside the code so the server double can put it in the id_token.
    back.searchParams.set('code', `e2e-code.${Buffer.from(url.searchParams.get('nonce') ?? '').toString('base64url')}`);
    back.searchParams.set('state', url.searchParams.get('state')!);
    return route.fulfill({ status: 302, headers: { location: back.href } });
  });
  return seen;
}

async function enterTrip(page: Page) {
  await page.getByRole('combobox', { name: '도시', exact: true }).selectOption('TOKYO');
  await expect(page.getByLabel('도시 이동 프로필')).toContainText('추천: 필요할 때만');
  await page.getByRole('combobox', { name: '택시 정책', exact: true }).selectOption('NEVER');
  await page.getByLabel('여행 시작일').fill('2026-12-01'); await page.getByLabel('여행 종료일').fill('2026-12-03');
  await next(page);
  await pick(page, '도착 공항', 'Haneda Airport'); await pick(page, '출발 공항', 'Haneda Airport');
  await page.getByLabel('현지 도착 일시').fill('2026-12-01T09:00'); await page.getByLabel('현지 출발 일시').fill('2026-12-03T18:00');
  await next(page);
  await pick(page, '숙소 1 검색', 'Ginza Hotel'); await next(page);
  for (const [index, visit] of VISITS.entries()) {
    const n = index + 1;
    await page.getByRole('button', { name: '장소 추가', exact: true }).click();
    await pick(page, `방문 장소 ${n} 검색`, visit.name);
    if ('kind' in visit) await page.getByRole('combobox', { name: `유형 ${n}`, exact: true }).selectOption(visit.kind);
    await page.getByLabel(`체류시간 (분) ${n}`, { exact: true }).fill(String(visit.minutes));
    if ('wish' in visit) await page.getByRole('combobox', { name: `우선순위 ${n}`, exact: true }).selectOption('WISH');
  }
}

/**
 * Flows 1–10 in one 375px browser session against the real server, real Auth.js session, real PostgreSQL and real
 * services. Only Google is replaced: OAuth consent in the browser, OAuth/Places/Routes behind the server's fetch
 * (tests/e2e/support/google-doubles.mjs) and the Maps JavaScript API in the browser (tests/helpers/e2e-maps.ts).
 */
test('T15 375px journey: login → create → settings → over capacity → select required → result → edit → share', async ({ page, request, browser }, testInfo) => {
  test.setTimeout(180_000);
  await installMapsDouble(page);
  const consent = await fakeGoogleConsent(page);

  // Flow 1: unauthenticated API calls are rejected; the login button starts the real OAuth round trip and creates the session.
  expect((await request.post('/api/trips', { data: {} })).status()).toBe(401);
  await page.goto('/');
  await page.getByRole('button', { name: 'Google로 로그인' }).click();
  await expect(page.getByRole('link', { name: '새 여행 만들기' })).toBeVisible();
  expect(consent).toHaveLength(1);
  expect(consent[0].searchParams.get('client_id')).toBe('e2e-client');
  expect(consent[0].searchParams.get('code_challenge')).toBeTruthy();
  await expect(page.getByRole('button', { name: 'Google로 로그인' })).toHaveCount(0);

  // Flows 2–5: trip, city profile, flights, lodging and places are typed in and saved to PostgreSQL by the real API.
  await page.getByRole('link', { name: '새 여행 만들기' }).click();
  await enterTrip(page);
  const created = page.waitForResponse(response => new URL(response.url()).pathname === '/api/trips' && response.request().method() === 'POST');
  await page.getByRole('button', { name: '여행 저장' }).click();
  const { id: tripId } = await (await created).json() as { id: string };
  await expect(page.getByRole('heading', { name: '여행 입력을 저장했습니다' })).toBeVisible();
  const stored = (await pool.query('SELECT taxi_policy, city_code FROM trips WHERE id = $1', [tripId])).rows[0];
  expect(stored).toEqual({ taxi_policy: 'NEVER', city_code: 'TOKYO' });
  expect((await pool.query('SELECT count(*)::int AS n FROM trip_places WHERE trip_id = $1', [tripId])).rows[0].n).toBe(VISITS.length);

  // Flow 6: living settings load what was saved, a change is stored, and the saved trip is fully recalculated (over capacity).
  await page.getByRole('link', { name: '생활 설정으로' }).click();
  await expect(page.getByLabel('택시 정책')).toHaveValue('NEVER');
  await page.getByLabel('택시 정책').selectOption('PREFER');
  await page.getByRole('button', { name: '설정 저장', exact: true }).click();
  await expect(page.getByText('생활 설정을 저장하고 시간창을 재계산했습니다.')).toBeVisible();
  await expect(page.getByRole('region', { name: '전체 동선 재계산' })).toContainText('수용량 초과');
  await page.reload();
  await expect(page.getByLabel('택시 정책')).toHaveValue('PREFER');
  expect((await pool.query('SELECT taxi_policy FROM trips WHERE id = $1', [tripId])).rows[0].taxi_policy).toBe('PREFER');
  await page.goto(`/trips/${tripId}/result`);

  // Flow 7: over capacity → recommended maximum N → choose the recommended required places → re-verify.
  await revalidate(page);
  const diagnostics = page.getByRole('region', { name: '동선 검증 결과' });
  await expect(diagnostics.getByText('필수 장소가 너무 많습니다')).toBeVisible();
  const recommended = Number((await diagnostics.innerText()).match(/추천 최대 필수 개수 (\d+)개/)![1]);
  expect(recommended).toBeGreaterThan(0); expect(recommended).toBeLessThan(6);
  // Flow 8 (map): the markers the adapter created are the saved visits. The over-capacity preview places exactly the
  // recommended combination; the other required places are unplaced and the wish place stays a wish.
  const previewNames = await page.getByRole('region', { name: '날짜별 타임라인' }).locator('.result-stop strong').allInnerTexts();
  const previewPlaced = Object.keys(REQUIRED_STATES).filter(name => previewNames.includes(name));
  expect(previewPlaced).toHaveLength(recommended);
  await expectMarkers(page, Object.fromEntries(Object.entries(REQUIRED_STATES).map(([name, state]) => [name, previewPlaced.includes(name) ? 'placed' : state])));
  await page.getByRole('button', { name: '추천 조합 선택' }).click();
  await revalidate(page);
  await expect(diagnostics.getByText('일정을 만들었습니다')).toBeVisible();

  // Flow 8: timeline, efficiency summary and map markers (placed vs wishlist) for exactly the recommended combination.
  const timeline = page.getByRole('region', { name: '날짜별 타임라인' });
  await expect(timeline).toBeVisible();
  await expect(page.getByRole('region', { name: '여행 전체 효율' })).toBeVisible();
  await expect.poll(async () => (await page.locator('.result-visit input[type=checkbox]:checked').count())).toBe(recommended);
  const placedNames = await timeline.locator('.result-stop strong').allInnerTexts();
  const required = (await page.locator('.result-visit input[type=checkbox]:checked').evaluateAll(nodes => nodes.map(node => node.parentElement!.textContent!.replace(/ 필수$/, ''))));
  expect(required).toHaveLength(recommended);
  for (const name of required) expect(placedNames).toContain(name);
  const expectedStates = Object.fromEntries(Object.keys(REQUIRED_STATES).map(name =>
    [name, required.includes(name) ? 'placed' : 'wish' as const])) as Record<string, 'placed' | 'wish'>;
  await expectMarkers(page, expectedStates);
  // Taxi policy PREFER (saved in the settings step) reaches the calculation: some leg is a taxi ride.
  await expect(timeline.locator('.result-leg > p', { hasText: '택시' }).first()).toBeVisible();
  // Clicking a marker reports that visit's id to the editor, which selects the matching card.
  const [anyPlaced] = required;
  await clickMarker(page, `● 배치 ${anyPlaced}`);
  await expect(page.getByRole('button', { name: `● 배치 ${anyPlaced}` })).toHaveAttribute('aria-pressed', 'true');

  // Flow 9: add the wishlist place to a date through its marker/card and fix a leg mode; edits survive reload and recalculation.
  const wish = 'teamLab Planets';
  expect(placedNames).not.toContain(wish);
  await clickMarker(page, `☆ 희망 ${wish}`);
  await expect(page.getByRole('button', { name: `☆ 희망 ${wish}` })).toHaveAttribute('aria-pressed', 'true');
  // The added wish place uses time, so release one required place to keep the day plan feasible.
  await page.getByLabel(`${required.at(-1)} 필수`).uncheck();
  await page.getByLabel(`${wish} 날짜`).fill('2026-12-02');
  await page.getByLabel(`${wish} 시각`).fill('15:00');
  await revalidate(page);
  await expect(diagnostics.getByText('일정을 만들었습니다')).toBeVisible();
  await expect(timeline.locator('.result-stop strong', { hasText: wish })).toHaveCount(1);
  await expectMarkers(page, { ...expectedStates, [wish]: 'placed', [required.at(-1)!]: 'wish' });
  await timeline.locator('select').first().selectOption('TRANSIT');
  await revalidate(page);
  await expect(diagnostics.getByText('일정을 만들었습니다')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(`${wish} 시각`)).toHaveValue('15:00');
  await revalidate(page);
  await expect(diagnostics.getByText('일정을 만들었습니다')).toBeVisible();
  await expect(timeline.locator('select').first()).toHaveValue('TRANSIT');
  await expectMarkers(page, { ...expectedStates, [wish]: 'placed', [required.at(-1)!]: 'wish' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('journey-result-375.png'), fullPage: true });
  const ownerStops = await timeline.locator('.result-stop').allInnerTexts();

  // Flow 10: the owner issues a read-only link; an anonymous reader sees the same saved result without edit controls.
  await page.getByRole('button', { name: '공유 링크 발급·재발급' }).click();
  const link = await page.getByLabel('공유 링크').inputValue();
  expect(new URL(link).pathname).toMatch(/^\/share\/.+/);
  const reader = await browser.newContext({ viewport: { width: 375, height: 812 }, serviceWorkers: 'block' });
  const anonymous = await reader.newPage();
  await installMapsDouble(anonymous);
  await anonymous.goto(link);
  const shared = anonymous.getByRole('region', { name: '날짜별 타임라인' });
  await expect(shared).toBeVisible();
  expect(await shared.locator('.result-stop').allInnerTexts()).toEqual(ownerStops);
  await expect(shared.locator('.result-leg > p', { hasText: '수단 고정' })).toHaveCount(1);
  await expectMarkers(anonymous, { ...expectedStates, [wish]: 'placed', [required.at(-1)!]: 'wish' });
  await expect(anonymous.locator('input, select, textarea, fieldset')).toHaveCount(0);
  await reader.close();

  // Account withdrawal removes the trip, so the shared link stops working.
  await page.goto('/');
  await page.getByRole('button', { name: '회원 탈퇴' }).click();
  await expect(page.getByRole('button', { name: 'Google로 로그인' })).toBeVisible();
  expect((await request.get(new URL(link).pathname.replace('/share/', '/api/share/'))).status()).toBe(404);
});
