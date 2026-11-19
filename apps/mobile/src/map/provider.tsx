import { createContext, useContext, type ComponentType, type PropsWithChildren } from 'react';
import type { ResultMapProps } from './types';

export type ResultMap = ComponentType<ResultMapProps>;

const MapAdapter = createContext<ResultMap | null>(null);

/** Injects the result map implementation: Google in the app, a fake in component tests. */
export function MapAdapterProvider({ map, children }: PropsWithChildren<{ map: ResultMap }>) {
  return <MapAdapter.Provider value={map}>{children}</MapAdapter.Provider>;
}

export function useResultMap(): ResultMap {
  const map = useContext(MapAdapter);
  if (!map) throw new Error('MapAdapterProvider is missing');
  return map;
}
