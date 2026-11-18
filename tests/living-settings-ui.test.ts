import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { JSDOM } from 'jsdom';
import { settingsSnapshot } from './fixtures/living-settings';
import { calculateSettings } from '../src/settings/calculate';
import { parseSettings } from '../src/settings/input';

test('T11 UI edits recalculate immediately, show fixed conflicts, preserve draft on error, save and reload', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/trips/trip/settings' });
  const names = ['self', 'window', 'document', 'navigator', 'HTMLElement', 'Element', 'MutationObserver'] as const;
  const previous = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
  const previousFetch = globalThis.fetch;
  let current = structuredClone(settingsSnapshot), writes = 0, loads = 0;
  globalThis.fetch = async (input, options) => {
    assert.equal(String(input), '/api/trips/trip/settings');
    if (options?.method === 'PUT') {
      writes++;
      if (writes === 1) return Response.json({ error: '일시적인 저장 실패' }, { status: 503 });
      const body = JSON.parse(options.body as string);
      assert.equal(body.revision, current.revision);
      current = { ...current, revision: String(writes), settings: parseSettings(body.settings, current) };
    } else if (++loads === 1) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    return Response.json({ snapshot: current, calculation: calculateSettings(current, current.settings) });
  };
  const { render, fireEvent, cleanup, within, waitFor } = await import('@testing-library/react');
  const { LivingSettings } = await import('../src/components/living-settings');
  try {
    const view = render(React.createElement(LivingSettings, { tripId: 'trip' }));
    await view.findByText('로그인이 필요합니다.'); fireEvent.click(view.getByRole('button', { name: '다시 불러오기' }));
    await view.findByText(/현지 시각 \(Asia\/Tokyo\)/);
    const fill = (name: string, value: string) => fireEvent.change(view.getByLabelText(name, { exact: true }), { target: { value } });
    const preview = () => within(view.getByRole('region', { name: '시간창 재계산 결과' }));
    fill('2026-12-02 나가는 시각', '11:00');
    assert.match(preview().getByRole('alert').textContent ?? '', /fixed-museum/);
    assert.match(preview().getByRole('alert').textContent ?? '', /고정 항목은 이동하거나 해제하지 않았습니다/);
    fill('2026-12-02 나가는 시각', '10:00');
    assert.doesNotMatch(preview().getByRole('alert').textContent ?? '', /fixed-museum/);
    fill('2026-12-02 끼니 수', '0'); assert.equal(preview().getAllByText('식사 없음').length, 1);
    fill('택시 정책', 'PREFER'); fill('점심 시작', '12:00'); fill('점심 종료', '13:00');
    assert.ok(preview().getAllByText('점심: 12:00–13:00').length > 0);
    fill('기본 들어오는 시각', '08:00');
    assert.equal((view.getByRole('button', { name: '설정 저장' }) as HTMLButtonElement).disabled, true);
    assert.equal(view.queryByRole('region', { name: '시간창 재계산 결과' }), null);
    fill('기본 들어오는 시각', '21:00');
    fireEvent.click(view.getByRole('button', { name: '설정 저장' })); await view.findByText('일시적인 저장 실패');
    assert.equal((view.getByLabelText('택시 정책') as HTMLSelectElement).value, 'PREFER');
    fireEvent.click(view.getByRole('button', { name: '설정 저장' })); await view.findByText('생활 설정을 저장하고 시간창을 재계산했습니다.');
    assert.equal(writes, 2); assert.deepEqual(current.fixedVisits, settingsSnapshot.fixedVisits);
    assert.deepEqual(current.settings.days[0].mealSlots, []);
    fireEvent.click(view.getByRole('button', { name: '저장된 설정 다시 불러오기' }));
    await waitFor(() => assert.equal((view.getByLabelText('2026-12-02 끼니 수') as HTMLSelectElement).value, '0'));
    assert.equal((view.getByLabelText('택시 정책') as HTMLSelectElement).value, 'PREFER');
    fireEvent.click(view.getByRole('button', { name: '2026-12-02 기본값으로 되돌리기' }));
    assert.equal((view.getByLabelText('2026-12-02 나가는 시각', { exact: true }) as HTMLInputElement).value, '');
    assert.equal((view.getByLabelText('2026-12-02 끼니 수') as HTMLSelectElement).value, 'inherit');
    fireEvent.click(view.getByRole('button', { name: '변경 취소' }));
    assert.equal((view.getByLabelText('2026-12-02 끼니 수') as HTMLSelectElement).value, '0');
  } finally {
    cleanup(); globalThis.fetch = previousFetch;
    for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
    dom.window.close();
  }
});
