import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { installDom } from './helpers/dom';
import { itineraryReplay } from './helpers/itinerary-replay';
import { settingsSnapshot } from './fixtures/living-settings';
import { calculateSettings } from '../src/settings/calculate';
import { parseSettings } from '../src/settings/input';

test('T11 UI edits recalculate immediately, show fixed conflicts, preserve draft on error, save and reload', async () => {
  const dom = installDom('http://localhost/trips/trip/settings');
  const previousFetch = globalThis.fetch;
  let current = structuredClone(settingsSnapshot), writes = 0, loads = 0;
  globalThis.fetch = async (input, options) => {
    if (String(input).endsWith('/itinerary')) return Response.json({ status: 'CONFLICT', capacity: { unplaced: [{ visitId: 'fixed-museum', reason: 'TIME_WINDOW', fixed: true }] } });
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
    await view.findByText('고정 항목 또는 이동 조건 충돌: 고정 내용을 유지했습니다. 결과 화면에서 조정해 주세요.');
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
    await dom.restore();
  }
});

test('T27 settings preview detects a reservation changed after response loss and can start a fresh calculation', async () => {
  const dom = installDom('http://localhost/trips/trip/settings');
  const previousFetch = globalThis.fetch;
  const api = itineraryReplay();
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/constraints?fields=revision') && api.keys.length === 2) {
      return Response.json({ error: '현재 입력 조회 실패' }, { status: 503 });
    }
    return api.fetch(url, options);
  };
  const { render, fireEvent, cleanup } = await import('@testing-library/react');
  const { SettingsItineraryPreview } = await import('../src/components/living-settings/itinerary-preview');
  try {
    const view = render(React.createElement(SettingsItineraryPreview, { tripId: 'trip' }));
    await view.findByText(/응답 본문 유실/);
    api.changeReservation();
    const retry = () => fireEvent.click(view.getByRole('button', { name: '전체 동선 다시 계산' }));
    retry();
    await view.findByText(/현재 입력 조회 실패/);
    assert.equal(view.queryByText('이동시간과 영업시간까지 검증했습니다.'), null);
    retry();
    await view.findByText(/다른 곳에서 여행 정보가 바뀌었습니다/);
    assert.deepEqual(api.keys, [api.keys[0], api.keys[0], api.keys[0]]);
    assert.equal(view.queryByText('이동시간과 영업시간까지 검증했습니다.'), null);
    assert.equal(view.queryByRole('link', { name: '지도와 타임라인에서 확인하기' }), null);
    retry();
    await view.findByText('이동시간과 영업시간까지 검증했습니다.');
    assert.notEqual(api.keys[3], api.keys[0]);
  } finally {
    cleanup(); globalThis.fetch = previousFetch;
    await dom.restore();
  }
});
