import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { completedCommonRun } from './common-ci.mjs';

const pr = { id: 10, number: 87, base: { repo: { id: 5 }, sha: 'base' }, head: { repo: { id: 5 }, sha: 'head' } };
const proof = 'Common checks passed for PR 87 base base head head';
function fixture() {
  const run = { id: 44, run_attempt: 2, path: '.github/workflows/ci.yml', event: 'pull_request',
    repository: { id: 5 }, head_repository: { id: 5 }, head_sha: 'head', status: 'completed',
    conclusion: 'success', pull_requests: [{ id: 10, number: 87 }] };
  const job = { run_id: 44, head_sha: 'head', name: 'check', status: 'completed', conclusion: 'success',
    steps: ['Check', 'Agent automation regression tests', proof].map(name => ({ name, conclusion: 'success' })) };
  const runs = { total_count: 1, workflow_runs: [run] };
  const result = () => completedCommonRun(pr, runs, (id, attempt) => {
    assert.deepEqual([id, attempt], [44, 2]);
    return { jobs: [job] };
  });
  return { run, job, runs, result };
}
test('reuse only the matching completed attempt, both checks and exact merge-tree evidence', () => {
  assert.equal(fixture().result(), 44);
  for (const change of [
    f => { f.run.event = 'push'; }, f => { f.run.path = '.github/workflows/other.yml'; },
    f => { f.run.repository.id++; }, f => { f.run.head_repository.id++; }, f => { f.run.head_sha = 'other'; },
    f => { f.run.pull_requests = []; }, f => { f.run.status = 'in_progress'; }, f => { f.run.conclusion = 'failure'; },
    f => { f.job.steps[2].name = proof.replace('base base', 'base old'); },
    f => { f.job.steps[2].conclusion = 'skipped'; }, f => { f.job.steps[0].conclusion = 'failure'; },
    f => { f.job.steps.splice(1, 1); }, f => { f.job.conclusion = 'cancelled'; },
    f => { f.job.head_sha = 'other'; }, f => { f.runs.total_count++; },
    f => { f.runs.workflow_runs.push(f.run); f.runs.total_count++; },
  ]) { const f = fixture(); change(f); assert.equal(f.result(), null); }
});
test('E2E-only installs fresh dependencies and runs the browser suite; full mode still runs every stage', t => {
  const dir = mkdtempSync(join(tmpdir(), 'common-ci-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'bin'));
  for (const name of ['npm', 'npx']) {
    const file = join(dir, 'bin', name);
    writeFileSync(file, '#!/bin/sh\necho "' + name + ' $*" >> calls\n');
    chmodSync(file, 0o755);
  }
  const env = { ...process.env, PATH: join(dir, 'bin') + ':' + process.env.PATH };
  const scripts = Object.fromEntries(['lint','typecheck','build','test','test:e2e'].map(name => [name,'ok']));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts }));
  const driver = fileURLToPath(new URL('./check-required.sh', import.meta.url));
  const common = ['npm run lint','npm run typecheck','npm run build','npm test'];
  const browser = ['npx playwright install --with-deps chromium','npm run test:e2e -- --trace off'];
  for (const [args, expected] of [[[], common], [['--e2e'], [...common, ...browser]], [['--e2e-only'], browser]]) {
    writeFileSync(join(dir, 'calls'), '');
    const run = spawnSync('bash', [driver, ...args], { cwd: dir, env, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n'), ['npm ci', ...expected]);
  }
});
