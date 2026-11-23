import { act, fireEvent, screen } from 'expo-router/testing-library';
import { Share } from 'react-native';
import { deferred, json, session } from './helpers';
import { openResult, resultFixture } from './result-fixture';

const firstPath = `/share/${'s'.repeat(43)}`;
const secondPath = `/share/${'t'.repeat(43)}`;
const shareEndpoint = 'https://travel.example/api/trips/trip/share';

function withSharing() {
  const f = resultFixture();
  const defaultTransport = f.transport.getMockImplementation()!;
  const issue = jest.fn<Promise<Response>, [RequestInit | undefined]>();
  f.transport.mockImplementation((url, options) => url === shareEndpoint ? issue(options) : defaultTransport(url, options));
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.dismissedAction, activityType: undefined });
  return { f, issue, share };
}

afterEach(() => jest.mocked(Share.share).mockRestore());

async function openSharing(f: ReturnType<typeof resultFixture>) {
  await openResult(f);
  await fireEvent.press(screen.getByRole('button', { name: '공유' }));
  expect(screen.getByRole('header', { name: '여행 일정 공유' })).toBeVisible();
  expect(screen.getByText(/이전 링크는 무효가 돼요/)).toBeVisible();
}

test('T24 result sharing issues a Bearer link, opens the OS sheet, and explicitly rotates on reissue', async () => {
  const { f, issue, share } = withSharing();
  const issued = deferred<Response>();
  issue.mockReturnValueOnce(issued.promise).mockResolvedValueOnce(json({ path: secondPath }));
  await openSharing(f);
  expect(issue).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: '링크 만들고 공유' }));
  const pending = screen.getByRole('button', { name: '링크 만드는 중' });
  expect(pending).toBeDisabled();
  await fireEvent.press(pending);
  expect(issue).toHaveBeenCalledTimes(1);
  const [request] = issue.mock.calls[0];
  expect(request).toMatchObject({ method: 'POST', credentials: 'omit', cache: 'no-store' });
  expect(new Headers(request?.headers).get('Authorization')).toBe(`Bearer ${session.token}`);
  expect(share).not.toHaveBeenCalled();
  await act(async () => { issued.resolve(json({ path: firstPath })); });
  expect(share).toHaveBeenNthCalledWith(1, { message: `https://travel.example${firstPath}` });

  await fireEvent.press(screen.getByRole('button', { name: '링크 다시 공유' }));
  expect(issue).toHaveBeenCalledTimes(1);
  expect(share).toHaveBeenNthCalledWith(2, { message: `https://travel.example${firstPath}` });
  await fireEvent.press(screen.getByRole('button', { name: '새 링크 발급' }));
  expect(issue).toHaveBeenCalledTimes(2);
  expect(share).toHaveBeenNthCalledWith(3, { message: `https://travel.example${secondPath}` });
});

test('T24 rejects a foreign link, retries a native sheet failure with the same link, and drops links after an uncertain reissue', async () => {
  const { f, issue, share } = withSharing();
  issue.mockResolvedValueOnce(json({ path: `//other.example${firstPath}` }))
    .mockResolvedValueOnce(json({ path: firstPath })).mockRejectedValueOnce(new Error('offline'));
  share.mockRejectedValueOnce(new Error('native share error'));
  await openSharing(f);
  const issueLink = async () => fireEvent.press(screen.getByRole('button', { name: '링크 만들고 공유' }));
  await issueLink();
  expect(await screen.findByRole('alert')).toHaveTextContent(/서버 응답을 확인하지 못했어요/);
  expect(share).not.toHaveBeenCalled();
  await issueLink();
  expect(await screen.findByRole('alert')).toHaveTextContent(/공유 시트를 열지 못했어요/);
  await fireEvent.press(screen.getByRole('button', { name: '링크 다시 공유' }));
  expect(share).toHaveBeenLastCalledWith({ message: `https://travel.example${firstPath}` });
  expect(issue).toHaveBeenCalledTimes(2);
  await fireEvent.press(screen.getByRole('button', { name: '새 링크 발급' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/서버에 연결하지 못했어요/);
  expect(screen.queryByRole('button', { name: '링크 다시 공유' })).toBeNull();
  expect(share).toHaveBeenCalledTimes(2);
});
