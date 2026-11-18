'use client';
import { useEffect, useState } from 'react';
import type { SettingsView } from '../../settings/model';
import { LivingSettingsForm } from './form';
export function LivingSettings({ tripId }: { tripId: string }) {
  const [view, setView] = useState<SettingsView | null>(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/trips/${encodeURIComponent(tripId)}/settings`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? '설정을 불러오지 못했습니다.');
        if (!controller.signal.aborted) setView(data as SettingsView);
      }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '연결을 확인해 주세요.'); });
    return () => controller.abort();
  }, [tripId, attempt]);
  const reload = () => { setView(null); setError(''); setAttempt(value => value + 1); };
  if (error) return <div><p role="alert" className="form-errors">{error}</p><button onClick={reload}>다시 불러오기</button></div>;
  if (!view) return <p role="status">생활 설정을 불러오는 중…</p>;
  return <LivingSettingsForm tripId={tripId} initial={view} reload={reload} />;
}
