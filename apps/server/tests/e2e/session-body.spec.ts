import { expect, test } from '@playwright/test';

test('a chunked login request receives the JSON size error from the running server', async ({ baseURL }) => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(' '.repeat(16_384)));
      controller.enqueue(new TextEncoder().encode('{}'));
      controller.close();
    },
  });
  const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, duplex: 'half' };
  const response = await fetch(new URL('/api/session', baseURL), init);
  expect(response.status).toBe(413);
  expect(await response.json()).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
});
