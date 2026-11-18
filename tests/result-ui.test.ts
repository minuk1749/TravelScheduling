import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { JSDOM } from 'jsdom';
import { sampleTrip, okVisits, FixturePlaces } from './fixtures/itinerary';
import { service } from './helpers/itinerary-service';
import { applyEdits } from './helpers/result';
import { inputHash } from '../src/repositories/trip-snapshot';
import { parseConstraints } from '../src/results/input';
import { ResultEditService } from '../src/services/itinerary/editing';
import { GoogleResultMap } from '../src/components/itinerary/google-map';
import { MARKER_LABELS } from '../src/results/presentation';

test('T13 UI: markers, wishlist date, comparisons, overflow selection/revalidation, retry, reload and conflicts', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/trips/trip/result' });
  const names = ['self', 'window', 'document', 'navigator', 'HTMLElement', 'Element', 'MutationObserver'] as const;
  const previous = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
  const originalFetch = globalThis.fetch, originalMount = GoogleResultMap.prototype.mount;
  GoogleResultMap.prototype.mount = async function(element, points, select) {
    element.replaceChildren();
    for (const p of points) {
      const marker = document.createElement('button'); marker.textContent = `${MARKER_LABELS[p.state]} ${p.name}`;
      marker.onclick = () => select(p.id); element.append(marker);
    }
  };
  let input = sampleTrip(okVisits.map(v => ({ ...v, minutes: 300 }))), failSave = true, failGeneration = false, generations = 0;
  const editor = new ResultEditService({ loadInputs: async () => ({ status: 'READY', input, inputHash: inputHash(input) }), save: async () => assert.fail('unused') }, new FixturePlaces());
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/constraints')) {
      if (options?.method === 'PUT') {
        if (failSave) { failSave = false; return Response.json({ error: '저장 오류' }, { status: 503 }); }
        const body = JSON.parse(options.body as string); assert.equal(body.revision, inputHash(input));
        input = applyEdits(input, parseConstraints(body.constraints, input));
        return Response.json({ input, revision: inputHash(input) });
      }
      return Response.json(await editor.load(input.id));
    }
    generations++;
    if (failGeneration) { failGeneration = false; return Response.json({ error: '경로 조회 실패' }, { status: 503 }); }
    return Response.json({ ...await service().service.compute(input), inputHash: inputHash(input) });
  };
  const { render, fireEvent, cleanup, within, waitFor } = await import('@testing-library/react');
  const { ItineraryResults } = await import('../src/components/itinerary');
  try {
    const view = render(React.createElement(ItineraryResults, { tripId: 'trip' }));
    await view.findByText('저장된 설정으로 동선을 생성해 주세요.');
    const run = () => fireEvent.click(view.getByRole('button', { name: '저장하고 동선 재검증' }));
    const map = () => within(view.getByRole('region', { name: '여행 지도' }));
    await waitFor(() => assert.ok(map().getByRole('button', { name: '☆ 희망 sample-teamlab' })));
    run(); await view.findByText('필수 장소가 너무 많습니다');
    assert.ok(map().getAllByRole('button').some(b => b.textContent?.startsWith('● 배치')));
    assert.ok(view.getAllByText('대중교통').length > 0); assert.ok(view.getAllByText('택시').length > 0);
    assert.ok(view.getAllByText(/JPY \(추정\)/).length > 0);
    fireEvent.click(view.getByRole('button', { name: '추천 조합 선택' }));
    run(); await view.findByText('저장 오류');
    const selected = view.getAllByRole('checkbox').filter(e => (e as HTMLInputElement).checked).length;
    assert.ok(selected < 6); run(); await view.findByText('일정을 만들었습니다');
    assert.equal(generations, 2);
    // A marker selects its editor, and pinning a wish persists even when the recalculation fails.
    fireEvent.click(map().getByRole('button', { name: '☆ 희망 sample-teamlab' }));
    const name = 'sample-teamlab';
    fireEvent.change(view.getByLabelText(`${name} 날짜`), { target: { value: '2026-12-02' } });
    fireEvent.change(view.getByLabelText(`${name} 시각`), { target: { value: '15:00' } });
    failGeneration = true; run(); await view.findByText('경로 조회 실패');
    assert.equal((view.getByLabelText(`${name} 시각`) as HTMLInputElement).value, '15:00');
    assert.equal(input.visits.find(v => v.id === 'visit-teamlab')?.fixedDate, '2026-12-02');
    run(); await view.findByText('저장된 제약으로 재계산했습니다.');
    fireEvent.click(view.getByRole('button', { name: '저장된 설정 다시 불러오기' }));
    await waitFor(() => assert.equal((view.getByLabelText(`${name} 시각`) as HTMLInputElement).value, '15:00'));
    // A closed-hour pin is a conflict; the UI must not display a plausible timeline as success.
    fireEvent.change(view.getByLabelText('sample-sensoji 날짜'), { target: { value: '2026-12-02' } });
    fireEvent.change(view.getByLabelText('sample-sensoji 시각'), { target: { value: '19:00' } });
    run(); await view.findByText('고정 항목이나 이동 조건에 충돌이 있습니다');
    assert.equal(view.queryByRole('region', { name: '날짜별 타임라인' }), null);
    assert.equal((view.getByLabelText('sample-sensoji 시각') as HTMLInputElement).value, '19:00');
  } finally {
    cleanup(); globalThis.fetch = originalFetch; GoogleResultMap.prototype.mount = originalMount;
    for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
    dom.window.close();
  }
});
