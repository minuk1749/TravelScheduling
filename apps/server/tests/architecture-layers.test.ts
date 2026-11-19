import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { repositoryRoot as root } from './helpers/paths';
import { test } from 'node:test';
import { assertAcyclic, assertBrowserSafe, sourceGraph, type SourceGraph } from './helpers/source-graph';

const graph = sourceGraph();

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

test('T15A final audit records the same checklist, oversized files and human decisions in questions.md', async () => {
  const audit = await readFile(path.join(root, 'docs/t15a-audit.md'), 'utf8');
  for (const topic of ['책임 혼합', '중복 규칙', '순환', '여러 곳 수정', '불필요한 추상화', '300줄', '성능', '남은 문제']) {
    assert.ok(audit.includes(topic), topic);
  }
  for (const name of ['architecture.md', 'local-runner.sh', 'agent-review.yml', 'package-lock.json']) assert.ok(audit.includes(name), name);
  // Every tracked code/script/workflow file over 300 lines must be listed; documents grow by design and are not checked.
  const { execFileSync } = await import('node:child_process');
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--deduplicate'], { encoding: 'utf8', cwd: root }).split('\n').filter(file => /\.(?:ts|tsx|mjs|js|sh|yml|sql|css)$/.test(file));
  for (const file of files) {
    let source: string;
    try { source = await readFile(path.join(root, file), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    const lines = source.trimEnd().split('\n').length;
    if (lines > 300) assert.ok(audit.includes(file.split('/').at(-1)!), `${file}: ${lines} lines missing from the T15A list`);
  }
  const questions = await readFile(path.join(root, 'docs/questions.md'), 'utf8');
  assert.match(questions, /## T15A 남은 구조 문제와 사람 결정 항목/);
  for (let item = 1; item <= 7; item++) assert.match(questions, new RegExp(`\\| T15A-${item} \\|`));
  assert.match(await readFile(path.join(root, 'docs/project-structure.md'), 'utf8'), /T15A/);
  assert.match(await readFile(path.join(root, 'docs/architecture.md'), 'utf8'), /## 12\. T15A/);
});
