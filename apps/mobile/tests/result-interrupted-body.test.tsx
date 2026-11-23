import { fireEvent, screen } from 'expo-router/testing-library';
import { constraintsFrom } from '@travel/core/contracts/results/model';
import { generationKeys } from './helpers';
import { D1, openResult, place, renderResult, resultFixture } from './result-fixture';

const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const responseError = '서버 응답을 확인하지 못했어요. 다시 시도해 주세요.';

// Deliver the 200 headers and first byte, then fail the body read.
function interruptedJson() {
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(Uint8Array.of(123)); },
    pull(controller) { controller.error(new TypeError('interrupted response stream')); },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
}

test('a broken 200 body on initial generation opens the failure panel and retry loads the itinerary', async () => {
  const f = resultFixture();
  f.generate.mockResolvedValueOnce(interruptedJson());
  await renderResult(f);
  expect(await screen.findByText('⚠ 동선을 계산하지 못했어요')).toBeVisible();
  expect(screen.getByText(responseError)).toBeVisible();
  expect(screen.getByTestId('initial-place-panel')).toBeVisible();
  expect(screen.queryByTestId('place-card-row')).toBeNull();
  expect(f.read).not.toHaveBeenCalled();
  await press('다시 계산');
  expect(await screen.findByTestId('place-card-row')).toBeVisible();
  expect(f.generate).toHaveBeenCalledTimes(2);
  const [initial, retry] = generationKeys(f);
  expect(retry).toBe(initial);
  expect(f.save).not.toHaveBeenCalled();
});

test('a committed edit with a broken 200 body is verified before generating and can still be undone', async () => {
  const f = resultFixture();
  const original = constraintsFrom(f.current().input);
  const persist = f.save.getMockImplementation()!;
  await openResult(f);
  f.save.mockImplementationOnce(async options => {
    const saved = await persist(options);
    const payload = await saved.text();
    return new Response(payload.slice(0, -1), { status: saved.status, headers: saved.headers });
  });
  await press('택시 14분 약 ¥2,300로 바꾸기');
  expect(await screen.findByText('⚠ 동선을 계산하지 못했어요')).toBeVisible();
  expect(screen.getByText(responseError)).toBeVisible();
  expect(f.current().input.legModes).toEqual([{ date: D1, from: place('hotel'), to: place('museum'), mode: 'TAXI' }]);
  expect(f.generate).toHaveBeenCalledTimes(1);

  await press('다시 계산');
  expect(await screen.findByText('택시로 바꾸고 다시 계산했어요')).toBeVisible();
  expect(f.read).toHaveBeenCalledTimes(2);
  expect(f.save).toHaveBeenCalledTimes(1);
  expect(f.generate).toHaveBeenCalledTimes(2);
  expect(f.read.mock.invocationCallOrder[1]).toBeLessThan(f.generate.mock.invocationCallOrder[1]);

  await press('되돌리기');
  expect(await screen.findByText('되돌리고 다시 계산했어요')).toBeVisible();
  expect(constraintsFrom(f.current().input)).toEqual(original);
  expect(f.save).toHaveBeenCalledTimes(2);
  expect(f.generate).toHaveBeenCalledTimes(3);
});
