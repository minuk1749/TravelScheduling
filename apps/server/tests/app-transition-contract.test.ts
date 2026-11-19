import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
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

test('every API route that authenticates directly is planned for RequestAuthenticator with Bearer checks', async () => {
  const session = await section('13.3');
  const ownership = session.split('\n').find(line => line.startsWith('| 소유권 연결 |'));
  assert.ok(ownership, 'Missing ownership row');
  const routes = (await readdir(path.join(root, 'apps/server/src/app/api'), { recursive: true }))
    .map(entry => path.posix.join('apps/server/src/app/api', entry.split(path.sep).join('/')))
    .filter(file => file.endsWith('/route.ts') && !file.includes('[...nextauth]'));
  const direct: string[] = [];
  for (const file of routes) {
    if (/from '(?:\.\.\/)+auth'/.test(await readFile(path.join(root, file), 'utf8'))) direct.push(file);
  }
  assert.ok(direct.includes('apps/server/src/app/api/trips/[id]/route.ts'), 'Expected the direct-auth trip route');
  for (const file of direct) assert.ok(ownership.includes(`\`${file}\``), `Direct auth route not planned: ${file}`);

  const verification = session.split('\n').find(line => line.startsWith('직접 인증 라우트'));
  assert.ok(verification, 'Missing T18 verification for direct-auth routes');
  for (const term of ['`GET /api/trips/[id]`', '200', '401', '403']) assert.ok(verification.includes(term), `Verification misses ${term}`);
});
