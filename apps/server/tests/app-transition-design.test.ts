import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

// T16: the app transition plan (docs/architecture.md §13) must stay complete and match the repository.
import { repositoryRoot as root } from './helpers/paths';
const architecture = readFile(path.join(root, 'docs/architecture.md'), 'utf8');

async function section(prefix: string): Promise<string> {
  const plan = (await architecture).split('\n## 13.')[1];
  assert.ok(plan, 'Missing §13 app transition plan');
  const part = plan.split('\n### ').find(chunk => chunk.startsWith(prefix));
  assert.ok(part, `Missing subsection ${prefix}`);
  return part;
}

async function files(directory: string): Promise<string[]> {
  const entries = await readdir(path.join(root, directory), { recursive: true });
  return entries.map(entry => path.posix.join(directory, entry.split(path.sep).join('/')));
}

const exists = async (relative: string) => stat(path.join(root, relative)).then(() => true, () => false);

test('§13 covers every T16 design topic and links the decision record', async () => {
  const titles = ['13.1 모노레포', '13.2 앱 ↔ 서버 API 계약', '13.3 모바일 세션 토큰', '13.4 구간 경로 모양',
    '13.5 지도 어댑터', '13.6 앱 테스트 전략', '13.7 디자인 토큰', '13.8 T25에서 지운 웹 전용 코드'];
  for (const title of titles) await section(title);
  const decisions = (await readdir(path.join(root, 'docs/decisions'))).filter(name => /^T16-.+\.md$/.test(name));
  assert.equal(decisions.length, 1);
  assert.ok((await architecture).includes(`decisions/${decisions[0]}`));
});

test('monorepo layout names each package with responsibility and allowed/forbidden dependencies', async () => {
  const layout = await section('13.1');
  for (const pkg of ['apps/server', 'apps/mobile', 'packages/core', 'packages/design-tokens']) {
    const row = layout.split('\n').find(line => line.startsWith(`| \`${pkg}\``));
    assert.ok(row, `Missing package row: ${pkg}`);
    assert.equal(row.split(' | ').length, 4, `${pkg}: responsibility, allowed, forbidden`);
  }
  for (const source of ['apps/server/src/scheduler/', 'apps/server/src/fare/', 'apps/server/src/trips/input.ts', 'apps/server/src/services/itinerary/types.ts']) {
    assert.ok(layout.includes(source), `Shared code move not planned: ${source}`);
    assert.ok(await exists(source), `Planned source does not exist: ${source}`);
  }
});

