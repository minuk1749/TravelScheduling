import { expect, test } from '@playwright/test';
import { SharingService } from '../../src/services/sharing';
import { sharingHandlers } from '../../src/sharing/http';
import { MemoryShares, sharedSnapshot } from '../helpers/sharing';
import { FixturePlaces } from '../fixtures/itinerary';

test('T14 375px anonymous share is read-only, no-referrer/noindex, rotation expires old link', async ({ page }, testInfo) => {
  const service = new SharingService(new MemoryShares(await sharedSnapshot()), () => new FixturePlaces());
  const handlers = sharingHandlers({ userId: async () => undefined, findOwner: async () => null, service: () => service });
  const token = await service.rotate('trip', 'owner');
  await page.route('**/api/share/*', async route => {
    const request = route.request();
    expect(request.headers()['cookie']).toBeUndefined();
    expect(request.headers()['referer']).toBeUndefined();
    const response = await handlers.read(new Request(request.url()), request.url().split('/').at(-1)!);
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
  });
  await page.goto(`/share/${token}`);
  await expect(page.getByText('일정을 만들었습니다')).toBeVisible();
  await expect(page.getByRole('region', { name: '날짜별 타임라인' })).toBeVisible();
  await expect(page.getByText('☆ 희망 sample-teamlab')).toBeVisible();
  await expect(page.locator('input, select, textarea, fieldset')).toHaveCount(0);
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('share-375.png'), fullPage: true });
  const next = await service.rotate('trip', 'owner');
  await page.reload();
  await expect(page.getByRole('alert')).toHaveText('공유 링크가 유효하지 않거나 만료되었습니다.');
  await page.goto(`/share/${next}`);
  await expect(page.getByText('일정을 만들었습니다')).toBeVisible();
  // Real route exports expose GET only; Next rejects these before calling any providers.
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    expect((await page.request.fetch(`/api/share/${next}`, { method })).status()).toBe(405);
  }
});
