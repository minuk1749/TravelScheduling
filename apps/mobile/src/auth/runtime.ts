import { ApiClient } from '../api/client';
import { SessionManager } from './session-manager';
import type { GoogleIdentityProvider, SessionApi, SessionStorage } from './ports';

export type AppRuntime = {
  auth: SessionManager;
  api: ApiClient;
  sessions: SessionApi;
  deleteAccount(): Promise<void>;
};

export function createRuntime(deps: {
  storage: SessionStorage; google: GoogleIdentityProvider; apiUrl: string; transport?: typeof fetch;
}): AppRuntime {
  const auth = new SessionManager(deps.storage, deps.google);
  const api = new ApiClient(deps.apiUrl, auth, deps.transport);
  return {
    auth, api,
    deleteAccount: () => api.request<void>('/api/account', { method: 'DELETE', expectNoContent: true }),
    sessions: {
      create: idToken => api.request('/api/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }),
      }, false),
      revoke: () => api.request<void>('/api/session', { method: 'DELETE', expectNoContent: true }),
    },
  };
}
