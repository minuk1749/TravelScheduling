import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { combineReviews, validateRequest, validateReview } from './review-record.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const head = 'f'.repeat(40);
const approval = {
  verdict: 'approve', summary: 'Verified', notes: '', issues: [], refactor: [],
  evidence: [{ criterion: 'Handle an empty list', source: 'unit test', status: 'verified', method: 'ci' }],
};
const incomplete = {
  ...approval, verdict: 'needs_human',
  evidence: [{ criterion: 'Data migration recovery', source: 'No recovery check', status: 'unverified', method: 'unverified' }],
};
const changes = {
  ...approval, verdict: 'request_changes',
  issues: [{ file: 'service.ts', problem: 'Wrong status', fix: 'Return the expected status' }],
};
const request = { pr: 12, run: 45, attempt: 2, issue: 11, head, base: 'develop', tests: 'passed', task: 'T4', owner: 'gpt', claude: approval };

test('approval requires evidence and cannot contain unresolved criteria or defects', () => {
  assert.throws(() => validateReview({ ...approval, evidence: [] }), /근거가 비어/);
  assert.throws(() => validateReview({ ...incomplete, verdict: 'approve' }), /검증이 끝나지/);
  assert.throws(() => validateReview({ ...changes, verdict: 'approve' }), /수정 항목/);
});

test('the test record must match the target PR, commit and workflow attempt', () => {
  assert.equal(validateRequest(request, { pr: 12, head, run: 45, attempt: 2 }), request);
  assert.throws(() => validateRequest({ ...request, tests: 'failed' }, {}), /기록이 잘못/);
  assert.throws(() => validateRequest(request, { pr: 13 }), /일치하지/);
  assert.throws(() => validateRequest(request, { head: '0'.repeat(40) }), /일치하지/);
  assert.throws(() => validateRequest(request, { run: 44, attempt: 1 }), /일치하지/);
});

test('both implementation owners need two independent approvals', () => {
  for (const owner of ['gpt', 'claude']) {
    const record = { ...request, owner };
    assert.throws(() => validateRequest({ ...record, claude: null }, {}));
    assert.throws(() => combineReviews({ ...record, claude: null }, approval));
    assert.equal(combineReviews(validateRequest(record, {}), approval).verdict, 'approve');
    assert.equal(combineReviews(record, changes).verdict, 'request_changes');
    assert.equal(combineReviews(record, incomplete).verdict, 'needs_human');
    assert.equal(combineReviews({ ...record, claude: changes }, approval).verdict, 'request_changes');
    assert.equal(combineReviews({ ...record, claude: incomplete }, approval).verdict, 'needs_human');
    assert.equal(combineReviews({ ...record, claude: changes }, incomplete).verdict, 'request_changes');
  }
  assert.match(combineReviews({ ...request, owner: 'claude' }, approval).summary, /Claude 자체 리뷰.*Codex 교차 리뷰/s);
  assert.match(combineReviews(request, approval).summary, /Claude 교차 리뷰.*Codex 자체 리뷰/s);
});

function sandbox(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-review-test-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return cwd;
}

function stub(cwd, name, body) {
  writeFileSync(join(cwd, name), `#!/bin/bash\nset -eu\n${body}\n`, { mode: 0o755 });
}

test('missing mandatory npm scripts stop the test job, and failing scripts stop later checks', (t) => {
  const cwd = sandbox(t);
  stub(cwd, 'npm', 'echo "$*" >> invoked\n[ "$*" != "run typecheck" ]');
  const env = { ...process.env, PATH: `${cwd}:${process.env.PATH}` };
  const check = () => spawnSync('bash', [join(here, 'check-required.sh')], { cwd, env, encoding: 'utf8' });
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ scripts: { lint: 'x', typecheck: 'x', build: 'x' } }));
  const missing = check();
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /필수 npm 스크립트 누락: test/);
  assert.throws(() => readFileSync(join(cwd, 'invoked')), { code: 'ENOENT' });

  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ scripts: { lint: 'x', typecheck: 'x', build: 'x', test: 'x' } }));
  assert.notEqual(check().status, 0);
  assert.equal(readFileSync(join(cwd, 'invoked'), 'utf8'), 'ci\nrun lint\nrun typecheck\n');
});

const passedJob = (workflowName, name, conclusion = 'SUCCESS') => ({ workflowName, name, conclusion, status: 'COMPLETED' });
const jobs = [passedJob('ci', 'check'), ...['gate', 'test', 'review', 'decide'].map(name => passedJob('agent-review', name))];
const openPr = { state: 'OPEN', isDraft: false, isCrossRepository: false, headRefOid: head, baseRefName: 'develop', labels: [], statusCheckRollup: jobs };

