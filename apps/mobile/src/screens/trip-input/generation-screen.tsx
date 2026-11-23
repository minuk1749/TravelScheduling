import { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useItineraryGeneration } from '../../api/itinerary-generation';
import type { GeneratedTrip } from '../../api/trips';
import { useResultMap } from '../../map/provider';
import { InitialResult } from '../result/place-panel';
import { OutcomeFlow } from '../result/result-flow';
import { errorMessage } from './presentation';

type Generation = { status: 'loading' } | { status: 'ready'; result: GeneratedTrip } | { status: 'error'; message: string };

export function GenerationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const calculation = useItineraryGeneration(id);
  const ResultMap = useResultMap();
  const [generation, setGeneration] = useState<Generation>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const request = new AbortController();
    void calculation.run(request.signal).then(
      result => { if (!request.signal.aborted) setGeneration({ status: 'ready', result }); },
      error => { if (!request.signal.aborted) setGeneration({ status: 'error', message: errorMessage(error) }); },
    );
    return () => request.abort();
  }, [calculation, attempt]);

  const openTrip = () => router.dismissTo({ pathname: '/trips/[id]', params: { id } });
  const editConditions = () => router.replace({ pathname: '/trips/[id]/settings', params: { id } });
  if (generation.status === 'ready') {
    return <OutcomeFlow key={`${id}:${attempt}`} tripId={id} initial={generation.result} back={openTrip} editConditions={editConditions} />;
  }
  const retry = () => {
    setGeneration({ status: 'loading' });
    setAttempt(value => value + 1);
  };
  return <InitialResult map={ResultMap} back={openTrip} failure={generation.status === 'error'
    ? { message: generation.message, retry, editConditions } : undefined} />;
}
