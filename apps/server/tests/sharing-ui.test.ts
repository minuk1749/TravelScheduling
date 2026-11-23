import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { colors, typography } from '@travel/design-tokens';
import { installDom } from './helpers/dom';
import { GoogleResultMap } from '../src/components/itinerary/google-map';
import { FixturePlaces } from './fixtures/itinerary';
import { MemoryShares, sharedSnapshot } from './helpers/sharing';
import { SharingService } from '../src/services/sharing';
import { sharingHandlers } from '../src/sharing/http';

test('T14 UI: anonymous timeline and map without editing, rotated link is invalid, retry after failure', async () => {
  const dom = installDom('https://app.example.test');
  const originalFetch = globalThis.fetch, originalMount = GoogleResultMap.prototype.mount;
  let reads = 0;
  GoogleResultMap.prototype.mount = async function(element, points) { element.textContent = points.map(p => `${p.state}: ${p.name}`).join(', '); };
  const service = new SharingService(new MemoryShares(await sharedSnapshot()), () => new FixturePlaces());
  const handlers = sharingHandlers({ userId: async () => undefined, findOwner: async () => null, service: () => service });
  // Owners issue links from the app (POST /share: sharing-http.test.ts and the e2e journey); this page only reads.
  const issue = async () => { const token = await service.rotate('trip', 'owner'); assert.ok(token); return token; };
  const old = await issue(), token = await issue();
  let failRead = false;
  globalThis.fetch = async (url, options) => {
    const request = new Request(new URL(String(url), dom.window.location.origin), options);
    reads++;
    assert.equal(request.method, 'GET');
    assert.equal(options?.credentials, 'omit'); assert.equal(options?.cache, 'no-store');
    assert.equal(request.headers.get('authorization'), null);
    assert.equal(request.referrerPolicy, 'no-referrer');
    if (failRead) { failRead = false; return Response.json({ error: '잠시 후 다시 시도해 주세요.' }, { status: 503 }); }
    return handlers.read(request, new URL(request.url).pathname.split('/').at(-1)!);
  };
  const { render, fireEvent, cleanup } =await import('@testing-library/react');
  const { SharedItineraryPage } = await import('../src/components/itinerary/shared');
  const { default: SharePage } = await import('../src/app/share/[token]/page');
  try {
    const publicView = render(await SharePage({ params: Promise.resolve({ token }) }));
    await publicView.findByText('일정을 만들었습니다');
    assert.ok(publicView.getByRole('heading', { name: '공유 여행 일정', level: 1 }));
    assert.ok(publicView.getByText('읽기 전용 일정'));
    const page = publicView.getByRole('main');
    assert.equal(page.style.getPropertyValue('--share-background'), colors.background);
    assert.equal(page.style.getPropertyValue('--share-primary'), colors.sky.primary);
    assert.equal(page.style.getPropertyValue('--share-font'), typography.family);
    assert.equal(page.style.getPropertyValue('--share-title'), `${typography.title.size}px`);
    assert.ok(publicView.getByRole('region', { name: '날짜별 타임라인' }));
    assert.ok(publicView.getByRole('region', { name: '여행 지도' }));
    assert.ok(publicView.getByText('☆ 희망 sample-teamlab'));
    assert.ok(publicView.getByRole('region', { name: '여행 전체 효율' }));
    assert.equal(publicView.container.querySelector('input, select, textarea, fieldset, button'), null);
    assert.equal(publicView.queryByText(/마커를 선택해 날짜/), null);
    publicView.unmount();
    const revoked = render(React.createElement(SharedItineraryPage, { token: old }));
    assert.match((await revoked.findByRole('alert')).textContent ?? '', /공유 링크가 유효하지 않거나 만료되었습니다/);
    revoked.unmount();
    failRead = true;
    const retry = render(React.createElement(SharedItineraryPage, { token }));
    assert.match((await retry.findByRole('alert')).textContent ?? '', /잠시 후 다시 시도해 주세요/);
    fireEvent.click(retry.getByRole('button', { name: '다시 불러오기' }));
    await retry.findByText('일정을 만들었습니다');
    assert.equal(reads, 4);
  } finally {
    cleanup(); globalThis.fetch = originalFetch; GoogleResultMap.prototype.mount = originalMount;
    await dom.restore();
  }
});