test('publication checks the current head and the actual jobs for each implementation owner', t => {
  const cwd = sandbox(t);
  stub(cwd, 'gh', 'cat pr.json');
  const env = { ...process.env, PATH: `${cwd}:${process.env.PATH}` };
  const check = (snapshot, owner = 'gpt') => {
    writeFileSync(join(cwd, 'pr.json'), JSON.stringify(snapshot));
    return spawnSync(process.execPath, [join(here, 'check-pr.mjs'), 'fixture/travel', '12', head, owner], { cwd, env }).status;
  };
  assert.equal(check(openPr), 0);
  assert.notEqual(check({ ...openPr, headRefOid: '0'.repeat(40) }), 0);
  assert.notEqual(check({ ...openPr, statusCheckRollup: jobs.slice(1) }), 0);
  for (const state of ['FAILURE', 'CANCELLED', 'SKIPPED', 'TIMED_OUT']) {
    const withGate = jobs.map(job => job.name === 'gate' ? { ...job, conclusion: state } : job);
    assert.notEqual(check({ ...openPr, statusCheckRollup: withGate }), 0);
  }
  assert.notEqual(check({ ...openPr, statusCheckRollup: jobs.map(job => ({ ...job, status: 'IN_PROGRESS' })) }), 0);
  for (const owner of ['gpt', 'claude']) {
    assert.equal(check(openPr, owner), 0);
    const skipped = { ...openPr, statusCheckRollup: jobs.map(job => job.name === 'review' ? { ...job, conclusion: 'SKIPPED' } : job) };
    assert.notEqual(check(skipped, owner), 0);
  }
});

test('merge always pins the reviewed commit and a new head does not enter the feedback loop', (t) => {
  const cwd = sandbox(t);
  const pr = { state: 'open', draft: false, base: { ref: 'develop' }, head: { sha: head, repo: { full_name: 'fixture/travel' } }, title: 'T4: test', labels: [] };
  const next = { ...pr, head: { ...pr.head, sha: '0'.repeat(40) } };
  stub(cwd, 'git', '[[ "$1" == config ]]');
  stub(cwd, 'gh', `
case "$1 $2" in
  'api repos/fixture/travel/pulls/12')
    if [ -f attempted ]; then printf '%s\\n' '${JSON.stringify(next)}'; else printf '%s\\n' '${JSON.stringify(pr)}'; fi ;;
  'pr view') printf '%s\\n' '${JSON.stringify(openPr)}' ;;
  'pr edit') : ;;
  'pr merge') printf '%s\\n' "$*" > attempted; exit 1 ;;
  *) printf '%s\\n' "$*" >> unexpected; exit 2 ;;
esac`);
  const env = {
    ...process.env, PATH: `${cwd}:${process.env.PATH}`, RUNNER_TEMP: cwd,
    GITHUB_REPOSITORY: 'fixture/travel', PR: '12', TASK: 'T4', HEAD_SHA: head,
    PASSED: 'true', R_TEST: 'success', R_REVIEW: 'success', REVIEW_JSON: JSON.stringify(approval),
  };
  const result = spawnSync('bash', [join(here, 'decide.sh')], { cwd, env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(join(cwd, 'attempted'), 'utf8'), new RegExp(`--match-head-commit ${head}`));
  assert.throws(() => readFileSync(join(cwd, 'unexpected')), { code: 'ENOENT' });
});

test('a failed agent test pauses both owners without dispatching a fix or publishing', t => {
  const cwd = sandbox(t);
  const pr = { state: 'open', draft: false, base: { ref: 'develop' }, head: { sha: head, repo: { full_name: 'fixture/travel' } }, title: 'T4: test', labels: [] };
  stub(cwd, 'git', '[[ "$1" == config ]]');
  stub(cwd, 'gh', `
case "$1 $2" in
  'api repos/fixture/travel/pulls/12') printf '%s\\n' '${JSON.stringify(pr)}' ;;
  'issue create') printf '%s\\n' "$*" >> pauses ;;
  *) printf '%s\\n' "$*" >> unexpected; exit 2 ;;
esac`);
  for (const owner of ['gpt', 'claude']) {
    const env = {
      ...process.env, PATH: `${cwd}:${process.env.PATH}`, RUNNER_TEMP: cwd,
      GITHUB_REPOSITORY: 'fixture/travel', PR: '12', TASK: 'T4', HEAD_SHA: head,
      ROUND: '1', OWNER: owner, PASSED: 'false', R_TEST: 'failure', R_REVIEW: 'skipped',
    };
    const result = spawnSync('bash', [join(here, 'decide.sh')], { cwd, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  assert.equal(readFileSync(join(cwd, 'pauses'), 'utf8').match(/--label agent-paused/g).length, 2);
  assert.throws(() => readFileSync(join(cwd, 'unexpected')), { code: 'ENOENT' });
});
