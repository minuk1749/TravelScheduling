import { ApiClient } from '../src/api/client';
import { fixture, json, session } from './helpers';

const local = ['localhost', '127.0.0.1', '[::1]', '10.0.2.2', '172.16.0.1', '172.31.255.255', '192.168.1.10'];
const external = ['travel.example', 'localhost.example', '192.168.1.10.example', '10.2.3.example', '192.169.1.1', '172.15.1.1', '172.32.1.1'];

describe.each([true, false])('mobile API origin with __DEV__=%s', development => {
  beforeEach(() => {
    jest.replaceProperty(globalThis as typeof globalThis & { __DEV__: boolean }, '__DEV__', development);
  });
  afterEach(() => jest.restoreAllMocks());

  test.each([...local, ...external])('HTTP origin on %s', async host => {
    const f = fixture(JSON.stringify(session));
    await f.auth.restore();
    f.transport.mockResolvedValue(json({ ok: true }));
    const read = jest.spyOn(f.auth, 'accessToken');
    const api = new ApiClient(`http://${host}:3000`, f.auth, f.transport);
    if (development && local.includes(host)) {
      await expect(api.request('/api/trips')).resolves.toEqual({ ok: true });
      expect(f.transport.mock.calls[0][0]).toBe(`http://${host}:3000/api/trips`);
    } else {
      await expect(api.request('/api/trips')).rejects.toThrow('서버 주소');
      await expect(api.request('/api/session', { method: 'POST', body: '{}' }, false)).rejects.toThrow('서버 주소');
      expect(read).not.toHaveBeenCalled();
      expect(f.transport).not.toHaveBeenCalled();
    }
  });

  test('accepts a configured HTTPS origin', async () => {
    const f = fixture();
    f.transport.mockResolvedValue(json(session));
    await expect(f.sessions.create('fixture-token')).resolves.toEqual(session);
    expect(f.transport.mock.calls[0][0]).toBe('https://travel.example/api/session');
  });
});
