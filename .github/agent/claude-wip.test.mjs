import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fixture, interrupted, main, step } from './fixtures/claude-wip.mjs';

const restore = 'Restore interrupted work', candidate = 'Prepare candidate', prepare = 'Prepare interrupted candidate';
const checks = ['lint', 'typecheck', 'build', 'test', 'test:e2e'];

function passed(result) {
  assert.equal(result.code, 0, result.error);
  return result.fields;
}

function packageCandidate(worker, text) {
  const {base} = passed(worker.run(restore));
  passed(worker.run('Merge develop (fix round or resumed work)'));
  if (text !== undefined) writeFileSync(join(worker.cwd, 'candidate.txt'), text);
  return passed(worker.run(candidate, {BASE_SHA: base})).wip;
}

function verified(f, worker, wip) {
  const job = f.verify(worker, wip);
  const {commit} = passed(job);
  assert.deepEqual(readFileSync(join(job.temp, 'checks'), 'utf8').trim().split('\n'), checks);
  return commit;
}

test('a rejected push archives the verified commit and a fresh run rechecks it before publishing', t => {
  const f = fixture(t), first = f.runner(15);
  const wip = packageCandidate(first, 'tested bytes');
  assert.equal(wip, 'wip/claude/t22-72/pr87/15.1-' + f.head);
  const commit = f.git(first.cwd, 'rev-parse', 'HEAD');
  assert.equal(f.git(first.cwd, 'bundle', 'list-heads', join(first.temp, 'claude-wip.bundle')),
    commit + ' refs/heads/' + wip);
  writeFileSync(join(first.cwd, 'candidate.txt'), 'later workspace change');
  f.git(first.cwd, 'add', 'candidate.txt');
  assert.notEqual(f.git(first.cwd, 'write-tree'), f.git(first.cwd, 'rev-parse', commit + '^{tree}'));
  assert.equal(verified(f, first, wip), commit);
  rmSync(first.cwd, {recursive: true}); // The publisher cannot use the author's working copy or index.
  const hook = join(f.bare, 'hooks/pre-receive');
  writeFileSync(hook, '#!/bin/sh\nwhile read old new ref; do [ "$ref" != refs/heads/topic ] || exit 1; done\n', {mode: 0o755});
  const failed = f.publish(first, wip, commit);
  assert.notEqual(failed.code, 0);
  assert.match(failed.error, /pre-receive hook declined/);
  assert.equal(f.remote('rev-parse', 'topic'), f.head);
  assert.deepEqual(passed(f.archive(first, wip)), {wip});
  assert.equal(f.remote('rev-parse', wip), commit);
  assert.equal(f.remote('show', wip + ':candidate.txt'), 'tested bytes');
  const sibling = wip.replace('/pr87/', '/pr88/');
  f.remote('update-ref', 'refs/heads/' + sibling, wip);
  f.remote('update-ref', 'refs/heads/' + wip.replace('/15.1-', '/9.2-'), wip);
  unlinkSync(hook);

  const retry = f.runner(16);
  assert.deepEqual(passed(retry.run(restore)), {base: f.head, wip});
  passed(retry.run('Merge develop (fix round or resumed work)'));
  const nextWip = passed(retry.run(candidate, {BASE_SHA: f.head})).wip;
  assert.equal(verified(f, retry, nextWip), commit);
  const posted = f.publish(retry, nextWip, commit);
  passed(posted);
  assert.equal(existsSync(join(posted.temp, 'source')), false);
  assert.match(readFileSync(join(posted.temp, 'comment.md'), 'utf8'), /작업 이슈: #72/);
  assert.equal(f.remote('rev-parse', 'topic'), commit);
  assert.equal(f.remote('for-each-ref', '--format=%(refname:short)', 'refs/heads/wip/'), sibling);
});

test('missing publish credential preserves the verified merge and both parents', t => {
  const f = fixture(t), develop = f.advanceDevelop(), worker = f.runner(30);
  const wip = packageCandidate(worker, 'verified merge'), commit = verified(f, worker, wip);
  assert.notEqual(f.publish(worker, wip, commit, {USER_PAT: ''}).code, 0);
  passed(f.archive(worker, wip));
  assert.equal(f.remote('rev-parse', wip), commit);
  assert.deepEqual(f.remote('rev-list', '--parents', '-1', wip).split(' ').slice(1), [f.head, develop]);
  assert.equal(f.remote('rev-parse', 'topic'), f.head);
});

test('a failed PR comment keeps the original WIP scope and can finish after the published HEAD passes checks', t => {
  const f = fixture(t), worker = f.runner(35);
  const wip = packageCandidate(worker, 'published commit'), commit = verified(f, worker, wip);
  assert.notEqual(f.publish(worker, wip, commit, {FAIL_COMMENT: 'yes'}).code, 0);
  assert.equal(f.remote('rev-parse', 'topic'), commit);
  passed(f.archive(worker, wip));
  assert.equal(f.remote('rev-parse', wip), commit);
  assert.deepEqual(passed(f.runner(36, commit).run(restore)), {base: commit, wip: ''});
  passed(f.publish(worker, wip, commit));
  assert.equal(f.remote('rev-parse', 'topic'), commit);
});

test('restore binds the task, issue, PR and exact original HEAD even when the new HEAD is an ancestor', t => {
  const f = fixture(t), worker = f.runner(42);
  const {base} = passed(worker.run(restore));
  writeFileSync(join(worker.cwd, 'candidate.txt'), 'work in progress');
  const {wip} = passed(worker.run(prepare, {BASE_SHA: base}));
  passed(f.archive(worker, wip));
  const tip = f.remote('rev-parse', wip);
  f.remote('update-ref', 'refs/heads/wip/t22-pr87-999', tip); // Legacy PR ref has no original SHA.
  for (const [pr, issue, id] of [['88', '72', 'T22'], ['87', '73', 'T22'], ['87', '72', 'T23'], ['', '72', 'T22']]) {
    const retry = f.runner(43, f.head, pr, issue);
    assert.equal(passed(retry.run(restore, {ID: id})).wip, '');
  }
  for (const changed of [f.base, tip]) {
    f.remote('update-ref', 'refs/heads/topic', changed);
    const retry = f.runner(44, changed);
    assert.equal(passed(retry.run(restore)).wip, '');
    assert.equal(f.git(retry.cwd, 'rev-parse', 'HEAD'), changed);
  }
  assert.notEqual(f.archive(worker, 'topic').code, 0);
  assert.notEqual(f.archive(worker, wip.replace('/pr87/', '/pr88/')).code, 0);
  assert.notEqual(f.archive(worker, wip.replace('/42.1-', '/43.1-')).code, 0); // Bundle has no such ref.
  assert.equal(f.remote('rev-parse', 'topic'), tip);

  // Numeric legacy refs belonged to new tasks. PR recovery must never consume them.
  f.remote('update-ref', 'refs/heads/wip/t22-999', tip);
  assert.equal(passed(f.runner(45, f.base, '').run(restore)).wip, 'wip/t22-999');
  assert.equal(passed(f.runner(46, f.base).run(restore)).wip, '');
});

test('interrupted pre-verification work stays on WIP when required checks fail on resume', t => {
  const f = fixture(t), worker = f.runner(50);
  const {base} = passed(worker.run(restore));
  writeFileSync(join(worker.cwd, 'candidate.txt'), 'broken');
  writeFileSync(join(worker.cwd, 'AGENTS.md'), 'working copy edit');
  const {wip} = passed(worker.run(prepare, {BASE_SHA: base}));
  passed(f.archive(worker, wip));
  assert.equal(f.remote('show', wip + ':AGENTS.md'), 'protected');
  const retry = f.runner(51);
  assert.equal(passed(retry.run(restore)).wip, wip);
  const nextWip = passed(retry.run(candidate, {BASE_SHA: base})).wip;
  const failed = f.verify(retry, nextWip);
  assert.notEqual(failed.code, 0);
  assert.equal(failed.fields.commit, undefined);
  assert.deepEqual(readFileSync(join(failed.temp, 'checks'), 'utf8').trim().split('\n'), checks.slice(0, 4));
  assert.notEqual(f.publish(retry, nextWip, '').code, 0);
  assert.equal(f.remote('rev-parse', 'topic'), f.head);
  assert.equal(f.remote('show', wip + ':candidate.txt'), 'broken');
});

test('separate hosted runners confine USER_PAT to publishing after verification of the same artifact', () => {
  function job(name) {
    const start = '\n  ' + name + ':\n';
    assert.ok(main.includes(start), name + ' must be a separate Actions job');
    return main.split(start)[1].split(/\n  [a-z-]+:\n/)[0];
  }
  const author = job('claude'), verify = job('verify'), publish = job('publish');
  for (const job of [author, verify, publish]) assert.match(job, /runs-on: ubuntu-latest/);
  assert.doesNotMatch(author + verify, /secrets\.USER_PAT|(?:contents|issues|pull-requests): write/);
  assert.match(author, /DATABASE_URL: postgresql:/);
  assert.match(verify, /services:\n      postgres:/);
  assert.match(verify, /needs: claude/);
  assert.match(publish, /needs: \[claude, verify\]/);
  for (const job of [verify, publish]) {
    assert.match(job, /ref: \$\{\{ github.sha \}\}/);
    assert.match(job, /name: claude-wip-\$\{\{ needs.claude.outputs.attempt \}\}/);
    assert.doesNotMatch(job, /continue-on-error|if: always/);
  }
  assert.match(publish, /VERIFIED_COMMIT: \$\{\{ needs.verify.outputs.commit \}\}/);
  assert.equal(main.split('secrets.USER_PAT').length - 1, 1);
  assert.match(step(main, 'Publish verified commit').header, /USER_PAT: \$\{\{ secrets.USER_PAT \}\}/);
  assert.match(interrupted, /uses: actions\/download-artifact@v4/);
  assert.match(main, /needs: \[claude, verify, publish\]/);
  assert.doesNotMatch(interrupted, /USER_PAT|uses: actions\/checkout|pull-requests: write/);
  assert.match(step(interrupted, 'Store interrupted candidate on a WIP branch').header, /GH_TOKEN: \$\{\{ github.token \}\}/);
});

test('publication refuses another verified commit, stale or held PRs, and a protected destination', t => {
  const f = fixture(t), worker = f.runner(80);
  const wip = packageCandidate(worker, 'valid candidate'), commit = verified(f, worker, wip);
  assert.notEqual(f.publish(worker, wip, f.head).code, 0);
  for (const prData of [{headRefOid: f.base}, {labels: [{name: 'needs-human'}]}, {statusCheckRollup: []},
    {headRefName: 'develop'}, {isCrossRepository: true}, {title: 'T23: another task'}]) {
    assert.notEqual(f.publish(worker, wip, commit, {prData}).code, 0, JSON.stringify(prData));
  }
  assert.equal(f.remote('rev-parse', 'topic'), f.head);
  assert.equal(f.remote('rev-parse', 'develop'), f.base);
  assert.doesNotMatch(f.ghLog(), /pr comment|pr edit/);
});

test('replacing the bundle after verification cannot publish new bytes or protected changes', t => {
  const f = fixture(t), worker = f.runner(82);
  const wip = packageCandidate(worker, 'first revision'), commit = verified(f, worker, wip);
  const ref = 'refs/heads/' + wip;
  function repack(name, content) {
    writeFileSync(join(worker.cwd, name), content);
    f.git(worker.cwd, 'commit', '-qam', 'fixture revision');
    f.git(worker.cwd, 'update-ref', ref, 'HEAD');
    f.git(worker.cwd, 'bundle', 'create', join(worker.temp, 'claude-wip.bundle'), ref);
  }
  repack('candidate.txt', 'second revision');
  assert.notEqual(f.publish(worker, wip, commit).code, 0);
  repack('AGENTS.md', 'changed protected file');
  const failed = f.verify(worker, wip);
  assert.notEqual(failed.code, 0);
  assert.equal(failed.fields.commit, undefined);
  assert.equal(existsSync(join(failed.temp, 'checks')), false);
  assert.equal(f.remote('rev-parse', 'topic'), f.head);
});

test('new tasks create a PR from the verified commit and unchanged tasks request human review', t => {
  const f = fixture(t), first = f.runner(90, f.base, '');
  const noChange = packageCandidate(first);
  passed(f.publish(first, noChange, verified(f, first, noChange)));
  assert.match(f.ghLog(), /issue edit/);
  assert.doesNotMatch(f.ghLog(), /pr create/);
  const next = f.runner(91, f.base, '');
  const wip = packageCandidate(next, 'new implementation'), commit = verified(f, next, wip);
  passed(f.publish(next, wip, commit));
  assert.equal(f.remote('rev-parse', 't22-claude'), commit);
  assert.match(f.ghLog(), /pr create/);
});

test('the pause message keeps the resume marker and names only a successfully stored WIP', t => {
  const f = fixture(t), wip = 'wip/claude/t22-72/pr87/65.1-' + f.head;
  const withoutBranch = f.pause('');
  assert.match(withoutBranch, /<!-- resume:claude issue=72 pr=87 -->/);
  assert.doesNotMatch(withoutBranch, /wip\//);
  assert.ok(f.pause(wip).includes(wip));
  const pause = step(interrupted, 'Pause on failure');
  assert.match(pause.header, /if: always\(\)/);
  assert.match(pause.header, /WIP: \$\{\{ steps\.archive\.outputs\.wip \}\}/);
});
