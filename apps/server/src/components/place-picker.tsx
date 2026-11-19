'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { PlaceSummary } from '../places';

export function safeExternalUrl(value: string): string | undefined {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; }
}
export function PlaceCredits({ place }: { place: PlaceSummary }) {
  return <span className="credits">{place.attributions.map((item, i) => {
    const href = safeExternalUrl(item.providerUri);
    return <span key={i}> · {href ? <a href={href} target="_blank" rel="noopener noreferrer">{item.provider}</a> : item.provider}</span>;
  })}</span>;
}
export function PlacePicker({ label, region, value, onChange }: {
  label: string; region?: string; value?: PlaceSummary; onChange(value: PlaceSummary | undefined): void;
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
    <label htmlFor={id}>{label}</label>
    <div className="search-row"><input id={id} value={query} maxLength={200} placeholder="장소 이름으로 검색" onChange={event => {
      pending.current?.abort(); setBusy(false); setQuery(event.target.value); setResults([]); setMessage(''); onChange(undefined);
    }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (query.trim()) void search(); } }} />
      <button type="button" onClick={search} disabled={busy || !query.trim()}>{busy ? '검색 중…' : '검색'}</button></div>
    <p className="field-hint" role="status">{message}</p>
    {results.length > 0 && <ul className="search-results">{results.map(place => <li key={place.googlePlaceId}>
      <button type="button" onClick={() => { onChange(place); setQuery(place.name); setResults([]); setMessage('선택했습니다.'); }}>{place.name}</button><PlaceCredits place={place} />
    </li>)}</ul>}
    {value && <p className="selected-place">선택: {value.name}<PlaceCredits place={value} /></p>}
    {(results.length > 0 || value) && <p className="credits">Google Maps</p>}
  </div>;
}
