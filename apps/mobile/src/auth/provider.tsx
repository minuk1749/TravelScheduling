import { createContext, useContext, useEffect, useSyncExternalStore, type PropsWithChildren } from 'react';
import type { AppRuntime } from './runtime';

const RuntimeContext = createContext<AppRuntime | null>(null);

export function AuthProvider({ runtime, children }: PropsWithChildren<{ runtime: AppRuntime }>) {
  useEffect(() => { void runtime.auth.restore(); }, [runtime]);
  return <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>;
}

export function useRuntime() {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error('AuthProvider is required');
  return runtime;
}

export function useAuth() {
  const runtime = useRuntime();
  return useSyncExternalStore(runtime.auth.subscribe, runtime.auth.getSnapshot, runtime.auth.getSnapshot);
}
