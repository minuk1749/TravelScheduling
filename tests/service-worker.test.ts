import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

test('service worker activates and forwards requests without caching', async () => {
  const handlers = new Map<string, (event: unknown) => void>();
  const requests: unknown[] = [];
  let claimed = false;
  let skipped = false;
  const response = new Response('online');
  runInNewContext(await readFile('public/sw.js', 'utf8'), {
    self: {
      addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler),
      skipWaiting: () => { skipped = true; },
      clients: { claim: async () => { claimed = true; } },
    },
    fetch: async (request: unknown) => { requests.push(request); return response; },
    // No Cache API is supplied: accidental caching fails this test.
  });
  assert.deepEqual([...handlers.keys()].sort(), ['activate', 'fetch', 'install']);
  handlers.get('install')!({});
  assert.ok(skipped);
  let activation: Promise<unknown> | undefined;
  handlers.get('activate')!({ waitUntil: (promise: Promise<unknown>) => { activation = promise; } });
  await activation;
  assert.ok(claimed);
  const request = new Request('https://example.com/api/trips');
  let result: Promise<Response> | undefined;
  handlers.get('fetch')!({ request, respondWith: (promise: Promise<Response>) => { result = promise; } });
  assert.equal(await result, response);
  assert.deepEqual(requests, [request]);
});
