'use client';
import { useEffect, useState } from 'react';
import type { CityProfile } from '../fare';
import { safeExternalUrl } from './place-picker';

export function CityProfileCard({ cityCode }: { cityCode: string }) {
  const [result, setResult] = useState<{ code: string; profile: CityProfile | null } | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setError(''); setResult(null);
      try {
        const response = await fetch(`/api/city-profiles?${new URLSearchParams({ cityCode })}`, { signal: controller.signal, cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw Error(data.error ?? '이동 프로필을 불러오지 못했습니다.');
        if (!controller.signal.aborted) setResult({ code: cityCode, profile: data.profile });
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '이동 프로필을 불러오지 못했습니다.'); }
    }
    if (cityCode) void load();
    return () => controller.abort();
  }, [cityCode, retry]);
  if (!cityCode) return null;
  const profile = result?.code === cityCode ? result.profile : null;
  const source = profile ? safeExternalUrl(profile.source) : undefined;
  return <aside className="profile-card" aria-label="도시 이동 프로필" aria-live="polite">
    <h3>도시 이동 프로필</h3>
    {error ? <p role="alert">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>다시 불러오기</button></p>
      : !result ? <p>프로필을 불러오는 중…</p> : !profile ? <p>이 도시의 이동·택시 요금 정보 없음</p> : <>
        <dl><dt>대중교통</dt><dd>{profile.transitCoverage ?? '정보 없음'}</dd>
          <dt>운행 시간</dt><dd>{profile.transitHours ?? '정보 없음'}</dd>
          <dt>택시 추정 요금</dt><dd>{profile.taxiBaseFare === null || profile.taxiFarePerKm === null || profile.taxiFarePerMinute === null ? '정보 없음' : `기본 ${profile.taxiBaseFare} + km당 ${profile.taxiFarePerKm} + 분당 ${profile.taxiFarePerMinute} ${profile.currency}`}</dd>
          <dt>호출·대기</dt><dd>{profile.callBufferMinutes === null ? '정보 없음' : `약 ${profile.callBufferMinutes}분`}</dd>
          <dt>차량 호출 앱</dt><dd>{profile.rideHailingApps.join(', ') || '정보 없음'}</dd></dl>
        {profile.nightSurcharge !== null && <p>심야 {profile.nightStart}–{profile.nightEnd}: {profile.nightSurcharge * 100}% 할증</p>}
        <p className="credits">출처: {source ? <a href={source} target="_blank" rel="noopener noreferrer">{profile.source}</a> : profile.source} · 갱신 {profile.updatedAt.slice(0, 10)}</p>
      </>}
    <p><strong>{profile ? '추천' : '기본 추천'}: 필요할 때만</strong></p>
    <p className="field-hint">대중교통·도보를 우선하고, 경로가 없거나 짐을 옮길 때 택시를 고려합니다.
      {profile?.efficiencyThreshold != null ? ` 20분 이상 절약하고 추가 비용이 절약한 1분당 ${profile.efficiencyThreshold} ${profile.currency} 이하일 때도 택시를 선택합니다.` : ' 요금 정보가 없으면 비용 효율은 비교할 수 없습니다.'}
      {' '}구간별 시간·요금 비교는 동선 생성 후 제공됩니다.</p>
  </aside>;
}
