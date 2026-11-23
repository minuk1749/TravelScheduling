import { isShareToken } from '@travel/core/contracts/sharing';
import type { ApiClient } from './client';

const sharePrefix = '/share/';

function isShareLink(body: unknown): body is { path: string } {
  return !!body && typeof body === 'object' && 'path' in body && typeof body.path === 'string'
    && body.path.startsWith(sharePrefix) && isShareToken(body.path.slice(sharePrefix.length));
}

export async function issueShareLink(api: ApiClient, tripId: string, signal: AbortSignal): Promise<string> {
  const { path } = await api.request<{ path: string }>(`/api/trips/${encodeURIComponent(tripId)}/share`, {
    method: 'POST', signal, validate: isShareLink,
  });
  return new URL(path, api.origin()).href;
}
