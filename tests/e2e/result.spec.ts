import { expect, test } from '@playwright/test';
import { sampleTrip, FixturePlaces } from '../fixtures/itinerary';
import { service } from '../helpers/itinerary-service';
import { applyEdits } from '../helpers/result';
import { inputHash } from '../../src/repositories/trip-snapshot';
import { parseConstraints } from '../../src/results/input';
import { ResultEditService } from '../../src/services/itinerary/editing';

test('T13 375px result: wishlist pin, manual mode, reload, timeline and no horizontal overflow', async ({ page }, testInfo) => {
  let input = sampleTrip();
  const editor = new ResultEditService({ loadInputs: async () => ({ status: 'READY', input, inputHash: inputHash(input) }), save: async () => null }, new FixturePlaces());
  await page.route('**/api/trips/test/constraints', async route => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON();
      input = applyEdits(input, parseConstraints(body.constraints, input));
      await route.fulfill({ json: { input, revision: inputHash(input) } }); return;
    }
    await route.fulfill({ json: await editor.load(input.id) });
  });
  await page.route('**/api/trips/test/itinerary', async route => route.fulfill({ json: { ...await service().service.compute(input), inputHash: inputHash(input) } }));
  await page.goto('/trips/test/result');
  await page.getByRole('button', { name: '저장하고 동선 재검증' }).click();
  await expect(page.getByText('일정을 만들었습니다')).toBeVisible();
  await page.getByLabel('sample-teamlab 날짜').fill('2026-12-02');
  await page.getByLabel('sample-teamlab 시각').fill('15:00');
  await page.getByLabel('sample-teamlab 순서').fill('1');
  await page.getByRole('button', { name: '저장하고 동선 재검증' }).click();
  await expect(page.getByText('일정을 만들었습니다')).toBeVisible();
  const mode = page.getByRole('region', { name: '날짜별 타임라인' }).locator('select').first();
  await mode.selectOption('TRANSIT');
  await page.getByRole('button', { name: '저장하고 동선 재검증' }).click();
  await expect(page.getByText('일정을 만들었습니다')).toBeVisible();
  await expect(mode).toHaveValue('TRANSIT');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('result-375.png'), fullPage: true });
  await page.reload();
  await expect(page.getByLabel('sample-teamlab 시각')).toHaveValue('15:00');
  await expect(page.getByLabel('sample-teamlab 순서')).toHaveValue('1');
  await page.getByRole('button', { name: '저장하고 동선 재검증' }).click();
  await expect(page.getByText('일정을 만들었습니다')).toBeVisible();
  await expect(mode).toHaveValue('TRANSIT');
});
