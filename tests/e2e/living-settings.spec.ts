import { expect, test } from '@playwright/test';
import { settingsSnapshot } from '../fixtures/living-settings';
import { parseSettings } from '../../src/settings/input';
import { calculateSettings } from '../../src/settings/calculate';

test('T11 375px: settings, live recalculation, fixed conflict, save/reload and retry', async ({ page }, testInfo) => {
  let snapshot = structuredClone(settingsSnapshot), writes = 0;
  await page.route('**/api/trips/test/settings', async route => {
    if (route.request().method() === 'PUT') {
      if (++writes === 1) { await route.fulfill({ status: 503, json: { error: '저장 오류. 다시 시도해 주세요.' } }); return; }
      const body = route.request().postDataJSON();
      snapshot = { ...snapshot, revision: String(writes), settings: parseSettings(body.settings, snapshot) };
    }
    await route.fulfill({ json: { snapshot, calculation: calculateSettings(snapshot, snapshot.settings) } });
  });
  await page.route('**/api/trips/test/itinerary', route => route.fulfill({ json: { status: 'CONFLICT', capacity: { unplaced: [] } } }));
  await page.goto('/trips/test/settings');
  await expect(page.getByText(/현지 시각 \(Asia\/Tokyo\)/)).toBeVisible();
  await page.getByLabel('2026-12-02 나가는 시각', { exact: true }).fill('11:00');
  const preview = page.getByRole('region', { name: '시간창 재계산 결과' });
  await expect(preview.getByRole('alert')).toContainText('fixed-museum');
  await page.getByLabel('2026-12-02 끼니 수').selectOption('0');
  await expect(preview.getByText('식사 없음')).toBeVisible();
  await page.getByLabel('택시 정책').selectOption('PREFER');
  await page.getByRole('button', { name: '설정 저장', exact: true }).click();
  await expect(page.getByText('저장 오류. 다시 시도해 주세요.')).toBeVisible();
  await page.getByRole('button', { name: '설정 저장', exact: true }).click();
  await expect(page.getByText('생활 설정을 저장하고 시간창을 재계산했습니다.')).toBeVisible();
  expect(snapshot.fixedVisits).toEqual(settingsSnapshot.fixedVisits);
  await page.reload();
  await expect(page.getByLabel('택시 정책')).toHaveValue('PREFER');
  await expect(page.getByLabel('2026-12-02 끼니 수')).toHaveValue('0');
  await expect(preview.getByRole('alert')).toContainText('fixed-museum');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const box of await page.locator('input,select,button').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, height: r.height }; }))) {
    expect(box.left).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(375); expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({ path: testInfo.outputPath('settings-375.png'), fullPage: true });
  await page.getByLabel('2026-12-02 나가는 시각', { exact: true }).fill('10:00');
  await expect(preview.getByRole('alert')).not.toContainText('fixed-museum');
  await page.getByRole('button', { name: '설정 저장', exact: true }).click();
  await expect(page.getByText('생활 설정을 저장하고 시간창을 재계산했습니다.')).toBeVisible();
});
