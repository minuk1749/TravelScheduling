import { expect, test, type Page } from '@playwright/test';
import { cityProfile } from '../fixtures/trip-input';
import { settingsSnapshot } from '../fixtures/living-settings';
import { FixturePlaces, okVisits, sampleTrip } from '../fixtures/itinerary';
import { service } from '../helpers/itinerary-service';
import { applyEdits } from '../helpers/result';
import { mockPlaces, pick } from '../helpers/e2e-places';
import { MemoryShares } from '../helpers/sharing';
import { inputHash } from '../../src/repositories/trip-snapshot';
import { parseConstraints } from '../../src/results/input';
import { ResultEditService } from '../../src/services/itinerary/editing';
import { SharingService } from '../../src/services/sharing';
import { sharingHandlers } from '../../src/sharing/http';
import { parseSettings } from '../../src/settings/input';
import { calculateSettings } from '../../src/settings/calculate';
import type { TripInputs } from '../../src/services/itinerary/types';
import type { ItineraryResult } from '../../src/services/itinerary';

const next = (page: Page) => page.getByRole('button', { name: '다음', exact: true }).click();
const revalidate = (page: Page) => page.getByRole('button', { name: '저장하고 동선 재검증' }).click();

/**
 * Flows 1–10 in one browser session. External systems (Google OAuth/Places/Routes) are replaced by
 * fixtures at the HTTP boundary; the trip is a 3-day Tokyo sample whose visits all take 300 minutes,
 * so the first generation is OVER_CAPACITY and must be resolved by choosing required places.
 */
