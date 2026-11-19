import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { cities } from '@travel/core/contracts/trips/input';
import { useTripApi, type ProfileView } from '../../api/trips';
import { SmallButton } from '../../components/input/fields';
import { FormError, form } from '../../components/input/form-layout';
import { ExternalText } from '../../components/input/place-search';
import { text } from '../../theme';
import { errorMessage, taxiLabels } from './presentation';

export function CityTransport({ cityCode }: { cityCode: string }) {
  const api = useTripApi();
  const [data, setData] = useState<ProfileView | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!cityCode) return;
    const request = new AbortController();
    const timer = setTimeout(() => {
      void api.profile(cityCode, request.signal).then(
        result => { if (!request.signal.aborted) setData(result); },
        failure => { if (!request.signal.aborted) setError(errorMessage(failure)); },
      );
    }, cities.some(city => city.code === cityCode) ? 0 : 300);
    return () => { clearTimeout(timer); request.abort(); };
  }, [api, cityCode, attempt]);

  if (!cityCode) return null;
  if (error) return <><FormError message={error} /><SmallButton label="이동 정보 다시 불러오기"
    onPress={() => { setError(''); setAttempt(attempt + 1); }} /></>;
  if (!data) return <Text style={text.body} accessibilityLiveRegion="polite">이동 정보를 불러오는 중</Text>;
  const { profile, recommendedPolicy } = data;
  const fare = profile && [profile.taxiBaseFare, profile.taxiFarePerKm, profile.taxiFarePerMinute].every(value => value !== null)
    ? `약 ${profile.taxiBaseFare} 기본 + ${profile.taxiFarePerKm}/km + ${profile.taxiFarePerMinute}/분 ${profile.currency}` : '—';
  return <>
    <Text accessibilityRole="header" style={text.place}>도시 이동 비교</Text>
    <Text style={text.body}>▣ 대중교통 · 이동시간 — · 요금 —</Text>
    {profile?.transitCoverage && <Text style={form.secondary}>{profile.transitCoverage}</Text>}
    {profile?.transitHours && <Text style={form.secondary}>운행 {profile.transitHours}</Text>}
    <Text style={text.body}>◈ 택시 · 이동시간 — · 요금 {fare}</Text>
    {profile?.callBufferMinutes != null && <Text style={form.secondary}>호출·대기 약 {profile.callBufferMinutes}분</Text>}
    <Text style={text.body}>↟ 도보 · 이동시간 — · 무료</Text>
    <Text style={text.place}>{profile ? '추천' : '기본 추천'} · {taxiLabels[recommendedPolicy]}</Text>
    {profile && <ExternalText url={profile.source}>{`요금 출처 · ${profile.updatedAt.slice(0, 10)}`}</ExternalText>}
  </>;
}
