import { test, expect, type Page } from '@playwright/test';
import { cityProfile } from '../fixtures/trip-input';
import { parseTripDraft, type TripDraft } from '../../src/trips/input';

async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const box of await page.locator('input, select, button').evaluateAll(nodes => nodes.filter(node => (node as HTMLElement).offsetParent !== null).map(node => {
    const rect = node.getBoundingClientRect(); return { left: rect.left, right: rect.right, height: rect.height };
  }))) { expect(box.left).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(375); expect(box.height).toBeGreaterThanOrEqual(44); }
}
async function pick(page: Page, label: string, name: string) {
  const picker = page.locator('.place-picker').filter({ has: page.getByLabel(label, { exact: true }) });
  await picker.getByRole('textbox').fill(name);
  await picker.getByRole('button', { name: '검색', exact: true }).click();
  await picker.getByRole('button', { name, exact: true }).click();
  await expect(picker.getByText(`선택: ${name}`, { exact: false })).toBeVisible();
}
async function mockPlaces(page: Page) {
  await page.route('**/api/places?*', async route => {
    const name = new URL(route.request().url()).searchParams.get('query')!;
    await route.fulfill({ json: { places: [{ googlePlaceId: `place-${encodeURIComponent(name).replaceAll('%', '')}`, name,
      attributions: [{ provider: '테스트 제공자', providerUri: 'https://example.test/source' }, { provider: '안전하지 않은 링크', providerUri: 'javascript:alert(1)' }] }], attribution: 'Google Maps' } });
  });
}
test('375px: flows 2–5, city profile, invalid inputs, multiple lodgings, retry and durable create payload', async ({ page }, testInfo) => {
  let saved: TripDraft | undefined, writes = 0;
  await page.route('**/api/city-profiles?*', route => route.fulfill({ json: { profile: cityProfile, recommendedPolicy: 'WHEN_NEEDED' } }));
  await mockPlaces(page);
  await page.route('**/api/trips', async route => {
    saved = parseTripDraft(route.request().postDataJSON()); writes++;
    await route.fulfill(writes === 1 ? { status: 503, json: { error: '일시적인 저장 오류' } } : { status: 201, json: { id: 'saved-trip' } });
  });
  await page.goto('/trips/new'); await fits(page);
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('도시를 입력');
  await page.getByLabel('도시', { exact: true }).selectOption('TOKYO');
  await expect(page.getByLabel('도시 이동 프로필')).toContainText('테스트 철도망');
  await expect(page.getByLabel('도시 이동 프로필')).toContainText('추천: 필요할 때만');
  await expect(page.getByLabel('도시 이동 프로필')).toContainText('2026-11-18');
  await expect(page.getByLabel('도시 이동 프로필')).toContainText('추정 요금');
  await page.screenshot({ path: testInfo.outputPath('city-profile-375.png'), fullPage: true });
  await page.getByLabel('택시 정책').selectOption('NEVER');
  await page.getByLabel('여행 시작일').fill('2026-12-01'); await page.getByLabel('여행 종료일').fill('2026-11-30');
  await page.getByRole('button', { name: '다음', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('1–31일');
  await page.getByLabel('여행 종료일').fill('2026-12-03'); await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByRole('button', { name: '다음', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('검색 결과');
  await pick(page, '도착 공항', '테스트 공항'); await pick(page, '출발 공항', '테스트 공항');
  await expect(page.getByText('Google Maps', { exact: true })).toHaveCount(2);
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
  await page.getByLabel('현지 도착 일시').fill('2026-12-02T09:00'); await page.getByRole('button', { name: '다음', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('도착은 여행 첫날');
  await page.getByLabel('현지 도착 일시').fill('2026-12-01T09:00'); await fits(page);
  await page.getByRole('button', { name: '이전', exact: true }).click(); await expect(page.getByLabel('택시 정책')).toHaveValue('NEVER');
  await page.getByRole('button', { name: '다음', exact: true }).click(); await expect(page.getByLabel('도착 공항', { exact: true })).toHaveValue('테스트 공항');
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await pick(page, '숙소 1 검색', '테스트 호텔 A'); await page.getByLabel('체크아웃 1', { exact: true }).fill('2026-12-02');
  await page.getByRole('button', { name: '다음', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('모든 숙박 날짜');
  await page.getByRole('button', { name: '숙소 추가', exact: true }).click(); await pick(page, '숙소 2 검색', '테스트 호텔 B');
  await page.getByLabel('체크인 2', { exact: true }).fill('2026-12-01'); await page.getByRole('button', { name: '다음', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('빈 날짜나 겹침');
  await page.getByLabel('체크인 2', { exact: true }).fill('2026-12-02'); await fits(page);
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByRole('button', { name: '여행 저장' }).click(); await expect(page.getByRole('alert')).toContainText('하나 이상'); expect(writes).toBe(0);
  await page.getByRole('button', { name: '장소 추가', exact: true }).click(); await pick(page, '방문 장소 1 검색', '테스트 미술관');
  await page.getByLabel('체류시간 (분) 1', { exact: true }).fill('0'); await page.getByRole('button', { name: '여행 저장' }).click();
  await expect(page.getByRole('alert')).toContainText('1–1,440분'); expect(writes).toBe(0);
  await page.getByLabel('체류시간 (분) 1', { exact: true }).fill('90');
  await page.getByRole('button', { name: '장소 추가', exact: true }).click(); await pick(page, '방문 장소 2 검색', '테스트 식당');
  await page.getByLabel('유형 2', { exact: true }).selectOption('RESTAURANT'); await page.getByLabel('우선순위 2', { exact: true }).selectOption('WISH');
  // Removing an extra row must preserve the two intended visits.
  await page.getByRole('button', { name: '장소 추가', exact: true }).click(); await pick(page, '방문 장소 3 검색', '삭제할 장소');
  await page.getByRole('button', { name: '방문 장소 3 삭제', exact: true }).click(); await fits(page);
  await page.getByRole('button', { name: '여행 저장' }).click(); await expect(page.getByRole('alert')).toContainText('일시적인 저장 오류');
  await expect(page.getByLabel('방문 장소 2 검색')).toHaveValue('테스트 식당');
  await page.screenshot({ path: testInfo.outputPath('places-375.png'), fullPage: true });
  await page.getByRole('button', { name: '여행 저장' }).click(); await expect(page.getByRole('heading', { name: '여행 입력을 저장했습니다' })).toBeVisible();
  expect(writes).toBe(2); expect(saved?.taxiPolicy).toBe('NEVER'); expect(saved?.timeZone).toBe('Asia/Tokyo');
  expect(saved?.lodgings).toHaveLength(2); expect(saved?.visits.map(v => v.kind)).toEqual(['ATTRACTION', 'RESTAURANT']);
  expect(saved?.visits[1].priority).toBe('WISH'); expect(JSON.stringify(saved)).not.toContain('테스트 호텔'); await fits(page);
});

test('city switching ignores stale profile, preserves explicit policy, and shows unknown city information', async ({ page }) => {
  await page.route('**/api/city-profiles?*', async route => {
    const code = new URL(route.request().url()).searchParams.get('cityCode');
    if (code === 'TOKYO') await new Promise(resolve => setTimeout(resolve, 500));
    await route.fulfill({ json: { profile: code === 'TOKYO' ? cityProfile : null, recommendedPolicy: 'WHEN_NEEDED' } });
  });
  await page.goto('/trips/new');
  await page.getByLabel('도시', { exact: true }).selectOption('TOKYO'); await page.getByLabel('택시 정책').selectOption('PREFER');
  await page.getByLabel('도시', { exact: true }).selectOption('PARIS');
  await expect(page.getByLabel('도시 이동 프로필')).toContainText('정보 없음');
  await expect(page.getByLabel('도시 이동 프로필')).toContainText('기본 추천');
  await expect(page.getByLabel('택시 정책')).toHaveValue('PREFER');
  await page.getByLabel('도시', { exact: true }).selectOption('OTHER'); await page.getByLabel('도시 이름').fill('뉴욕');
  await page.getByLabel('IANA 시간대').fill('America/New_York'); await fits(page);
});

test('profile and search failure/empty states are recoverable; typed text alone cannot select a place', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/city-profiles?*', route => route.fulfill(++attempts === 1 ? { status: 401, json: { error: '로그인 후 다시 시도해 주세요.' } } : { json: { profile: null } }));
  await page.goto('/trips/new'); await page.getByLabel('도시', { exact: true }).selectOption('TOKYO');
  await expect(page.getByRole('alert')).toContainText('로그인'); await page.getByRole('button', { name: '다시 불러오기' }).click();
  await expect(page.getByLabel('도시 이동 프로필')).toContainText('정보 없음');
  await page.getByLabel('여행 시작일').fill('2026-12-01'); await page.getByLabel('여행 종료일').fill('2026-12-03');
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.route('**/api/places?*', route => route.fulfill({ json: { places: [], attribution: 'Google Maps' } }));
  const picker = page.locator('.place-picker').first(); await picker.getByRole('textbox').fill('없는 공항');
  await picker.getByRole('button', { name: '검색', exact: true }).click(); await expect(picker.getByRole('status')).toContainText('검색 결과가 없습니다');
  await page.getByRole('button', { name: '다음', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('검색 결과에서 장소를 선택');
  await page.unroute('**/api/places?*'); await page.route('**/api/places?*', route => route.fulfill({ status: 503, json: { error: '장소 제공자 요청에 실패했습니다.' } }));
  await picker.getByRole('button', { name: '검색', exact: true }).click(); await expect(picker.getByRole('status')).toContainText('실패했습니다');
  await page.unroute('**/api/places?*'); await mockPlaces(page); await pick(page, '도착 공항', '정상 공항');
});
