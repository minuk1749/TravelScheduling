import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { repositoryRoot as root } from './helpers/paths';
import { test } from 'node:test';
import { assertAcyclic, assertBrowserSafe, sourceGraph, type SourceGraph } from './helpers/source-graph';

const graph = sourceGraph();

test('T20 declaration files have no runtime edges and bundled fonts remain checked asset dependencies', async () => {
  const sources = await graph;
  const declarations = sources.get('apps/mobile/src/theme/assets.d.ts');
  assert.ok(declarations, 'The font type declaration must be included in the graph');
  assert.deepEqual(declarations.runtime, []);
  const fonts = sources.get('apps/mobile/src/theme/fonts.ts');
  assert.ok(fonts);
  for (const weight of ['Regular', 'SemiBold']) {
    const asset = `packages/design-tokens/assets/fonts/Pretendard-${weight}.ttf`;
    assert.ok(fonts.runtime.includes(asset));
    assert.ok(fonts.declarations.includes(asset));
  }
});

test('T13A all source runtime dependencies are acyclic and client closures exclude server modules', async () => {
  const sources = await graph;
  assertAcyclic(sources);
  const clients = [...sources].filter(([, node]) => /^['"]use client['"];/.test(node.source));
  assert.ok(clients.length > 0);
  for (const [file] of clients) assertBrowserSafe(sources, file);
});

test('T13A services depend on ports, repositories do not execute schedulers or call providers', async () => {
  for (const [file, node] of await graph) {
    if (file.startsWith('apps/server/src/services/') || file === 'apps/server/src/settings/service.ts') {
      for (const dependency of node.declarations) {
        assert.ok(!/^(?:pg$|apps\/server\/src\/repositories\/|apps\/server\/src\/lib\/db)/.test(dependency)
          && !/\/(?:google|server)\.ts$/.test(dependency), `${file} -> ${dependency}`);
      }
      assert.doesNotMatch(node.source, /\b(?:fetch|process\.env)\b/, file);
    }
    if (file.startsWith('apps/server/src/repositories/')) {
      for (const dependency of node.runtime) {
        assert.ok(!/^(?:apps\/server\/src\/(?:scheduler|fare|places|travel-time)|packages\/core\/src\/(?:scheduler|fare))\//.test(dependency), `${file} -> ${dependency}`);
      }
      assert.doesNotMatch(node.source, /\bfetch\s*\(/, file);
    }
    const lines = node.source.trimEnd().split('\n').length;
    assert.ok(lines <= 300, `${file}: ${lines} lines; split responsibilities before growing it`);
  }
});

test('T13A dependency checks reject runtime cycles and transitive browser server imports', () => {
  const fixture: SourceGraph = new Map([
    ['apps/server/src/client.ts', { source: "'use client';", runtime: ['apps/server/src/shared.ts'], declarations: [] }],
    ['apps/server/src/shared.ts', { source: '', runtime: ['apps/server/src/client.ts'], declarations: [] }],
  ]);
  assert.throws(() => assertAcyclic(fixture), /Runtime cycle/);
  fixture.get('apps/server/src/shared.ts')!.runtime = ['pg'];
  assert.throws(() => assertBrowserSafe(fixture, 'apps/server/src/client.ts'), /Server dependency/);
  fixture.get('apps/server/src/shared.ts')!.runtime = [];
  fixture.get('apps/server/src/shared.ts')!.source = 'process.env.GOOGLE_ROUTES_API_KEY';
  assert.throws(() => assertBrowserSafe(fixture, 'apps/server/src/client.ts'), /Private environment/);
  fixture.get('apps/server/src/shared.ts')!.source = '';
  assert.doesNotThrow(() => assertAcyclic(fixture));
  assert.doesNotThrow(() => assertBrowserSafe(fixture, 'apps/server/src/client.ts'));
});

test('T13A audit records the checklist, oversized files, measurements and follow-up scope', async () => {
  const audit = await readFile(path.join(root, 'docs/t13a-audit.md'), 'utf8');
  for (const topic of ['책임 혼합', '중복 규칙', '순환', '여러 곳 수정', '불필요한 추상화', '300줄', '성능', '남은 문제']) {
    assert.ok(audit.includes(topic), topic);
  }
  for (const name of ['placement.ts', 'scheduler-capacity.test.ts', 'travel-time.test.ts', 'local-runner.sh', 'architecture.md', 'package-lock.json']) {
    assert.ok(audit.includes(name), name);
  }
  assert.match(audit, /benchmark-itinerary\.ts/);
  assert.match(await readFile(path.join(root, 'docs/project-structure.md'), 'utf8'), /T13A/);
  assert.match(await readFile(path.join(root, 'docs/architecture.md'), 'utf8'), /T13A/);
});

test('T15A final audit records the checklist, starting inventory and human decisions in questions.md', async () => {
  const audit = await readFile(path.join(root, 'docs/t15a-audit.md'), 'utf8');
  for (const topic of ['책임 혼합', '중복 규칙', '순환', '여러 곳 수정', '불필요한 추상화', '300줄', '성능', '남은 문제']) {
    assert.ok(audit.includes(topic), topic);
  }
  // Keep the inventory from the audit's starting commit available in shallow checkouts.
  assert.match(audit, /`ee500de`/);
  const inventory = audit.split(/^## /m).find(section => section.startsWith('300줄 초과 파일 목록'));
  assert.ok(inventory, 'Missing T15A oversized-file inventory');
  const rows = Array.from(inventory.matchAll(/^\|\s*`([^`]+)`\s*\|([^|\r\n]*)\|/gm),
    ([, file, lines]) => [file, lines.trim()]);
  assert.deepEqual(Object.fromEntries(rows), {
    'docs/architecture.md': '462',
    'scripts/agent/local-runner.sh': '343',
    '.github/workflows/agent-review.yml': '306',
    'package-lock.json': '7,500+',
  });
  const questions = await readFile(path.join(root, 'docs/questions.md'), 'utf8');
  assert.match(questions, /## T15A 남은 구조 문제와 사람 결정 항목/);
  for (let item = 1; item <= 7; item++) assert.match(questions, new RegExp(`\\| T15A-${item} \\|`));
  assert.match(await readFile(path.join(root, 'docs/project-structure.md'), 'utf8'), /T15A/);
  assert.match(await readFile(path.join(root, 'docs/architecture.md'), 'utf8'), /## 12\. T15A/);
});
