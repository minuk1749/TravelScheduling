'use client';
import { useEffect, useState } from 'react';
import type { ItineraryResult } from '../../services/itinerary/types';
import { REASONS } from '../../results/presentation';

/** Saving settings now reuses the full T12 pipeline, including route/meal/taxi constraints. */
export function SettingsItineraryPreview({ tripId }: { tripId: string }) {
  const [result, setResult] = useState<ItineraryResult | null>(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/trips/${encodeURIComponent(tripId)}/itinerary`, { method: 'POST', signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? '전체 동선을 재계산하지 못했습니다.');
        if (!controller.signal.aborted) setResult(data as ItineraryResult);
      }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '연결을 확인해 주세요.'); });
    return () => controller.abort();
  }, [tripId, attempt]);
  if (error) return <section><p role="alert">생활 설정은 저장되었지만 동선 재계산에 실패했습니다. {error}</p><button onClick={() => { setError(''); setAttempt(n => n + 1); }}>전체 동선 다시 계산</button></section>;
  if (!result) return <p role="status">저장된 생활 설정으로 전체 동선을 재계산하는 중…</p>;
  return <section aria-label="전체 동선 재계산"><h2>전체 동선 재계산</h2><p role={result.status === 'OK' ? 'status' : 'alert'}>{result.status === 'OK' ? '이동시간과 영업시간까지 검증했습니다.' : result.status === 'OVER_CAPACITY' ? '수용량 초과: 결과 화면에서 필수 장소를 선택해 주세요.' : '고정 항목 또는 이동 조건 충돌: 고정 내용을 유지했습니다. 결과 화면에서 조정해 주세요.'}</p>
    <ul>{result.capacity.unplaced.map(item => <li key={item.visitId}>{item.visitId}: {REASONS[item.reason]}</li>)}</ul>
    <a href={`/trips/${encodeURIComponent(tripId)}/result`}>지도와 타임라인에서 확인하기</a>
  </section>;
}
