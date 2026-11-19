'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ItineraryResult } from '../../services/itinerary/types';
import { constraintsFrom, type Constraints, type ResultSnapshot, type ResultView } from '../../results/model';
import { parseConstraints } from '../../results/input';
import { mapMarkers } from '../../results/presentation';
import { TripInputError } from '../../trips/input';
import { ItineraryMap } from './map';
import { VisitEditor } from './visit-editor';
import { Diagnostics } from './diagnostics';
import { Efficiency, Timeline } from './timeline';
import { ShareControls } from './share-controls';

export function ItineraryResults({ tripId }: { tripId: string }) {
  const [view, setView] = useState<ResultView | null>(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/trips/${encodeURIComponent(tripId)}/constraints`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? '여행을 불러오지 못했습니다.');
        if (!controller.signal.aborted) setView(data as ResultView);
      }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '연결을 확인해 주세요.'); });
    return () => controller.abort();
  }, [tripId, attempt]);
  const reload = () => { setView(null); setError(''); setAttempt(n => n + 1); };
  if (error) return <><p role="alert">{error}</p><button onClick={reload}>다시 불러오기</button></>;
  if (!view) return <p role="status">여행 정보를 불러오는 중…</p>;
  return <ResultEditor initial={view} tripId={tripId} reload={reload} />;
}

function ResultEditor({ initial, tripId, reload }: { initial: ResultView; tripId: string; reload(): void }) {
  const [view, setView] = useState(initial), [draft, setDraft] = useState(() => constraintsFrom(initial.input));
  const [result, setResult] = useState<ItineraryResult | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null), [message, setMessage] = useState('저장된 설정으로 동선을 생성해 주세요.');
  const inFlight = useRef(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(constraintsFrom(view.input));
  const errors = useMemo(() => {
    try { parseConstraints(draft, view.input); return []; }
    catch (error) { return error instanceof TripInputError ? Object.values(error.fields) : ['입력 내용을 확인해 주세요.']; }
  }, [draft, view.input]);
  const points = useMemo(() => mapMarkers(view, result), [view, result]);
  const change = (next: Constraints) => { setDraft(next); setError(''); setMessage('변경 내용을 저장하고 재검증해 주세요. 표시된 결과는 마지막 계산 기준입니다.'); };
  const select = (id: string) => {
    setSelected(id);
    document.getElementById(`edit-${id}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  };
  async function generate() {
    if (inFlight.current || errors.length) return;
    inFlight.current = true; setBusy(true); setError(''); setResult(null);
    try {
      let expectedHash = view.revision;
      if (dirty) {
        setMessage('변경 내용을 저장하는 중…');
        const saved = await fetch(`/api/trips/${encodeURIComponent(tripId)}/constraints`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: view.revision, constraints: draft }) });
        const data = await saved.json();
        if (!saved.ok) throw new Error(data.fields ? Object.values(data.fields).join(' ') : data.error ?? '저장하지 못했습니다.');
        const snapshot = data as ResultSnapshot;
        expectedHash = snapshot.revision;
        setView({ ...view, ...snapshot }); setDraft(constraintsFrom(snapshot.input));
      }
      setMessage('실제 출발 시각으로 동선을 검증하는 중…');
      const response = await fetch(`/api/trips/${encodeURIComponent(tripId)}/itinerary`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.fields ? `${data.error} ${Object.values(data.fields).join(' ')}` : data.error ?? '동선을 만들지 못했습니다.');
      if (data.inputHash !== expectedHash) throw new Error('다른 곳에서 여행 정보가 바뀌었습니다. 저장된 설정을 다시 불러와 주세요.');
      setResult(data as ItineraryResult); setMessage('저장된 제약으로 재계산했습니다.');
    } catch (error) { setError(error instanceof Error ? error.message : '연결을 확인해 주세요.'); setMessage('입력 내용은 유지됩니다. 다시 시도하거나 저장된 설정을 불러오세요.'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <>
    <p>{view.input.startDate} – {view.input.endDate} · 현지 시각 ({view.input.timeZone})</p>
    <ShareControls tripId={tripId} />
    <p role="status">{message}</p>{error && <p role="alert" className="form-errors">{error}</p>}
    {errors.length > 0 && <p role="alert" className="form-errors">{errors.join(' ')}</p>}
    <div className="result-actions"><button disabled={busy || errors.length > 0} onClick={generate}>{busy ? '계산 중…' : '저장하고 동선 재검증'}</button><button className="secondary" disabled={busy} onClick={reload}>저장된 설정 다시 불러오기</button></div>
    {result && <><Diagnostics result={result} view={view} /><Efficiency result={result} /></>}
    <ItineraryMap points={points} onSelect={select} />
    <p className="credits">장소 정보: Google Maps</p>
    <fieldset className="result-editor" disabled={busy}><legend>일정 수정</legend>
      {result && <Timeline result={result} view={view} constraints={draft} change={change} />}
      <VisitEditor view={view} draft={draft} result={result} selected={selected} change={change} select={select} />
      {draft.legModes.length > 0 && <section aria-label="저장할 이동수단 고정"><h2>이동수단 고정 {draft.legModes.length}개</h2><p>순서가 바뀌어 구간이 사라져도 고정 설정은 남습니다. 해당 구간이 다시 생기면 적용됩니다.</p><button type="button" className="secondary" onClick={() => change({ ...draft, legModes: [] })}>이동수단 고정 모두 해제</button></section>}
    </fieldset>
  </>;
}
