import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasForeignOrigin, isCrossSiteRequest, privateJson } from '../src/lib/http';

test('private API response policy preserves JSON status and forbids caching', async () => {
  const response = privateJson({ error: 'fixture', fields: ['x'] }, 409);
  assert.equal(response.status, 409);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), { error: 'fixture', fields: ['x'] });
});

test('Origin policy retains absent, same-origin, foreign and opaque-origin behavior', () => {
  for (const [origin, rejected] of [[undefined, false], ['', false], ['https://travel.test', false],
    ['https://travel.test:8443', true], ['http://travel.test', true], ['https://other.test', true], ['null', true]] as const) {
    const request = new Request('https://travel.test/api/trips', { headers: origin === undefined ? {} : { origin } });
    assert.equal(hasForeignOrigin(request), rejected, String(origin));
  }
});

test('T15A stricter write policy adds only the Sec-Fetch-Site cross-site check to the Origin policy', () => {
  const request = (headers: Record<string, string>) => new Request('https://travel.test/api/trips/x/share', { method: 'POST', headers });
  const cases: [Record<string, string>, boolean][] = [
    [{}, false], [{ origin: 'https://travel.test' }, false], [{ 'sec-fetch-site': 'same-origin' }, false],
    [{ 'sec-fetch-site': 'same-site' }, false], [{ 'sec-fetch-site': 'none' }, false],
    [{ origin: 'https://evil.test' }, true], [{ origin: 'null' }, true], [{ 'sec-fetch-site': 'cross-site' }, true],
    [{ origin: 'https://travel.test', 'sec-fetch-site': 'cross-site' }, true],
  ];
  for (const [headers, rejected] of cases) assert.equal(isCrossSiteRequest(request(headers)), rejected, JSON.stringify(headers));
});
