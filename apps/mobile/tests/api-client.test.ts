import { ApiClient, ApiFailure } from '../src/api/client';
import { deferred, fixture, json, session } from './helpers';

test('configured server URL, JSON body, Bearer token, no cookies and no redirect forwarding', async () => {
  const f = fixture(JSON.stringify(session));
  await f.auth.restore();
  f.transport.mockResolvedValue(json({ id: 'trip' }));
  const result = await f.api.request('/api/trips', { method: 'POST', body: '{}' });
  expect(result).toEqual({ id: 'trip' });
  const [url, options] = f.transport.mock.calls[0];
  expect(url).toBe('https://travel.example/api/trips');
  expect(new Headers(options?.headers).get('Authorization')).toBe(`Bearer ${session.token}`);
  expect(options).toMatchObject({ method: 'POST', body: '{}', credentials: 'omit', redirect: 'error', cache: 'no-store' });
});

test('session exchange sends the ID token as JSON without a Bearer header', async () => {
  const f = fixture();
  f.transport.mockResolvedValue(json(session));
  await f.auth.restore();
  await f.auth.signIn(f.sessions);
  const [url, options] = f.transport.mock.calls[0];
  expect(url).toBe('https://travel.example/api/session');
  expect(options?.body).toBe(JSON.stringify({ idToken: 'google-id-token' }));
  expect(new Headers(options?.headers).get('Authorization')).toBeNull();
  expect(new Headers(options?.headers).get('Content-Type')).toBe('application/json');
});

test('401 clears credentials before processing even an empty response', async () => {
  const f = fixture(JSON.stringify(session));
  await f.auth.restore();
  f.transport.mockResolvedValue(new Response('', { status: 401 }));
  await expect(f.api.request('/api/trips/id')).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
  expect(f.auth.getSnapshot().status).toBe('signedOut');
  expect(await f.storage.read()).toBeNull();
  await expect(f.api.request('/api/trips/id')).rejects.toBeInstanceOf(ApiFailure);
  expect(f.transport).toHaveBeenCalledTimes(1);
});

test.each([['field'], { field: '입력이 필요해요' }])('error codes and both fields formats survive a 409', async fields => {
  const f = fixture(JSON.stringify(session));
  await f.auth.restore();
  f.transport.mockResolvedValue(json({ code: 'INCOMPLETE_TRIP', error: '입력을 보완해 주세요.', fields }, 409));
  await expect(f.api.request('/api/trips/id')).rejects.toMatchObject({ status: 409, code: 'INCOMPLETE_TRIP', fields });
  expect(await f.auth.accessToken()).toBe(session.token);
});

test('network failure and 403 retain the session', async () => {
  const f = fixture(JSON.stringify(session));
  await f.auth.restore();
  f.transport.mockRejectedValueOnce(new Error('secret network details'));
  await expect(f.api.request('/api/trips/id')).rejects.toThrow('서버에 연결하지 못했어요');
  f.transport.mockResolvedValue(json({ code: 'FORBIDDEN', error: '접근할 수 없어요.' }, 403));
  await expect(f.api.request('/api/trips/id')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(await f.auth.accessToken()).toBe(session.token);
});

test.each(['https://other.example/api/trips', '//other.example/api/trips', '/api/../../secret'])('does not send credentials to unsafe path %s', async path => {
  const f = fixture(JSON.stringify(session));
  await f.auth.restore();
  await expect(f.api.request(path)).rejects.toThrow();
  expect(f.transport).not.toHaveBeenCalled();
});

test.each(['', 'file:///tmp/', 'https://user:password@example.com', 'https://example.com/base'])('invalid server configuration fails before fetch: %s', async base => {
  const f = fixture();
  const api = new ApiClient(base, f.auth, f.transport);
  await expect(api.request('/api/session', {}, false)).rejects.toThrow('서버 주소');
  expect(f.transport).not.toHaveBeenCalled();
});

test('late 401 for a previous session does not delete a new session', async () => {
  const f = fixture(JSON.stringify(session));
  await f.auth.restore();
  const pending = deferred<Response>();
  f.transport.mockReturnValueOnce(pending.promise);
  const oldRequest = f.api.request('/api/trips/id');
  await Promise.resolve();
  await f.auth.invalidate(session.token);
  const next = { ...session, token: 'b'.repeat(43) };
  f.transport.mockResolvedValue(json(next));
  await f.auth.signIn(f.sessions);
  pending.resolve(new Response(null, { status: 401 }));
  await expect(oldRequest).rejects.toMatchObject({ status: 401 });
  expect(await f.auth.accessToken()).toBe(next.token);
});
