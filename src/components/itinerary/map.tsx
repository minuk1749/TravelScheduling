'use client';
import { useEffect, useRef, useState } from 'react';
import type { MapMarker } from '../../results/presentation';
import { GoogleResultMap } from './google-map';
export function ItineraryMap({ points, onSelect }: { points: MapMarker[]; onSelect?: (id: string) => void }) {
  const element = useRef<HTMLDivElement>(null), select = useRef(onSelect);
  const [error, setError] = useState('');
  useEffect(() => { select.current = onSelect; }, [onSelect]);
  useEffect(() => {
    const controller = new AbortController(), map = new GoogleResultMap();
    void map.mount(element.current!, points, id => select.current?.(id), controller.signal)
      .catch(error => { if (!controller.signal.aborted) setError(select.current && error instanceof Error ? error.message : '지도를 불러오지 못했습니다. 아래 목록을 이용해 주세요.'); });
    return () => { controller.abort(); map.dispose(); };
  }, [points]);
  return <section aria-label="여행 지도"><h2>장소 지도</h2><p>● 배치 · ☆ 희망 · △ 미배치 {onSelect && '— 마커를 선택해 날짜를 지정하세요.'}</p><div className="result-map" ref={element} aria-label="Google 여행 지도" />{error && <p role="status">{error}</p>}</section>;
}
