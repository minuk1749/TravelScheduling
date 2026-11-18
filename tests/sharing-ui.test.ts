import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { JSDOM } from 'jsdom';
import { GoogleResultMap } from '../src/components/itinerary/google-map';
import { FixturePlaces } from './fixtures/itinerary';
import { MemoryShares, sharedSnapshot } from './helpers/sharing';
import { SharingService } from '../src/services/sharing';
import { sharingHandlers } from '../src/sharing/http';

test('T14 UI: issue/copy/rotate, anonymous timeline and map without editing, invalid link and retry', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://app.example.test' });
  const names = ['self', 'window', 'document', 'navigator', 'HTMLElement', 'Element', 'MutationObserver'] as const;
  const previous = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
  const originalFetch = globalThis.fetch, originalMount = GoogleResultMap.prototype.mount;
  let copied = '', writes = 0, reads = 0;
  Object.defineProperty(dom.window.navigator, 'clipboard', { value: { writeText: async (text: string) => { copied = text; } } });
  GoogleResultMap.prototype.mount = async function(element, points) { element.textContent = points.map(p => `${p.state}: ${p.name}`).join(', '); };
  const service = new SharingService(new MemoryShares(await sharedSnapshot()), () => new FixturePlaces());
  const handlers = sharingHandlers({ userId: async () => 'owner', findOwner: async () => 'owner', service: () => service });
  let failRead = false, failIssue = false;
  globalThis.fetch = async (url, options) => {
    const request = new Request(new URL(String(url), dom.window.location.origin), options);
    if (request.method === 'POST') {
      writes++;
      if (failIssue) throw new Error('연결 실패');
      return handlers.rotate(request, 'trip');
    }
    reads++; assert.equal(options?.credentials, 'omit'); assert.equal(options?.cache, 'no-store');
    if (failRead) { failRead = false; return Response.json({ error: '잠시 후 다시 시도해 주세요.' }, { status: 503 }); }
    return handlers.read(request, new URL(request.url).pathname.split('/').at(-1)!);
  };
  const { render, fireEvent, cleanup, waitFor } = await import('@testing-library/react');
  const { SharedItineraryPage } = await import('../src/components/itinerary/shared');
  const { ShareControls } = await import('../src/components/itinerary/share-controls');
  try {
    const controls = render(React.createElement(ShareControls, { tripId: 'trip' }));
    const issue = () => fireEvent.click(controls.getByRole('button', { name: '공유 링크 발급·재발급' }));
    issue(); const link = await controls.findByLabelText('공유 링크');
    const old = (link as HTMLInputElement).value;
    fireEvent.click(controls.getByRole('button', { name: '링크 복사' }));
    await waitFor(() => assert.equal(copied, old));
    issue(); await waitFor(() => assert.notEqual((link as HTMLInputElement).value, old));
    const latest = (link as HTMLInputElement).value;
    failIssue = true; issue(); await controls.findByText('연결 실패');
    assert.equal(controls.queryByLabelText('공유 링크'), null, 'uncertain failed rotation clears old link');
    controls.unmount();
    const publicView = render(React.createElement(SharedItineraryPage, { token: latest.split('/').at(-1)! }));
    await publicView.findByText('일정을 만들었습니다');
    assert.ok(publicView.getByRole('region', { name: '날짜별 타임라인' }));
    assert.ok(publicView.getByRole('region', { name: '여행 지도' }));
    assert.ok(publicView.getByText('☆ 희망 sample-teamlab'));
    assert.ok(publicView.getByRole('region', { name: '여행 전체 효율' }));
    assert.equal(publicView.container.querySelector('input, select, textarea, fieldset'), null);
    assert.equal(publicView.queryByText(/마커를 선택해 날짜/), null);
    assert.equal(writes, 3, 'viewing does not mutate');
    publicView.unmount();
    const revoked = render(React.createElement(SharedItineraryPage, { token: old.split('/').at(-1)! }));
    await revoked.findByText('공유 링크가 유효하지 않거나 만료되었습니다.'); revoked.unmount();
    failRead = true;
    const retry = render(React.createElement(SharedItineraryPage, { token: latest.split('/').at(-1)! }));
    await retry.findByText('잠시 후 다시 시도해 주세요.');
    fireEvent.click(retry.getByRole('button', { name: '다시 불러오기' }));
    await retry.findByText('일정을 만들었습니다');
    assert.equal(reads, 4);
  } finally {
    cleanup(); globalThis.fetch = originalFetch; GoogleResultMap.prototype.mount = originalMount;
    for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
    dom.window.close();
  }
});
