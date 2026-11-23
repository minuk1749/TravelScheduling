import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readJsonBody } from '../src/lib/json-body';
import { constraintHandlers } from '../src/results/http';
import { sessionHandlers } from '../src/sessions/http';
import { settingsHandlers } from '../src/settings/http';
import { tripHandlers } from '../src/trips/http';

// Disable stream prefetch so a pull after rejection is observable.
function streamed(chunks: Uint8Array[], method: string, length?: number) {
  let pulls = 0, cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[pulls++];
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  const init = { method, body, duplex: 'half', headers: {
    'content-type': 'application/json', ...(length === undefined ? {} : { 'content-length': String(length) }),
  } };
  return { request: new Request('https://example.test/api/test', init), state: () => ({ pulls, cancelled }) };
}

const userId = async () => 'owner';
const unused = () => assert.fail('oversized input reached the service');
const sessions = sessionHandlers({ service: unused });
const trips = tripHandlers({ userId, create: unused, profile: unused });
const settings = settingsHandlers({ userId, service: { load: unused, save: unused } });
const constraints = constraintHandlers({ userId, findOwner: userId, service: unused });

for (const [name, maxBytes, method, handle] of [
  ['session', 16_384, 'POST', sessions.create],
  ['trips', 100_000, 'POST', trips.create],
  ['settings', 30_000, 'PUT', (request: Request) => settings(request, 'trip')],
  ['constraints', 262_144, 'PUT', (request: Request) => constraints.put(request, 'trip')],
] as const) {
  test(`${name} enforces its byte limit before consuming the rest of the stream`, async () => {
    const chunks = [new Uint8Array(maxBytes), Uint8Array.of(32), Uint8Array.of(32)];
    for (const length of [undefined, 1, maxBytes + 1]) {
      const input = streamed(chunks, method, length);
      const response = await handle(input.request);
      assert.equal(response.status, 413);
      assert.equal((await response.json()).code, 'PAYLOAD_TOO_LARGE');
      assert.deepEqual(input.state(), { pulls: length === maxBytes + 1 ? 0 : 2, cancelled: true });
    }
  });
}

test('UTF-8 split inside a character parses at the byte limit and fails one byte above it', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ name: '서울' }));
  const chunks = Array.from(bytes, byte => Uint8Array.of(byte));
  const body = () => streamed(chunks, 'POST').request;
  assert.deepEqual(await readJsonBody(body(), bytes.length), { value: { name: '서울' } });
  const rejected = await readJsonBody(body(), bytes.length - 1);
  assert.ok('error' in rejected);
  assert.equal(rejected.error.status, 413);
});
