import { SessionManager } from '../src/auth/session-manager';
import { deferred, fixture, json, session } from './helpers';

test('Google ID token exchange persists only the issued session and restores it after restart', async () => {
  const f = fixture();
  f.transport.mockResolvedValue(json(session, 201));
  await f.auth.restore();
  await f.auth.signIn(f.sessions);
  expect(f.google.signIn).toHaveBeenCalledTimes(1);
  expect(f.sessions.create).toHaveBeenCalledWith('google-id-token');
  expect(f.storage.write).toHaveBeenCalledWith(JSON.stringify(session));
  expect(f.auth.getSnapshot()).toEqual({ status: 'signedIn', busy: false, error: null });
  const restarted = new SessionManager(f.storage, f.google);
  await restarted.restore();
  expect(await restarted.accessToken()).toBe(session.token);
  expect(restarted.getSnapshot().status).toBe('signedIn');
});

test.each(['bad json', JSON.stringify({ token: 'bad', expiresAt: session.expiresAt }),
  JSON.stringify({ ...session, expiresAt: '2000-01-01T00:00:00Z' }),
  JSON.stringify({ ...session, expiresAt: '2099-01-01T00:00:00' }),
])('invalid or expired storage is deleted: %s', async raw => {
  const f = fixture(raw);
  await f.auth.restore();
  expect(f.auth.getSnapshot().status).toBe('signedOut');
  expect(await f.storage.read()).toBeNull();
});

test('expires during use, removes the session and never sends a request', async () => {
  const f = fixture(JSON.stringify(session));
  const now = jest.fn(() => Date.parse('2098-12-31T23:59:59Z'));
  const auth = new SessionManager(f.storage, f.google, now);
  await auth.restore();
  now.mockReturnValue(Date.parse(session.expiresAt));
  expect(await auth.accessToken()).toBeNull();
  expect(auth.getSnapshot().status).toBe('signedOut');
  expect(await f.storage.read()).toBeNull();
});

test('cancelled Google login does not call the API or store credentials', async () => {
  const f = fixture();
  f.google.signIn.mockResolvedValue(null);
  await f.auth.restore();
  await f.auth.signIn(f.sessions);
  expect(f.sessions.create).not.toHaveBeenCalled();
  expect(f.storage.write).not.toHaveBeenCalled();
  expect(f.auth.getSnapshot()).toMatchObject({ status: 'signedOut', error: null, busy: false });
});

test.each([json({ code: 'INVALID_GOOGLE_TOKEN', error: '다시 로그인해 주세요.' }, 401),
  json({ code: 'PROVIDER_UNAVAILABLE', error: '잠시 후 다시 시도해 주세요.' }, 503),
  json({ token: 'invalid', expiresAt: session.expiresAt }, 201),
])('unsuccessful exchange never authenticates or persists a token', async response => {
  const f = fixture();
  f.transport.mockResolvedValue(response);
  await f.auth.restore();
  await f.auth.signIn(f.sessions);
  expect(f.auth.getSnapshot()).toMatchObject({ status: 'signedOut', busy: false });
  expect(f.auth.getSnapshot().error).toBeTruthy();
  expect(f.storage.write).not.toHaveBeenCalled();
});

test('duplicate taps issue only one native login and one exchange', async () => {
  const f = fixture();
  const pending = deferred<string | null>();
  f.google.signIn.mockReturnValue(pending.promise);
  f.transport.mockResolvedValue(json(session));
  await f.auth.restore();
  const first = f.auth.signIn(f.sessions);
  await f.auth.signIn(f.sessions);
  expect(f.auth.getSnapshot().busy).toBe(true);
  pending.resolve('id-token');
  await first;
  expect(f.google.signIn).toHaveBeenCalledTimes(1);
  expect(f.sessions.create).toHaveBeenCalledTimes(1);
});

test.each([false, true])('logout clears local storage even if server revoke fails: %s', async fail => {
  const f = fixture(JSON.stringify(session));
  if (fail) f.transport.mockRejectedValue(new Error('offline'));
  else f.transport.mockResolvedValue(new Response(null, { status: 204 }));
  await f.auth.restore();
  await f.auth.signOut(f.sessions);
  expect(f.sessions.revoke).toHaveBeenCalledTimes(1);
  expect(f.transport.mock.calls[0][1]?.method).toBe('DELETE');
  expect(f.google.signOut).toHaveBeenCalledTimes(1);
  expect(await f.storage.read()).toBeNull();
  expect(await f.auth.accessToken()).toBeNull();
  expect(f.auth.getSnapshot().status).toBe('signedOut');
});

test('secure-store read/delete failures block access until deletion is retried', async () => {
  const f = fixture(JSON.stringify(session));
  f.storage.read.mockRejectedValueOnce(new Error('locked'));
  await f.auth.restore();
  expect(f.auth.getSnapshot().status).toBe('storageError');
  f.storage.clear.mockRejectedValueOnce(new Error('locked'));
  await f.auth.retryStorage();
  expect(f.auth.getSnapshot().status).toBe('storageError');
  await f.auth.signIn(f.sessions);
  expect(f.google.signIn).not.toHaveBeenCalled();
  await f.auth.retryStorage();
  expect(f.auth.getSnapshot().status).toBe('signedOut');
  expect(await f.storage.read()).toBeNull();
});

test('failed credential write never opens the authenticated screen', async () => {
  const f = fixture();
  f.transport.mockResolvedValue(json(session));
  f.storage.write.mockRejectedValueOnce(new Error('storage full'));
  await f.auth.restore();
  await f.auth.signIn(f.sessions);
  expect(await f.auth.accessToken()).toBeNull();
  expect(f.auth.getSnapshot()).toMatchObject({ status: 'signedOut', busy: false });
  expect(f.auth.getSnapshot().error).toContain('안전하게 저장');
});
