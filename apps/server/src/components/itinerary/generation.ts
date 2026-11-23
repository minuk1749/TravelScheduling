import { useMemo } from 'react';
import { ITINERARY_REQUEST_HEADER, type ItineraryResult } from '@travel/core/contracts/itinerary';
import type { ResultView } from '../../results/model';
import { newItineraryRequestId } from './request-id';

export async function loadResultView(tripId: string, signal?: AbortSignal): Promise<ResultView> {
  const response = await fetch(`/api/trips/${encodeURIComponent(tripId)}/constraints`, { cache: 'no-store', signal });
  const view = await response.json();
  if (!response.ok) throw new Error(view.error ?? '여행을 불러오지 못했습니다.');
  if (typeof view?.revision !== 'string' || !view.revision) throw new Error('여행 입력을 확인하지 못했습니다. 다시 시도해 주세요.');
  return view;
}

class ItineraryGeneration {
  private pendingId: string | null = null;

  constructor(private readonly tripId: string) {}

  reset() { this.pendingId = null; }

  async generate({ expectedRevision, signal }: { expectedRevision?: string; signal?: AbortSignal }): Promise<ItineraryResult> {
    const retry = this.pendingId !== null;
    this.pendingId ??= newItineraryRequestId();
    const response = await fetch(`/api/trips/${encodeURIComponent(this.tripId)}/itinerary`, {
      method: 'POST', headers: { [ITINERARY_REQUEST_HEADER]: this.pendingId }, signal,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.fields ? `${result.error} ${Object.values(result.fields).join(' ')}` : result.error ?? '동선을 만들지 못했습니다.');
    signal?.throwIfAborted();
    // Keep the key until the recovered response and its current input have both been read.
    const current = retry ? await loadResultView(this.tripId, signal) : undefined;
    signal?.throwIfAborted();
    this.reset();
    if ((current && result.inputHash !== current.revision) ||
        (expectedRevision !== undefined && result.inputHash !== expectedRevision)) {
      throw new Error('다른 곳에서 여행 정보가 바뀌었습니다. 저장된 설정을 다시 불러와 주세요.');
    }
    return result;
  }
}

export function useItineraryGeneration(tripId: string) {
  return useMemo(() => new ItineraryGeneration(tripId), [tripId]);
}
