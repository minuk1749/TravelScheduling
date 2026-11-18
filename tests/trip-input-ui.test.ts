import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { JSDOM } from 'jsdom';
import { cityProfile } from './fixtures/trip-input';
import { parseTripDraft, type TripDraft } from '../src/trips/input';

// Browser-independent interaction regression. Actual 375px layout is tested separately by Playwright.
test('T10 UI flows 2–5: profile, validation, multiple lodgings, edit/remove, back navigation and save retry', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/trips/new' });
  const names = ['self', 'window', 'document', 'navigator', 'HTMLElement', 'Element', 'MutationObserver'] as const;
  const previous = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
  const previousFetch = globalThis.fetch;
  let saved: TripDraft | undefined, writes = 0;
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/city-profiles') return Response.json({ profile: url.searchParams.get('cityCode') === 'TOKYO' ? cityProfile : null });
    if (url.pathname === '/api/places') {
      const name = url.searchParams.get('query')!;
      return Response.json({ places: [{ googlePlaceId: `place-${encodeURIComponent(name).replaceAll('%', '')}`, name, attributions: [{ provider: '안전하지 않은 링크', providerUri: 'javascript:alert(1)' }] }] });
    }
    assert.equal(url.pathname, '/api/trips');
    saved = parseTripDraft(JSON.parse(options?.body as string)); writes++;
    return writes === 1 ? Response.json({ error: '저장 실패. 다시 시도해 주세요.' }, { status: 500 }) : Response.json({ id: 'saved-trip' }, { status: 201 });
  };
  const { render, fireEvent, cleanup, within, waitFor } = await import('@testing-library/react');
  const { TripInputForm } = await import('../src/components/trip-input-form');
  try {
    const view = render(React.createElement(TripInputForm));
    const button = (name: string) => fireEvent.click(view.getByRole('button', { name }));
    const fill = (label: string, value: string) => fireEvent.change(view.getByLabelText(label, { exact: true }), { target: { value } });
    const error = (pattern: RegExp) => assert.match(view.getByRole('alert').textContent ?? '', pattern);
    const pick = async (label: string, name: string) => {
      fill(label, name);
      const picker = within(view.getByLabelText(label, { exact: true }).closest('.place-picker') as HTMLElement);
      fireEvent.click(picker.getByRole('button', { name: '검색' }));
      fireEvent.click(await picker.findByRole('button', { name }));
      assert.match(picker.getByText(`선택: ${name}`, { exact: false }).textContent ?? '', new RegExp(name));
    };
    button('다음'); error(/도시를 입력/);
    fill('도시', 'TOKYO'); await view.findByText('테스트 철도망');
    assert.match(view.getByRole('complementary').textContent ?? '', /추천: 필요할 때만/);
    assert.match(view.getByRole('complementary').textContent ?? '', /2026-11-18/);
    fill('택시 정책', 'NEVER'); fill('여행 시작일', '2026-12-01'); fill('여행 종료일', '2026-11-30');
    button('다음'); error(/1–31일/); fill('여행 종료일', '2026-12-03'); button('다음');
    button('다음'); error(/검색 결과에서 장소/);
    await pick('도착 공항', '테스트 공항'); await pick('출발 공항', '테스트 공항');
    assert.equal(view.container.querySelectorAll('a[href^="javascript:"]').length, 0);
    fill('현지 도착 일시', '2026-12-02T09:00'); button('다음'); error(/도착은 여행 첫날/);
    fill('현지 도착 일시', '2026-12-01T09:00'); button('이전');
    assert.equal((view.getByLabelText('택시 정책') as HTMLSelectElement).value, 'NEVER');
    button('다음'); assert.equal((view.getByLabelText('도착 공항') as HTMLInputElement).value, '테스트 공항'); button('다음');
    await pick('숙소 1 검색', '호텔 A'); fill('체크아웃 1', '2026-12-02'); button('다음'); error(/모든 숙박 날짜/);
    button('숙소 추가'); await pick('숙소 2 검색', '호텔 B'); fill('체크인 2', '2026-12-01'); button('다음'); error(/겹침/);
    fill('체크인 2', '2026-12-02'); button('다음'); button('여행 저장'); error(/하나 이상/); assert.equal(writes, 0);
    button('장소 추가'); await pick('방문 장소 1 검색', '삭제할 장소');
    button('장소 추가'); await pick('방문 장소 2 검색', '미술관');
    button('방문 장소 1 삭제'); assert.equal((view.getByLabelText('방문 장소 1 검색') as HTMLInputElement).value, '미술관');
    fill('체류시간 (분) 1', '0'); button('여행 저장'); error(/1–1,440분/); assert.equal(writes, 0);
    fill('체류시간 (분) 1', '90');
    button('장소 추가'); await pick('방문 장소 2 검색', '미술관'); button('여행 저장'); error(/중복/);
    await pick('방문 장소 2 검색', '식당'); fill('유형 2', 'RESTAURANT'); fill('우선순위 2', 'WISH');
    button('여행 저장'); await waitFor(() => error(/저장 실패/));
    assert.equal((view.getByLabelText('방문 장소 2 검색') as HTMLInputElement).value, '식당');
    button('여행 저장'); await view.findByRole('heading', { name: '여행 입력을 저장했습니다' });
    assert.equal(writes, 2); assert.equal(saved?.taxiPolicy, 'NEVER'); assert.equal(saved?.lodgings.length, 2);
    assert.deepEqual(saved?.visits.map(v => [v.kind, v.minutes, v.priority]), [['ATTRACTION', 90, 'REQUIRED'], ['RESTAURANT', 60, 'WISH']]);
    assert.doesNotMatch(JSON.stringify(saved), /호텔 A|호텔 B|ownerId/);
    cleanup();
    const { CityProfileCard } = await import('../src/components/city-profile-card');
    let resolveTokyo: (response: Response) => void = () => {};
    globalThis.fetch = async input => new URL(String(input), 'http://localhost').searchParams.get('cityCode') === 'TOKYO'
      ? new Promise<Response>(resolve => { resolveTokyo = resolve; }) : Response.json({ profile: null });
    const card = render(React.createElement(CityProfileCard, { cityCode: 'TOKYO' }));
    card.rerender(React.createElement(CityProfileCard, { cityCode: 'PARIS' }));
    await card.findByText('이 도시의 이동·택시 요금 정보 없음');
    resolveTokyo(Response.json({ profile: cityProfile }));
    await waitFor(() => assert.equal(card.queryByText('테스트 철도망'), null));
    assert.match(card.getByRole('complementary').textContent ?? '', /기본 추천/);
    let profileAttempts = 0;
    globalThis.fetch = async () => ++profileAttempts === 1
      ? Response.json({ error: '로그인 후 다시 시도해 주세요.' }, { status: 401 }) : Response.json({ profile: cityProfile });
    card.rerender(React.createElement(CityProfileCard, { cityCode: 'OSAKA' }));
    await card.findByRole('alert'); fireEvent.click(card.getByRole('button', { name: '다시 불러오기' }));
    await card.findByText('테스트 철도망');

  } finally {
    cleanup(); globalThis.fetch = previousFetch;
    for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
    dom.window.close();
  }
});
