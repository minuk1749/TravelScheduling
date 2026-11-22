import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const agent = fileURLToPath(new URL('../', import.meta.url));
function workflow(name) {
  return readFileSync(join(agent, '../workflows', name + '.yml'), 'utf8');
}
export const main = workflow('agent-claude');
export const interrupted = workflow('agent-claude-interrupted');

// Run the checked-in step body. The automation CI runs before npm ci.
export function step(yaml, name) {
  const start = '      - name: ' + name + '\n';
  const body = yaml.split(start)[1];
  assert.ok(body, 'Missing workflow step ' + name);
  const block = body.split(/\n(?=      - |  \w)/)[0];
  const [header, script] = block.split('        run: |\n');
  assert.ok(script, 'Missing inline shell in ' + name);
  return {header, script: script.split('\n').map(line => line.slice(10)).join('\n')};
}

export function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'claude-wip-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const bare = join(root, 'origin.git'), seed = join(root, 'seed'), bin = join(root, 'bin');
  mkdirSync(bin);
  const env = {
    PATH: [bin, dirname(process.execPath), '/usr/bin', '/bin'].join(':'),
    GIT_ALLOW_PROTOCOL: 'file', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(root, 'gitconfig'), GIT_AUTHOR_NAME: 'Fixture', GIT_COMMITTER_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    npm_config_cache: join(root, 'npm-cache'), npm_config_offline: 'true', npm_config_audit: 'false',
    GH_REPO: 'fixture/travel', ID: 'T22', ISSUE: '72', PR: '87', TITLE: 'fixture', GH_MOCK_LOG: join(root, 'gh.log'),
    ROUND: '2', EXEC_FILE: '', GITHUB_RUN_ATTEMPT: '1', PG_SERVICE: 'fixture',
  };
  const git = (cwd, ...args) => execFileSync('git', args, {cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  function stub(name, lines) {
    writeFileSync(join(bin, name), '#!/bin/bash\nset -eu\n' + lines.join('\n') + '\n', {mode: 0o755});
  }
  stub('gh', [
    'echo "$1 $2" >> "$GH_MOCK_LOG"',
    'case "$1 $2" in',
    '  "pr view") [[ $GH_TOKEN == fixture-reader ]] || exit 1; if [[ "$*" == *"--json comments"* ]]; then echo 2; else cat "$RUNNER_TEMP/pr.json"; fi ;;',
    '  "issue view") if [[ $GH_TOKEN == fixture-archiver ]]; then echo "T22: fixture"; else [[ $GH_TOKEN == fixture-reader ]] || exit 1; cat "$RUNNER_TEMP/issue.json"; fi ;;',
    '  "pr list") [[ $GH_TOKEN == fixture-reader ]] ;;',
    '  "pr comment") [[ $GH_TOKEN == fixture-publisher ]] || exit 1; cat > "$RUNNER_TEMP/comment.md"; [[ ${FAIL_COMMENT:-} != yes ]] ;;',
    '  "pr edit"|"pr create"|"issue edit"|"issue comment") [[ $GH_TOKEN == fixture-publisher ]] ;;',
    '  "label create") [[ $GH_TOKEN == fixture-archiver || $GH_TOKEN == fixture-publisher ]] ;;',
    '  "issue create") [[ $GH_TOKEN == fixture-archiver ]] ;;',
    '  *) exit 2 ;;',
    'esac',
  ]);
  // Substitute the two read-only mounts in the real container command and use a fresh local directory.
  stub('docker', [
    'if [[ $1 == inspect ]]; then echo fixture; exit 0; fi',
    '[[ $1 == run && -z ${USER_PAT:-} && -z ${GH_TOKEN:-} ]] || exit 1',
    'script=${!#}',
    'while (( $# )); do',
    '  if [[ $1 == -e && $2 == CANDIDATE_TREE=* ]]; then export CANDIDATE_TREE="${2#CANDIDATE_TREE=}"; fi',
    '  if [[ $1 == -v ]]; then',
    '    case "$2" in *:/source:ro) source=${2%:/source:ro} ;; *:/check-required.sh:ro) check=${2%:/check-required.sh:ro} ;; *) exit 2 ;; esac',
    '  fi',
    '  shift',
    'done',
    'mkdir "$RUNNER_TEMP/container"; cd "$RUNNER_TEMP/container"',
    'printf -v quoted_source "%q" "$source/"',
    'printf -v quoted_check "%q" "$check"',
    'script=${script/\\/source\\//"$quoted_source"}',
    'script=${script/\\/check-required.sh/"$quoted_check"}',
    'exec /bin/bash -ec "$script"',
  ]);
  stub('cat', ['if [[ ${1:-} == /proc/sys/kernel/random/uuid ]]; then echo fixture; else exec /bin/cat "$@"; fi']);
  stub('npx', ['[[ "$*" == "playwright install --with-deps chromium" ]]']); // No browser download for the fixture.
  git(root, 'init', '-q', '--bare', '-b', 'develop', bare);
  for (const token of ['fixture-reader', 'fixture-archiver', 'fixture-publisher']) {
    git(root, 'config', '--global', '--add', 'url.' + bare + '.insteadOf', 'https://x-access-token:' + token + '@github.com/fixture/travel.git');
  }
  git(root, 'init', '-q', '-b', 'develop', seed);
  const control = join(seed, '.github/agent');
  mkdirSync(control, {recursive: true});
  for (const name of ['claude-wip.sh', 'claude-candidate.sh', 'claude-publish.sh', 'check-pr.mjs', 'check-required.sh', 'stage-work.sh', 'tasks.mjs']) copyFileSync(join(agent, name), join(control, name));
  const commands = ['lint', 'typecheck', 'build', 'test', 'test:e2e'];
  writeFileSync(join(seed, 'package.json'), JSON.stringify({
    name: 'fixture', version: '1.0.0', scripts: Object.fromEntries(commands.map(command => [command, 'node check.cjs'])),
  }));
  writeFileSync(join(seed, 'package-lock.json'), JSON.stringify({name: 'fixture', version: '1.0.0', lockfileVersion: 3,
    packages: {'': {name: 'fixture', version: '1.0.0'}}}));
  writeFileSync(join(seed, 'check.cjs'), [
    'const fs = require("node:fs"); const command = process.env.npm_lifecycle_event;',
    'fs.appendFileSync(process.env.RUNNER_TEMP + "/checks", command + "\\n");',
    'if (command === "test" && fs.readFileSync("candidate.txt", "utf8") === "broken") process.exit(1);',
  ].join('\n'));
  mkdirSync(join(seed, 'docs'));
  writeFileSync(join(seed, 'docs/tasks.md'), '| T22 | fixture | - | Y | 리뷰 | claude | topic | #87 |\n');
  writeFileSync(join(seed, 'AGENTS.md'), 'protected');
  writeFileSync(join(seed, 'candidate.txt'), 'develop');
  git(seed, 'add', '.'); git(seed, 'commit', '-qm', 'develop');
  const base = git(seed, 'rev-parse', 'HEAD');
  git(seed, 'checkout', '-qb', 'topic');
  writeFileSync(join(seed, 'candidate.txt'), 'original PR');
  git(seed, 'commit', '-qam', 'original PR');
  const head = git(seed, 'rev-parse', 'HEAD');
  git(seed, 'push', '-q', bare, 'develop', 'topic');

  function advanceDevelop() {
    git(seed, 'checkout', '-q', 'develop');
    writeFileSync(join(seed, 'upstream.txt'), 'parallel development');
    git(seed, 'add', 'upstream.txt');
    git(seed, 'commit', '-qm', 'advance develop');
    git(seed, 'push', '-q', bare, 'develop');
    return git(seed, 'rev-parse', 'HEAD');
  }

  function run(yaml, name, cwd, vars) {
    const output = join(vars.RUNNER_TEMP, 'output');
    writeFileSync(output, '');
    const result = spawnSync('/bin/bash', ['-c', step(yaml, name).script], {
      cwd, env: {...env, GITHUB_SHA: base, ...vars, GITHUB_OUTPUT: output}, encoding: 'utf8', timeout: 60_000,
    });
    assert.ifError(result.error);
    return {cwd, temp: vars.RUNNER_TEMP, code: result.status, error: result.stderr + result.stdout, fields: Object.fromEntries(
      readFileSync(output, 'utf8').trim().split('\n').filter(Boolean).map(line => line.split('=')))};
  }
  function runner(number, tip = head, pr = '87', issue = '72') {
    const cwd = mkdtempSync(join(root, 'work-')), temp = mkdtempSync(join(root, 'run-'));
    git(root, 'clone', '-q', bare, cwd);
    git(cwd, 'checkout', '-q', '--detach', tip);
    git(cwd, 'clone', '-q', '-b', 'develop', bare, '.ctl');
    appendFileSync(join(cwd, '.git/info/exclude'), '\n.ctl/\n');
    const vars = {GITHUB_RUN_NUMBER: String(number), GITHUB_SHA: git(bare, 'rev-parse', 'develop'),
      HEAD_SHA: pr ? tip : '', RUNNER_TEMP: temp, PR: pr, ISSUE: issue, ATTEMPT: '1'};
    return {cwd, temp, vars, run: (name, extra = {}) => run(main, name, cwd, {...vars, ...extra})};
  }
  function unpack(worker) {
    const temp = mkdtempSync(join(root, 'job-'));
    mkdirSync(join(temp, 'archive'));
    for (const file of ['claude-wip.bundle', 'claude-report.md']) {
      if (existsSync(join(worker.temp, file))) copyFileSync(join(worker.temp, file), join(temp, 'archive', file));
    }
    return temp;
  }
  function isolated(name, worker, wip, extra = {}) {
    const temp = unpack(worker);
    git(temp, 'clone', '-q', '--no-checkout', bare, 'control');
    git(join(temp, 'control'), 'checkout', '-q', '--detach', worker.vars.GITHUB_SHA);
    const {prData = {}, issueData = {}, ...overrides} = extra;
    const jobs = [['ci', 'check'], ...['gate', 'test', 'review', 'decide'].map(check => ['agent-review', check])];
    writeFileSync(join(temp, 'pr.json'), JSON.stringify({state: 'OPEN', isDraft: false, isCrossRepository: false,
      title: 'T22: fixture', headRefName: 'topic', headRefOid: git(bare, 'rev-parse', 'topic'),
      baseRefName: 'develop', labels: [], statusCheckRollup: jobs.map(([workflowName, check]) =>
        ({workflowName, name: check, status: 'COMPLETED', conclusion: 'SUCCESS'})), ...prData}));
    writeFileSync(join(temp, 'issue.json'), JSON.stringify({state: 'OPEN', title: 'T22: fixture', ...issueData}));
    return run(main, name, temp, {...worker.vars, RUNNER_TEMP: temp, WIP: wip, ...overrides});
  }
  function verify(worker, wip, extra) { return isolated('Verify bundled candidate', worker, wip, extra); }
  function publish(worker, wip, commit, extra = {}) {
    return isolated('Publish verified commit', worker, wip, {
      GH_TOKEN: 'fixture-reader', USER_PAT: 'fixture-publisher', VERIFIED_COMMIT: commit, ...extra,
    });
  }
  function archive(worker, wip, extra = {}) {
    const temp = unpack(worker);
    return run(interrupted, 'Store interrupted candidate on a WIP branch', temp, {
      ...worker.vars, RUNNER_TEMP: temp, WIP: wip, GH_TOKEN: 'fixture-archiver', ...extra,
    });
  }
  function pause(wip) {
    const temp = mkdtempSync(join(root, 'pause-'));
    const result = run(interrupted, 'Pause on failure', temp, {
      RUNNER_TEMP: temp, WIP: wip, GH_TOKEN: 'fixture-archiver', RUN_URL: 'https://example.invalid/run',
    });
    assert.equal(result.code, 0, result.error);
    return readFileSync(join(temp, 'p.md'), 'utf8');
  }
  return {bare, base, head, runner, verify, publish, archive, pause, advanceDevelop,
    ghLog: () => readFileSync(env.GH_MOCK_LOG, 'utf8'), remote: (...args) => git(bare, ...args), git};
}
