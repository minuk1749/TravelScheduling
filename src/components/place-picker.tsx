'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { PlaceSummary } from '../places';
import { Icon } from './form-rows';

export function safeExternalUrl(value: string): string | undefined {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; }
}
export function PlaceCredits({ place }: { place: PlaceSummary }) {
  return <span className="credits">{place.attributions.map((item, i) => {
    const href = safeExternalUrl(item.providerUri);
    return <span key={i}> · {href ? <a href={href} target="_blank" rel="noopener noreferrer">{item.provider}</a> : item.provider}</span>;
  })}</span>;
}
export function PlacePicker({ label, region, value, onChange, invalid, describedBy, taken }: {
  label: string; region?: string; value?: PlaceSummary; onChange(value: PlaceSummary | undefined): void;
  /** Inline error state owned by the parent form (docs/design.md §3). */
  invalid?: boolean; describedBy?: string;
  /** Place IDs already chosen elsewhere in the same list; shown as "이미 추가함" but still selectable. */
  taken?: ReadonlySet<string>;
}) {
  const id = useId();
  const [query, setQuery] = useState(value?.name ?? '');
  const [results, setResults] = useState<PlaceSummary[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  async function search() {
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); setMessage(''); setResults([]);
    try {
      const params = new URLSearchParams({ query, ...(region ? { regionCode: region } : {}) });
      const response = await fetch(`/api/places?${params}`, { signal: controller.signal, cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw Error(data.error ?? '장소 검색에 실패했습니다.');
      if (controller.signal.aborted) return;
      setResults(data.places); setMessage(data.places.length ? '검색 결과에서 선택해 주세요.' : '검색 결과가 없습니다. 다른 검색어로 시도해 주세요.');
    } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : '장소 검색에 실패했습니다.'); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <div className="place-picker">
    <label htmlFor={id} className="picker-label">{label}</label>
    <div className="search-box" data-invalid={invalid ? 'true' : undefined}><span className="search-icon"><Icon name="search" /></span><input id={id} value={query} maxLength={200} placeholder="장소 이름으로 검색" aria-invalid={invalid || undefined} aria-describedby={describedBy} onChange={event => {
      pending.current?.abort(); setBusy(false); setQuery(event.target.value); setResults([]); setMessage(''); onChange(undefined);
    }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (query.trim()) void search(); } }} />
      <button type="button" className="secondary small" onClick={search} disabled={busy || !query.trim()} aria-busy={busy || undefined}>{busy ? '검색 중…' : '검색'}</button></div>
    <p className="picker-status" role="status">{message}</p>
    {busy && <ul className="search-skeleton" aria-hidden="true"><li /><li /><li /></ul>}
    {results.length > 0 && <ul className="search-results">{results.map(place => <li key={place.googlePlaceId}>
      <button type="button" className="result-row" onClick={() => { onChange(place); setQuery(place.name); setResults([]); setMessage('선택했습니다.'); }}>{place.name}</button>
      {taken?.has(place.googlePlaceId) && <span className="taken-badge"><Icon name="check" size={12} />이미 추가함</span>}<PlaceCredits place={place} />
    </li>)}</ul>}
    {value && <p className="selected-place"><Icon name="check" size={14} />선택: {value.name}<PlaceCredits place={value} /></p>}
    {(results.length > 0 || value) && <p className="credits">Google Maps</p>}
  </div>;
}
