import { act, fireEvent, renderRouter, screen, testRouter, waitFor } from 'expo-router/testing-library';
import { AuthProvider } from '../src/auth/provider';
import { RootNavigator } from '../src/navigation/root-navigator';
import Login from '../app/login';
import AppLayout from '../app/(app)/_layout';
import Home from '../app/(app)/index';
import Account from '../app/(app)/account';
import { deferred, fixture, json, session } from './helpers';

async function renderApp(f: ReturnType<typeof fixture>, initialUrl = '/') {
  return renderRouter({
    _layout: () => <AuthProvider runtime={f.runtime}><RootNavigator /></AuthProvider>,
    login: Login,
    '(app)/_layout': AppLayout,
    '(app)/index': Home,
    '(app)/account': Account,
  }, { initialUrl });
}

async function openAccount() {
  await fireEvent.press(await screen.findByRole('button', { name: '계정' }));
  expect(await screen.findByRole('header', { name: '계정' })).toBeVisible();
  expect(screen).toHavePathname('/account');
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
  await openAccount();
  f.transport.mockResolvedValue(new Response(null, { status: 204 }));
  await fireEvent.press(screen.getByRole('button', { name: '로그아웃' }));
  expect(await screen.findByRole('button', { name: 'Google로 로그인' })).toBeVisible();
  expect(screen).toHavePathname('/login');
  expect(screen.queryByText('내 여행')).toBeNull();
  expect(await f.storage.read()).toBeNull();
  const [url, options] = f.transport.mock.calls.at(-1)!;
  expect(url).toBe('https://travel.example/api/session');
  expect(options?.method).toBe('DELETE');
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
  await openAccount();
  await fireEvent.press(await screen.findByRole('button', { name: '로그아웃' }));
  expect(await screen.findByRole('button', { name: 'Google로 로그인' })).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent(/서버의 로그인 종료는 확인하지 못했어요/);
});

test('a signed-out user opening the account route is sent to login', async () => {
  const f = fixture();
  await renderApp(f, '/account');
  expect(await screen.findByRole('button', { name: 'Google로 로그인' })).toBeVisible();
  expect(screen).toHavePathname('/login');
  expect(screen.queryByRole('button', { name: '회원 탈퇴' })).toBeNull();
});

test('T24 withdrawal requires confirmation, sends one Bearer DELETE and clears credentials on success', async () => {
  const f = fixture(JSON.stringify(session));
  f.transport.mockResolvedValue(json({ trips: [] }));
  await renderApp(f);
  await openAccount();
  const deletions = () => f.transport.mock.calls.filter(([url]) => String(url).endsWith('/api/account'));
  await fireEvent.press(screen.getByRole('button', { name: '회원 탈퇴' }));
  expect(screen.getByText(/계정과 모든 여행 일정이 삭제돼요/)).toBeVisible();
  expect(deletions()).toHaveLength(0);
  await fireEvent.press(screen.getByRole('button', { name: '취소' }));
  expect(screen.queryByRole('button', { name: '탈퇴하기' })).toBeNull();
  expect(await f.storage.read()).not.toBeNull();

  const deletion = deferred<Response>();
  f.transport.mockReturnValueOnce(deletion.promise);
  await fireEvent.press(screen.getByRole('button', { name: '회원 탈퇴' }));
  await fireEvent.press(screen.getByRole('button', { name: '탈퇴하기' }));
  const pending = screen.getByRole('button', { name: '탈퇴 중' });
  expect(pending).toBeDisabled();
  await fireEvent.press(pending);
  expect(deletions()).toHaveLength(1);
  const [url, request] = deletions()[0];
  expect(url).toBe('https://travel.example/api/account');
  expect(request).toMatchObject({ method: 'DELETE', credentials: 'omit' });
  expect(new Headers(request?.headers).get('Authorization')).toBe(`Bearer ${session.token}`);
  expect(await f.storage.read()).not.toBeNull();

  await act(async () => { deletion.resolve(new Response(null, { status: 204 })); });
  expect(await screen.findByRole('button', { name: 'Google로 로그인' })).toBeVisible();
  expect(screen).toHavePathname('/login');
  expect(await f.storage.read()).toBeNull();
  expect(await f.auth.accessToken()).toBeNull();
  expect(testRouter.canGoBack()).toBe(false);
  expect(f.sessions.revoke).not.toHaveBeenCalled();
  expect(f.google.signOut).toHaveBeenCalledTimes(1);
});

test.each([500, 200])('T24 withdrawal response %s leaves the session available and allows retry', async status => {
  const f = fixture(JSON.stringify(session));
  await renderApp(f, '/account');
  const withdraw = async () => fireEvent.press(screen.getByRole('button', { name: '탈퇴하기' }));
  f.transport.mockResolvedValueOnce(json({ code: 'INTERNAL', error: '탈퇴를 처리하지 못했습니다.' }, status));
  await fireEvent.press(await screen.findByRole('button', { name: '회원 탈퇴' }));
  await withdraw();
  expect(await screen.findByRole('alert')).toHaveTextContent(status === 500 ? /탈퇴를 처리하지 못했습니다/ : /서버 응답을 확인하지 못했어요/);
  expect(screen).toHavePathname('/account');
  expect(await f.auth.accessToken()).toBe(session.token);
  expect(f.storage.clear).not.toHaveBeenCalled();
  f.transport.mockResolvedValueOnce(new Response(null, { status: 204 }));
  await withdraw();
  expect(await screen.findByRole('button', { name: 'Google로 로그인' })).toBeVisible();
  expect(await f.storage.read()).toBeNull();
});

test('T24 withdrawal blocks protected screens if SecureStore deletion must be retried', async () => {
  const f = fixture(JSON.stringify(session));
  f.storage.clear.mockRejectedValueOnce(new Error('locked'));
  f.transport.mockResolvedValueOnce(new Response(null, { status: 204 }));
  await renderApp(f, '/account');
  await fireEvent.press(await screen.findByRole('button', { name: '회원 탈퇴' }));
  await fireEvent.press(screen.getByRole('button', { name: '탈퇴하기' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/로그인 정보를 지우지 못했어요/);
  expect(screen.queryByRole('header', { name: '계정' })).toBeNull();
  expect(await f.auth.accessToken()).toBeNull();

  await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));
  expect(await screen.findByRole('button', { name: 'Google로 로그인' })).toBeVisible();
  expect(await f.storage.read()).toBeNull();
  expect(f.transport).toHaveBeenCalledTimes(1);
});
