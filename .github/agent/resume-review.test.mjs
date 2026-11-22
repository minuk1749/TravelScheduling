import assert from 'node:assert/strict';
import test from 'node:test';
import { recovery, reviewContext, sourceRun } from './resume-review.mjs';

function fixture() {
  const pr = { id: 7, number: 87, state: 'open', draft: false, labels: [], title: 'T22: revise', body: 'Evidence', user: { login: 'author' },
    base: { repo: { id: 4 }, sha: 'base', ref: 'develop' }, head: { repo: { id: 4 }, sha: 'head', ref: 't22' } };
  const run = { id: 44, path: '.github/workflows/agent-review.yml', event: 'pull_request_target', repository: { id: 4 },
    head_repository: { id: 4 }, head_sha: 'head', pull_requests: [pr], status: 'completed', conclusion: 'failure' };
  const job = name => ({ name, run_id: run.id, head_sha: pr.head.sha, conclusion: 'success', steps: [] });
  const jobs = ['gate', 'test', 'review', 'decide'].map(job);
  jobs[2].conclusion = 'failure';
  jobs[2].steps.push({ name: `Validate Claude review ${reviewContext(pr)}`, conclusion: 'success' },
    { name: 'Repeat the review once if its record is invalid', conclusion: 'success' },
    { name: `Validate repeated Claude review ${reviewContext(pr)}`, conclusion: 'failure' });
  return { pr, run, jobs, runs: [run] };
}

test('only the repository bot issue with one same-origin numeric run URL supplies a run ID', () => {
  const repo = 'owner/repo', server = 'https://github.com';
  const line = '- 실행 기록: https://github.com/owner/repo/actions/runs/44';
  const from = (body, login = 'github-actions[bot]') => sourceRun({ user: { login }, body }, repo, server);
  assert.equal(from(line), '44');
  for (const text of [line + '/jobs/12', line.replace('owner', 'fork'), line + '\n' + line, line + ' extra']) assert.equal(from(text), null);
  assert.equal(from(line, 'guest'), null);
});

test('reruns the same full run only when the original validation failed on unchanged review inputs', () => {
  assert.equal(recovery(fixture()), 'rerun');
  assert.equal(recovery({ ...fixture(), sourceId: 11 }), 'hold');
  for (const change of [f => { f.run.head_sha = 'old'; }, f => { f.run.event = 'push'; },
    f => { f.run.path = '.github/workflows/agent-verdict.yml'; }, f => { f.run.repository.id = 5; }, f => { f.run.pull_requests = []; }]) {
    const f = fixture(); change(f); assert.equal(recovery(f), 'reopen');
  }
  for (const change of [f => { f.pr.base.sha = 'new'; }, f => { f.pr.body += '!'; }, f => { f.pr.title += '!'; },
    f => { f.jobs[2].run_id = 99; }, f => { f.jobs[2].steps[2].conclusion = 'skipped'; },
    f => { f.jobs[2].steps[1].conclusion = 'failure'; }, f => { f.jobs[2].steps.push({ name: 'Cleanup', conclusion: 'failure' }); },
    f => { f.jobs[1].conclusion = 'failure'; }]) {
    const f = fixture(); change(f); assert.equal(recovery(f), 'fresh-head');
  }
});

test('deduplicates a full retry already running or a verified request already published in the latest attempt', () => {
  const f = fixture(); f.run.status = 'in_progress'; assert.equal(recovery(f), 'running');
  assert.equal(recovery({ ...f, jobs: [], sourceId: 11 }), 'running');
  f.run.status = 'completed'; f.run.conclusion = 'success'; f.jobs[2].conclusion = 'success'; f.jobs[2].steps[2].conclusion = 'success';
  f.jobs[3].steps.push({ name: 'Publish verified Codex review request', conclusion: 'skipped' });
  assert.equal(recovery(f), 'reopen');
  f.jobs[3].steps[0].conclusion = 'success'; assert.equal(recovery(f), 'published');
  f.jobs[2].steps[0].conclusion = 'failure'; assert.equal(recovery(f), 'published');
  f.jobs[2].steps[0].conclusion = 'success'; f.jobs[2].steps[1].conclusion = 'skipped'; f.jobs[2].steps[2].conclusion = 'skipped';
  assert.equal(recovery(f), 'published');
});

test('an existing same-head collision and human hold get no new review run', () => {
  const f = fixture(); f.runs.push({ ...f.run, id: 45 }); assert.equal(recovery(f), 'collision');
  f.run.path = '.github/workflows/agent-verdict.yml'; assert.equal(recovery(f), 'collision');
  f.pr.labels.push({ name: 'needs-human' }); assert.equal(recovery(f), 'hold');
});

test('CLI dispatches only the original full run in the real repository; repeated close after publication requests no rerun', async t => {
  const { mkdtempSync, rmSync, writeFileSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'review-resume-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const f = fixture(); f.run.run_attempt = 1;
  writeFileSync(join(dir, 'event'), JSON.stringify({ issue: { user: { login: 'github-actions[bot]' }, body: '- 실행 기록: https://github.com/owner/repo/actions/runs/44' } }));
  writeFileSync(join(dir, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs'); const args = process.argv.slice(2); const fixture = JSON.parse(fs.readFileSync('data'));
const path = args.at(-1);
if (args.includes('POST')) { fs.appendFileSync('writes', args.join(' ') + '\\n'); process.exit(0); }
const responses = {
 'repos/owner/repo/pulls/87': fixture.pr, 'repos/owner/repo/actions/runs/44': fixture.run,
 ['repos/owner/repo/actions/runs/44/attempts/' + fixture.run.run_attempt + '/jobs?per_page=100']: { jobs: fixture.jobs },
 'repos/owner/repo/actions/workflows/agent-review.yml/runs?event=pull_request_target&head_sha=head&per_page=100': { total_count: 1, workflow_runs: fixture.runs }
}; if (!responses[path]) process.exit(1); console.log(JSON.stringify(responses[path]));`, { mode: 0o755 });
  function invoke() {
    writeFileSync(join(dir, 'data'), JSON.stringify(f));
    return execFileSync(process.execPath, [new URL('./resume-review.mjs', import.meta.url).pathname, '87'], {
      cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GITHUB_REPOSITORY: 'owner/repo',
        GITHUB_SERVER_URL: 'https://github.com', GITHUB_EVENT_PATH: join(dir, 'event') },
    }).trim();
  }
  assert.equal(invoke(), 'rerun');
  f.run.run_attempt++; f.run.conclusion = 'success'; f.jobs[2].conclusion = 'success'; f.jobs[2].steps[2].conclusion = 'success';
  f.jobs[3].steps.push({ name: 'Publish verified Codex review request', conclusion: 'success' });
  assert.equal(invoke(), 'published');
  assert.equal(readFileSync(join(dir, 'writes'), 'utf8'), 'api --method POST repos/owner/repo/actions/runs/44/rerun\n');
});


test('fixture names come from the integration workflow steps and match the digest from the gate', async () => {
  const { readFileSync } = await import('node:fs');
  const yaml = readFileSync(new URL('../workflows/agent-review.yml', import.meta.url), 'utf8');
  const f = fixture();
  for (const { name } of f.jobs[2].steps) {
    assert.ok(yaml.includes(`- name: ${name.replace(reviewContext(f.pr), '${{ needs.gate.outputs.context }}')}\n`));
  }
  assert.match(yaml, /- name: Publish verified Codex review request\n +if: steps.request.outputs.ready == 'true'/);
});
