import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { AuthProvider } from '../src/auth/provider';
import { RootNavigator } from '../src/navigation/root-navigator';
import Login from '../app/login';
import Home from '../app/(app)/index';
import { deferred, fixture, json, session } from './helpers';

async function renderApp(f: ReturnType<typeof fixture>, initialUrl = '/') {
  return renderRouter({
    _layout: () => <AuthProvider runtime={f.runtime}><RootNavigator /></AuthProvider>,
    login: Login,
    '(app)/index': Home,
  }, { initialUrl });
}

test('protected root → Google login → first screen → logout with actual router and mock HTTP', async () => {
  const f = fixture();
  const exchange = deferred<Response>();
  f.transport.mockReturnValueOnce(exchange.promise);
  await renderApp(f);
  expect(await screen.findByRole('button', { name: 'Google로 로그인' })).toBeVisible();
  expect(screen).toHavePathname('/login');
  await fireEvent.press(screen.getByRole('button', { name: 'Google로 로그인' }));
  expect(screen.getByRole('button', { name: '로그인 중' })).toBeDisabled();
  await act(async () => { exchange.resolve(json(session, 201)); });
  expect(await screen.findByText('내 여행')).toBeVisible();
  expect(screen).toHavePathname('/');
  expect(screen.queryByText('Google로 로그인')).toBeNull();
  f.transport.mockResolvedValue(new Response(null, { status: 204 }));
  await fireEvent.press(screen.getByRole('button', { name: '로그아웃' }));
  expect(await screen.findByRole('button', { name: 'Google로 로그인' })).toBeVisible();
  expect(screen).toHavePathname('/login');
  expect(screen.queryByText('내 여행')).toBeNull();
  expect(await f.storage.read()).toBeNull();
});

test('restores a saved session, redirects away from login, and 401 returns to login', async () => {
  const f = fixture(JSON.stringify(session));
  await renderApp(f, '/login');
  expect(await screen.findByText('내 여행')).toBeVisible();
  expect(f.google.signIn).not.toHaveBeenCalled();
  f.transport.mockResolvedValue(new Response(null, { status: 401 }));
  await act(async () => {
    await expect(f.api.request('/api/trips/expired')).rejects.toMatchObject({ status: 401 });
  });
  expect(await screen.findByRole('button', { name: 'Google로 로그인' })).toBeVisible();
  expect(screen).toHavePathname('/login');
});

test('login error is announced and retry can succeed', async () => {
  const f = fixture();
  f.transport.mockResolvedValueOnce(json({ code: 'INVALID_GOOGLE_TOKEN', error: '다시 로그인해 주세요.' }, 401));
  await renderApp(f);
  await fireEvent.press(await screen.findByRole('button', { name: 'Google로 로그인' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/다시 로그인해 주세요\./);
  expect(screen.queryByText('내 여행')).toBeNull();
  f.transport.mockResolvedValueOnce(json(session));
  await fireEvent.press(screen.getByRole('button', { name: 'Google로 로그인' }));
  expect(await screen.findByText('내 여행')).toBeVisible();
});

test('native cancellation stays on login without an error or HTTP request', async () => {
  const f = fixture();
  f.google.signIn.mockResolvedValue(null);
  await renderApp(f);
  await fireEvent.press(await screen.findByRole('button', { name: 'Google로 로그인' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Google로 로그인' })).toBeEnabled());
  expect(screen.queryByRole('alert')).toBeNull();
  expect(f.transport).not.toHaveBeenCalled();
});

test('waits for secure-store hydration and offers a retry after a read failure', async () => {
  const f = fixture();
  const read = deferred<string | null>();
  f.storage.read.mockReturnValueOnce(read.promise);
  await renderApp(f);
  expect(screen.getByText('불러오는 중')).toBeVisible();
  expect(screen.queryByText('내 여행')).toBeNull();
  await act(async () => { read.resolve(null); });
  expect(await screen.findByRole('button', { name: 'Google로 로그인' })).toBeVisible();
});

test('storage failure blocks protected content and retry clears credentials', async () => {
  const f = fixture(JSON.stringify(session));
  f.storage.read.mockRejectedValueOnce(new Error('locked'));
  await renderApp(f);
  expect(await screen.findByRole('alert')).toHaveTextContent(/보안 저장소/);
  expect(screen.queryByText('내 여행')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));
  expect(await screen.findByRole('button', { name: 'Google로 로그인' })).toBeVisible();
  expect(await f.storage.read()).toBeNull();
});

test('offline logout still navigates to login and shows the remote revoke limitation', async () => {
  const f = fixture(JSON.stringify(session));
  await renderApp(f);
  f.transport.mockRejectedValue(new Error('offline'));
  await fireEvent.press(await screen.findByRole('button', { name: '로그아웃' }));
  expect(await screen.findByRole('button', { name: 'Google로 로그인' })).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent(/서버의 로그인 종료는 확인하지 못했어요/);
});
