import { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Text } from 'react-native';
import { useTripApi, type GeneratedTrip } from '../../api/trips';
import { ActionButton } from '../../components/action-button';
import { FormCard, FormError, FormScreen } from '../../components/input/form-layout';
import { colors, text } from '../../theme';
import { errorMessage } from './presentation';

type Generation = { status: 'loading' } | { status: 'ready'; result: GeneratedTrip } | { status: 'error'; message: string };

export function GenerationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const api = useTripApi();
  const [generation, setGeneration] = useState<Generation>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    void api.generate(id).then(
      result => { if (current) setGeneration({ status: 'ready', result }); },
      error => { if (current) setGeneration({ status: 'error', message: errorMessage(error) }); },
    );
    return () => { current = false; };
  }, [api, id, attempt]);

  const openTrip = () => router.dismissTo({ pathname: '/trips/[id]', params: { id } });
  return <FormScreen title="동선 만들기" back={openTrip} footer={<>
    {generation.status !== 'loading' && <ActionButton label="다시 계산" onPress={() => {
      setGeneration({ status: 'loading' }); setAttempt(value => value + 1);
    }} />}
    <ActionButton label="저장한 여행 보기" secondary onPress={openTrip} />
  </>}>
    <FormCard>
      {generation.status === 'loading' && <>
        <ActivityIndicator color={colors.sky.primary} />
        <Text accessibilityLiveRegion="polite" style={text.body}>동선을 만드는 중</Text>
      </>}
      {generation.status === 'error' && <><FormError message={generation.message} /><Text style={text.body}>여행 입력은 저장되어 있어요.</Text></>}
      {generation.status === 'ready' && <GenerationStatus result={generation.result} />}
    </FormCard>
  </FormScreen>;
}

function GenerationStatus({ result }: { result: GeneratedTrip }) {
  if (result.status === 'OVER_CAPACITY') return <Text style={text.body}>◷ 시간이 부족해요</Text>;
  if (result.status === 'CONFLICT') return <FormError message="고정 조건이나 이동 시간을 다시 확인해 주세요." />;
  return <Text accessibilityLiveRegion="polite" style={text.body}>✓ 동선을 저장했어요</Text>;
}