test('API contract lists every existing route method plus the new mobile routes and error codes', async () => {
  const contract = await section('13.2');
  const routes = (await files('apps/server/src/app/api')).filter(file => file.endsWith('/route.ts'));
  assert.ok(routes.length >= 10);
  for (const file of routes) {
    const route = '/' + path.posix.dirname(file).replace(/^apps\/server\/src\/app\//, '');
    const source = await readFile(path.join(root, file), 'utf8');
    const methods = new Set(source.split('\n').filter(line => line.startsWith('export'))
      .flatMap(line => line.match(/\b(GET|POST|PUT|DELETE|PATCH)\b/g) ?? []));
    assert.ok(methods.size > 0, `No methods in ${file}`);
    for (const method of methods) assert.ok(contract.includes(`\`${method} ${route}\``), `Undocumented ${method} ${route}`);
  }
  for (const route of ['POST /api/session', 'DELETE /api/session', 'DELETE /api/account', 'GET /api/trips/[id]/itinerary/shapes']) {
    assert.ok(contract.includes(`\`${route}\``), `Missing new route ${route}`);
  }
  assert.match(contract, /Authorization: Bearer/);
  for (const code of ['UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'INVALID_INPUT', 'INCOMPLETE_TRIP', 'STALE_INPUT',
    'RESULT_UNAVAILABLE', 'PROVIDER_UNAVAILABLE', 'PROVIDER_INVALID_RESPONSE', 'INTERNAL']) {
    assert.ok(contract.includes(`'${code}'`), `Missing error code ${code}`);
  }
});

test('session token design covers issue, storage, expiry, revocation, withdrawal and ownership checks', async () => {
  const session = await section('13.3');
  for (const row of ['발급', '토큰 형식', '저장 형식', '만료', '검증', '폐기', '탈퇴', '앱 저장', '소유권 연결', '전환 기간']) {
    assert.ok(session.split('\n').some(line => new RegExp(`^\\| ${row}( \\([^)]*\\))? \\|`).test(line)), `Missing session row: ${row}`);
  }
  for (const term of ['mobile_sessions', 'ON DELETE CASCADE', 'SHA-256', 'expires_at', 'authorizeTrip', 'expo-secure-store', 'aud', 'iss', 'exp']) {
    assert.ok(session.includes(term), `Session design misses ${term}`);
  }
  assert.ok(await exists('apps/server/src/lib/auth/authorization.ts'), 'Ownership check moved; update §13.3');
});

test('route shape delivery states storage policy, missing-shape value and provider errors', async () => {
  const shapes = await section('13.4');
  for (const term of ['저장하지 않는다', 'routes.polyline.encodedPolyline', "status: 'NONE'", 'TravelProviderError', 'ADR 0005']) {
    assert.ok(shapes.includes(term), `Route shape design misses ${term}`);
  }
  const map = await section('13.5');
  for (const term of ['ResultMapProps', 'GoogleResultMap', 'FakeResultMap', 'onSelectMarker']) assert.ok(map.includes(term), term);
});

test('test strategy separates CI checks from on-device human checks; tokens have one home', async () => {
  const strategy = (await section('13.6')).split('\n');
  const header = strategy.find(line => line.startsWith('| 범위 |'));
  assert.ok(header?.includes('CI') && header.includes('사람'), 'Strategy table must split CI and human checks');
  for (const scope of ['core·design-tokens', '서버', '앱 화면', '앱 빌드', '로그인·지도 SDK']) {
    assert.ok(strategy.some(line => line.startsWith(`| ${scope} |`)), `Missing test scope ${scope}`);
  }
  const tokens = await section('13.7');
  assert.match(tokens, /`packages\/design-tokens\/src\/index\.ts` 한 곳/);
  assert.ok(await exists('docs/design.md'));
});

test('T25 removed every listed web-only path; only the share page and its display components remain', async () => {
  const removal = await section('13.8');
  const [remove, keep] = removal.split('남긴 것:');
  assert.ok(keep, 'Removal record must name what stays');
  const paths = (text: string) => [...text.matchAll(/`(apps\/server\/(?:src|public|scripts|tests)\/[^`]+)`/g)].map(match => match[1]);
  const removed = paths(remove);
  const kept = paths(keep);
  assert.ok(removed.length > 10);
  for (const file of removed) assert.ok(!await exists(file), `Web-only path still exists: ${file}`);
  for (const file of kept) assert.ok(await exists(file), `Kept path does not exist: ${file}`);
  const isKept = (file: string) => kept.some(listed => file === listed || (listed.endsWith('/') && file.startsWith(listed)));

  const pages = (await files('apps/server/src/app')).filter(file => file.endsWith('/page.tsx'));
  assert.deepEqual(pages, ['apps/server/src/app/share/[token]/page.tsx'], 'The share page is the only web page');
  const components = (await files('apps/server/src/components')).filter(file => /\.tsx?$/.test(file));
  for (const component of components) assert.ok(isKept(component), `Component is not part of the share page: ${component}`);
  assert.deepEqual(await readdir(path.join(root, 'apps/server/public')).catch(() => []), [], 'No PWA assets remain');
  const server = JSON.parse(await readFile(path.join(root, 'apps/server/package.json'), 'utf8'));
  assert.equal(server.dependencies['next-auth'], undefined);
  assert.doesNotMatch(server.scripts.build, /verify-pwa/);
});