test('T15 375px journey: create → settings → over capacity → select required → result → edit → share', async ({ page }, testInfo) => {
  let input: TripInputs = sampleTrip(okVisits.map(visit => ({ ...visit, minutes: visit.priority === 'WISH' ? 60 : 300 })), { id: 'saved-trip' });
  let latest: ItineraryResult | null = null;
  const places = new FixturePlaces();
  const editor = new ResultEditService({ loadInputs: async () => ({ status: 'READY', input, inputHash: inputHash(input) }), save: async () => null }, places);
  let snapshot = structuredClone(settingsSnapshot);
  const compute = async () => { latest = await service({ places }).service.compute(input); return latest; };

  // Flow 1: an anonymous visitor is asked to sign in (real server; the Google round trip is a human check).
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Google로 로그인' })).toBeVisible();

  // Flows 2–5: trip, city profile, flights, lodging, places.
  await page.route('**/api/city-profiles?*', route => route.fulfill({ json: { profile: cityProfile, recommendedPolicy: 'WHEN_NEEDED' } }));
  await mockPlaces(page);
  await page.route('**/api/trips', route => route.fulfill({ status: 201, json: { id: 'saved-trip' } }));
  await page.goto('/trips/new');
  await page.getByRole('combobox', { name: '도시', exact: true }).selectOption('TOKYO');
  await expect(page.getByLabel('도시 이동 프로필')).toContainText('추천: 필요할 때만');
  await page.getByLabel('여행 시작일').fill('2026-12-01'); await page.getByLabel('여행 종료일').fill('2026-12-03');
  await next(page);
  await pick(page, '도착 공항', '테스트 공항'); await pick(page, '출발 공항', '테스트 공항');
  await page.getByLabel('현지 도착 일시').fill('2026-12-01T09:00'); await page.getByLabel('현지 출발 일시').fill('2026-12-03T18:00');
  await next(page);
  await pick(page, '숙소 1 검색', '테스트 호텔 A'); await next(page);
  await page.getByRole('button', { name: '장소 추가', exact: true }).click(); await pick(page, '방문 장소 1 검색', '테스트 미술관');
  await page.getByRole('button', { name: '여행 저장' }).click();
  await expect(page.getByRole('heading', { name: '여행 입력을 저장했습니다' })).toBeVisible();

  // Flow 6: living settings (live preview, save) then full regeneration, which is over capacity.
  await page.route('**/api/trips/saved-trip/settings', async route => {
    if (route.request().method() === 'PUT') {
      snapshot = { ...snapshot, revision: 'saved', settings: parseSettings(route.request().postDataJSON().settings, snapshot) };
    }
    await route.fulfill({ json: { snapshot, calculation: calculateSettings(snapshot, snapshot.settings) } });
  });
  await page.route('**/api/trips/saved-trip/itinerary', async route => route.fulfill({ json: { ...await compute(), inputHash: inputHash(input) } }));
  await page.route('**/api/trips/saved-trip/constraints', async route => {
    if (route.request().method() === 'PUT') {
      input = applyEdits(input, parseConstraints(route.request().postDataJSON().constraints, input));
      await route.fulfill({ json: { input, revision: inputHash(input) } }); return;
    }
    await route.fulfill({ json: await editor.load(input.id) });
  });
  await page.getByRole('link', { name: '생활 설정으로' }).click();
  await page.getByLabel('택시 정책').selectOption('PREFER');
  await page.getByRole('button', { name: '설정 저장', exact: true }).click();
  await expect(page.getByText('생활 설정을 저장하고 시간창을 재계산했습니다.')).toBeVisible();
  await page.getByRole('link', { name: '지도와 타임라인에서 확인하기' }).click();

  // Flow 7: over capacity → recommended maximum N → choose required places → re-verify.
  await revalidate(page);
  const diagnostics = page.getByRole('region', { name: '동선 검증 결과' });
  await expect(diagnostics.getByText('필수 장소가 너무 많습니다')).toBeVisible();
  const recommended = latest!.capacity.recommendation!.requiredCount;
  expect(recommended).toBeGreaterThan(0); expect(recommended).toBeLessThan(6);
  await expect(diagnostics).toContainText(`추천 최대 필수 개수 ${recommended}개`);
  await page.getByRole('button', { name: '추천 조합 선택' }).click();
  await revalidate(page);
  await expect(diagnostics.getByText('일정을 만들었습니다')).toBeVisible();
  expect(latest!.status).toBe('OK');

  // Flow 8: timeline, map markers (placed vs wishlist) and the transit-vs-taxi efficiency summary.
  await expect(page.getByRole('region', { name: '날짜별 타임라인' })).toBeVisible();
  await expect(page.getByRole('region', { name: '여행 전체 효율' })).toBeVisible();
  await expect(page.getByRole('region', { name: '여행 지도' })).toBeVisible();
  await expect(page.getByRole('region', { name: '여행 지도' })).toContainText('☆ 희망');

  // Flow 9: pin a wishlist place to a date and fix a leg mode; edits survive reload and re-calculation.
  const wishName = 'sample-teamlab';
  // The pinned wishlist visit uses time, so release the least useful required place to keep the day plan feasible.
  await page.getByLabel('sample-tokyo-tower 필수').uncheck();
  await page.getByLabel(`${wishName} 필수`).uncheck();
  await page.getByLabel(`${wishName} 날짜`).fill('2026-12-02');
  await page.getByLabel(`${wishName} 시각`).fill('15:00');
  await revalidate(page);
  await expect(diagnostics.getByText('일정을 만들었습니다')).toBeVisible();
  const mode = page.getByRole('region', { name: '날짜별 타임라인' }).locator('select').first();
  await mode.selectOption('TRANSIT');
  await revalidate(page);
  await page.reload();
  await expect(page.getByLabel(`${wishName} 시각`)).toHaveValue('15:00');
  await revalidate(page);
  await expect(diagnostics.getByText('일정을 만들었습니다')).toBeVisible();
  await expect(page.getByRole('region', { name: '날짜별 타임라인' }).locator('select').first()).toHaveValue('TRANSIT');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('journey-result-375.png'), fullPage: true });

  // Flow 10: the owner issues a read-only link; an anonymous reader sees it without any edit controls.
  await revalidate(page);
  const shares = new MemoryShares({
    input: { startDate: input.startDate, endDate: input.endDate, timeZone: input.timeZone,
      visits: input.visits.map(({ id, place, priority }) => ({ id, place, priority })) },
    refs: [...input.visits.map(v => v.place), ...input.flights.map(f => f.airport), ...input.lodgings.map(l => l.place)],
    result: latest!,
  });
  const sharing = new SharingService(shares, () => places);
  const handlers = sharingHandlers({ userId: async () => 'owner', findOwner: async () => 'owner', service: () => sharing });
  await page.route('**/api/trips/saved-trip/share', async route => {
    // MemoryShares only knows the id "trip"; the route's trip id is irrelevant to the rotation itself.
    const response = await handlers.rotate(new Request(route.request().url(), { method: 'POST' }), 'trip');
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
  });
  await page.route('**/api/share/*', async route => {
    const response = await handlers.read(new Request(route.request().url()), route.request().url().split('/').at(-1)!);
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
  });
  await page.getByRole('button', { name: '공유 링크 발급·재발급' }).click();
  const link = await page.getByLabel('공유 링크').inputValue();
  expect(new URL(link).pathname).toMatch(/^\/share\/.+/);
  const reader = await page.context().browser()!.newContext({ viewport: { width: 375, height: 812 }, serviceWorkers: 'block' });
  const anonymous = await reader.newPage();
  await anonymous.route('**/api/share/*', async route => {
    const response = await handlers.read(new Request(route.request().url()), route.request().url().split('/').at(-1)!);
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
  });
  await anonymous.goto(new URL(link).pathname);
  await expect(anonymous.getByRole('region', { name: '날짜별 타임라인' })).toBeVisible();
  await expect(anonymous.locator('input, select, textarea, fieldset')).toHaveCount(0);
  await reader.close();
});
