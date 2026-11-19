import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { errorMessage } from './presentation';

type Resource<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; error: string };

export function useTripResource<T>(load: (signal: AbortSignal) => Promise<T>) {
  const [state, setState] = useState<Resource<T>>({ status: 'loading' });
  const pending = useRef<AbortController | null>(null);
  const retry = useCallback(() => {
    pending.current?.abort();
    const request = new AbortController();
    pending.current = request;
    setState({ status: 'loading' });
    void load(request.signal).then(
      data => { if (!request.signal.aborted) setState({ status: 'ready', data }); },
      error => { if (!request.signal.aborted) setState({ status: 'error', error: errorMessage(error) }); },
    );
  }, [load]);
  useFocusEffect(useCallback(() => {
    retry();
    return () => pending.current?.abort();
  }, [retry]));
  return { state, retry };
}
