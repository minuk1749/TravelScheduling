import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { API_ERROR_CODES } from '@travel/core/contracts/errors';
import { itineraryHandlers, type ItineraryGenerator } from '../src/itineraries/http';
import { ItineraryInputError } from '../src/services/itinerary';
import { tripHandlers } from '../src/trips/http';

// T16: existing responses must already fit the planned app contract (docs/architecture.md §13.2–13.3).
import { repositoryRoot as root } from './helpers/paths';
const architecture = readFile(path.join(root, 'docs/architecture.md'), 'utf8');

async function section(prefix: string): Promise<string> {
  const part = (await architecture).split('\n## 13.')[1]?.split('\n### ').find(chunk => chunk.startsWith(prefix));
  assert.ok(part, `Missing subsection ${prefix}`);
  return part;
}

/** Runtime form of the documented `ApiErrorFields = readonly string[] | Record<string, string>`. */
function fieldsShape(value: unknown): 'LIST' | 'MESSAGES' | 'INVALID' {
  if (Array.isArray(value)) return value.every(item => typeof item === 'string') ? 'LIST' : 'INVALID';
  if (value === null || typeof value !== 'object') return 'INVALID';
  return Object.values(value).every(item => typeof item === 'string') ? 'MESSAGES' : 'INVALID';
}

function itinerary(generate: ItineraryGenerator['generate']) {
  const handlers = itineraryHandlers({
    userId: async () => 'user-1', findOwner: async () => 'user-1',
    generator: () => ({ generator: { generate }, dispose: () => undefined }),
  });
  return handlers.generate(new Request('https://app.example.test/api/trips/trip-1/itinerary', { method: 'POST' }), 'trip-1');
}

test('documented ApiError.fields allows both field forms the server returns today', async () => {
  const contract = await section('13.2');
  assert.match(contract, /export type ApiErrorFields = readonly string\[\] \| Record<string, string>;/);
  assert.match(contract, /fields\?: ApiErrorFields/);
  for (const form of ['`Record<string, string>`', '`readonly string[]`']) {
    assert.ok(contract.split('\n').some(line => line.startsWith(`| ${form}`)), `Missing fields form row ${form}`);
  }
});

test('existing error responses match the documented fields contract', async () => {
  const cases: [string, Response, number, 'LIST' | 'MESSAGES'][] = [
    ['itinerary INCOMPLETE outcome', await itinerary(async () => ({ status: 'INCOMPLETE', fields: ['cityCode'] })), 409, 'LIST'],
    ['itinerary input error', await itinerary(async () => { throw new ItineraryInputError({ lodgings: '숙소' }); }), 409, 'MESSAGES'],
    ['trip draft validation', await tripHandlers({
      userId: async () => 'user-1', create: async () => 'trip-1', profile: async () => null,
    }).create(new Request('https://app.example.test/api/trips', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })), 400, 'MESSAGES'],
  ];
  for (const [name, response, status, shape] of cases) {
    assert.equal(response.status, status, name);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(typeof body.error, 'string', name);
    assert.equal(fieldsShape(body.fields), shape, name);
  }
});

test('T18: only the Auth.js route imports auth.ts; every user API module authenticates through RequestAuthenticator', async () => {
  const session = await section('13.3');
  const ownership = session.split('\n').find(line => line.startsWith('| 소유권 연결 |'));
  assert.ok(ownership?.includes('`apps/server/src/app/api/trips/[id]/route.ts`'), 'Ownership row must name the converted direct route');
  const routes = (await readdir(path.join(root, 'apps/server/src/app/api'), { recursive: true }))
    .map(entry => path.posix.join('apps/server/src/app/api', entry.split(path.sep).join('/')))
    .filter(file => file.endsWith('/route.ts'));
  assert.ok(routes.includes('apps/server/src/app/api/trips/[id]/route.ts'));
  for (const file of routes) {
    const imports = /from '(?:\.\.\/)+auth'/.test(await readFile(path.join(root, file), 'utf8'));
    assert.equal(imports, file.includes('[...nextauth]'), `${file} must not authenticate with Auth.js directly`);
  }
  for (const name of ['trips', 'places', 'itineraries', 'route-shapes', 'settings', 'results', 'sharing']) {
    const source = await readFile(path.join(root, `apps/server/src/${name}/server.ts`), 'utf8');
    assert.doesNotMatch(source, /from '\.\.\/auth'/, name);
    assert.match(source, /requestAuthenticator\.userId\(request\)/, `${name} must pass the request to RequestAuthenticator`);
  }

  const verification = session.split('\n').find(line => line.startsWith('직접 인증 라우트'));
  assert.ok(verification, 'Missing T18 verification for direct-auth routes');
  for (const term of ['`GET /api/trips/[id]`', '200', '401', '403']) assert.ok(verification.includes(term), `Verification misses ${term}`);
});

test('T18: error responses carry a documented machine-readable code alongside the unchanged error/fields', async () => {
  const responses = [
    await itinerary(async () => ({ status: 'INCOMPLETE', fields: ['cityCode'] })),
    await itinerary(async () => ({ status: 'STALE' })),
    await itinerary(async () => { throw new ItineraryInputError({ lodgings: '숙소' }); }),
  ];
  const body = await Promise.all(responses.map(response => response.json() as Promise<Record<string, unknown>>));
  assert.deepEqual(body.map(item => item.code), ['INCOMPLETE_TRIP', 'STALE_INPUT', 'INCOMPLETE_TRIP']);
  assert.deepEqual(body[0], { code: 'INCOMPLETE_TRIP', error: '일정을 만들기 전에 여행 정보를 보완해 주세요.', fields: ['cityCode'] });
  const contract = await section('13.2');
  for (const code of API_ERROR_CODES) assert.ok(contract.includes(`'${code}'`), `Undocumented code ${code}`);
});
