import { expect, type Page } from '@playwright/test';

export async function pick(page: Page, label: string, name: string) {
  const picker = page.locator('.place-picker').filter({ has: page.getByLabel(label, { exact: true }) });
  await picker.getByRole('textbox').fill(name);
  await picker.getByRole('button', { name: '검색', exact: true }).click();
  await picker.getByRole('button', { name, exact: true }).click();
  await expect(picker.getByText(`선택: ${name}`, { exact: false })).toBeVisible();
}
export async function mockPlaces(page: Page) {
  await page.route('**/api/places?*', async route => {
    const name = new URL(route.request().url()).searchParams.get('query')!;
    await route.fulfill({ json: { places: [{ googlePlaceId: `place-${encodeURIComponent(name).replaceAll('%', '')}`, name,
      attributions: [{ provider: '테스트 제공자', providerUri: 'https://example.test/source' }, { provider: '안전하지 않은 링크', providerUri: 'javascript:alert(1)' }] }], attribution: 'Google Maps' } });
  });
}
