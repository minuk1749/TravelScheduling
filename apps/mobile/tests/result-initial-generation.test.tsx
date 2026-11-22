import { act, screen, within } from 'expo-router/testing-library';
import { deferred, json } from './helpers';
import { renderResult, resultFixture, trip } from './result-fixture';

test('the first calculation shows progress over an empty map, then opens the saved result', async () => {
  const f = resultFixture();
  const pending = deferred<Response>();
  f.generate.mockReturnValueOnce(pending.promise);
  await renderResult(f);
  const panel = within(await screen.findByTestId('initial-place-panel'));
  expect(panel.getByText('동선을 만드는 중')).toBeVisible();
  expect(panel.getByRole('button', { name: '저장한 여행 보기' })).toBeVisible();
  expect(screen.getByTestId('result-map')).toBeVisible();
  expect(screen.queryAllByTestId(/^route-|^marker-/)).toHaveLength(0);
  expect(screen.queryByTestId('place-card-row')).toBeNull();
  expect(f.shapes).not.toHaveBeenCalled();
  expect(f.read).not.toHaveBeenCalled();

  await act(async () => pending.resolve(json(trip(f.current().revision))));
  expect(await screen.findByTestId('place-card-row')).toBeVisible();
  expect(screen.queryByTestId('initial-place-panel')).toBeNull();
  expect(f.generate).toHaveBeenCalledTimes(1);
});
