'use client';
import { useEffect, useMemo, useState } from 'react';
import type { SharedItinerary } from '../../sharing/model';
import { mapMarkers, MARKER_LABELS } from '../../results/presentation';
import { Diagnostics } from './diagnostics';
import { ItineraryMap } from './map';
import { Efficiency, Timeline } from './timeline';

export function SharedItineraryPage({ token }: { token: string }) {
  const [shared, setShared] = useState<SharedItinerary | null>(null), [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/share/${encodeURIComponent(token)}`, { cache: 'no-store', credentials: 'omit', signal: controller.signal, referrerPolicy: 'no-referrer' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? '공유 일정을 불러오지 못했습니다.');
        if (!controller.signal.aborted) setShared(data as SharedItinerary);
      }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '연결을 확인해 주세요.'); });
    return () => controller.abort();
  }, [token, attempt]);
  const points = useMemo(() => shared ? mapMarkers(shared.view, shared.result) : [], [shared]);
  if (error) return <><p role="alert">{error}</p><button type="button" onClick={() => { setShared(null); setError(''); setAttempt(n => n + 1); }}>다시 불러오기</button></>;
  if (!shared) return <p role="status">공유 일정을 불러오는 중…</p>;
  const { view, result } = shared;
  return <>
    <p className="share-period">{view.input.startDate} – {view.input.endDate} · 현지 시각 ({view.input.timeZone})</p>
    <Diagnostics result={result} view={view} readOnly /><Efficiency result={result} />
    <ItineraryMap points={points} />
    <section aria-label="장소 목록"><h2>장소 목록</h2><ul>{points.map(point => <li key={point.id}>{MARKER_LABELS[point.state]} {point.name}</li>)}</ul></section>
    <p className="credits">장소 정보: Google Maps</p>
    {Object.entries(view.places).flatMap(([id, place]) => place?.attributions.map((attribution, index) =>
      <p className="credits" key={`${id}-${index}`}>{attribution.provider}</p>) ?? [])}
    <Timeline result={result} view={view} />
  </>;
}
