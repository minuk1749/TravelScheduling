import type { GoogleIdentityProvider, SessionStorage } from '../src/auth/ports';
import { createRuntime } from '../src/auth/runtime';

export const session = { token: 'a'.repeat(43), expiresAt: '2099-01-01T00:00:00Z' };

export class MemoryStorage implements SessionStorage {
  constructor(private value: string | null = null) {}
  read = jest.fn(async () => this.value);
  write = jest.fn(async (value: string) => { this.value = value; });
  clear = jest.fn(async () => { this.value = null; });
}

export function fixture(initial: string | null = null) {
  const storage = new MemoryStorage(initial);
  const google: jest.Mocked<GoogleIdentityProvider> = {
    signIn: jest.fn(async () => 'google-id-token'), signOut: jest.fn(async () => {}),
  };
  const transport = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
  const runtime = createRuntime({ storage, google, apiUrl: 'https://travel.example', transport });
  const { auth, api, sessions } = runtime;
  jest.spyOn(sessions, 'create');
  jest.spyOn(sessions, 'revoke');
  return { storage, google, auth, transport, api, sessions, runtime };
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
