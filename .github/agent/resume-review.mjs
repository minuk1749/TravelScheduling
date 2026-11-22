import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// On Actions the REST run.pull_requests array tracks the live PR. Record the event inputs in
// a trusted review step name so a rerun of the old event cannot silently review old prose or base.
export function reviewContext(pr) {
  const fields = [pr.number, pr.base.repo.id, pr.base.ref, pr.base.sha, pr.head.repo.id, pr.head.ref, pr.head.sha,
    pr.user.login, pr.title, pr.body ?? ''];
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

export function sourceRun(issue, repo, server) {
  if (issue.user.login !== 'github-actions[bot]') return null;
  const prefix = `- 실행 기록: ${server}/${repo}/actions/runs/`;
  const sources = issue.body.split(/\r?\n/).filter(line => line.startsWith(prefix));
  const id = sources.length === 1 ? sources[0].slice(prefix.length) : '';
  return /^[1-9]\d*$/.test(id) ? id : null;
}

function eligible(pr) {
  return pr.state === 'open' && !pr.draft && pr.base.ref === 'develop' && pr.head.repo?.id === pr.base.repo.id
    && !pr.labels.some(label => label.name === 'needs-human');
}

export function recovery({ pr, run, jobs, runs, sourceId = run.id }) {
  if (!eligible(pr)) return 'hold';
  const samePR = item => item.head_sha === pr.head.sha && item.pull_requests.some(link => link.id === pr.id);
  const current = runs.filter(samePR);
  if (current.length > 1) return 'collision';
  if (run.path !== '.github/workflows/agent-review.yml' || run.event !== 'pull_request_target'
    || run.repository.id !== pr.base.repo.id || run.head_repository?.id !== pr.head.repo.id
    || run.head_sha !== pr.head.sha || !run.pull_requests.some(item => item.id === pr.id)) return 'reopen';
  const job = name => jobs.find(item => item.name === name && item.run_id === run.id && item.head_sha === pr.head.sha);
  const gate = job('gate'), test = job('test'), review = job('review'), decide = job('decide');
  const key = reviewContext(pr);
  const initial = review?.steps.find(step => step.name === `Validate Claude review ${key}`);
  const repeat = review?.steps.find(step => step.name === 'Repeat the review once if its record is invalid');
  const final = review?.steps.find(step => step.name === `Validate repeated Claude review ${key}`);
  // Reopening a failed run's *same* HEAD leaves a red check permanently in that HEAD's rollup.
  // A changed body/base or older unsigned workflow needs a fresh PR HEAD and a fresh event.
  const fallback = run.conclusion === 'failure' ? 'fresh-head' : 'reopen';
  if (run.status !== 'completed') return 'running';
  if (!initial || !final || gate?.conclusion !== 'success' || test?.conclusion !== 'success') return fallback;
  if (run.conclusion === 'failure' && review.conclusion === 'failure' && decide?.conclusion === 'success'
    && repeat?.conclusion === 'success' && final.conclusion === 'failure'
    && review.steps.every(step => step.conclusion !== 'failure' || step === initial || step === final)) return run.id === sourceId ? 'rerun' : 'hold';
  const valid = final.conclusion === 'success' && repeat?.conclusion === 'success'
    || initial.conclusion === 'success' && final.conclusion === 'skipped' && repeat?.conclusion === 'skipped';
  if (valid && run.conclusion === 'success' && review.conclusion === 'success' && decide?.conclusion === 'success'
    && decide.steps.some(step => step.name === 'Publish verified Codex review request' && step.conclusion === 'success')) return 'published';
  return fallback;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  if (process.argv[2] === 'context') {
    console.log(reviewContext(event.pull_request));
  } else {
    const repo = process.env.GITHUB_REPOSITORY;
    const prNumber = process.argv[2];
    if (!/^[1-9]\d*$/.test(prNumber)) throw new Error('올바른 PR 번호가 필요합니다.');
    const api = path => JSON.parse(execFileSync('gh', ['api', `repos/${repo}/${path}`], { encoding: 'utf8' }));
    const pr = api(`pulls/${prNumber}`);
    if (!eligible(pr) || event.issue.user.login !== 'github-actions[bot]') { console.log('hold'); process.exit(0); }
    const runId = sourceRun(event.issue, repo, process.env.GITHUB_SERVER_URL);
    if (!runId) { console.log('reopen'); process.exit(0); }
    const source = api(`actions/runs/${runId}`);
    const runs = api(`actions/workflows/agent-review.yml/runs?event=pull_request_target&head_sha=${pr.head.sha}&per_page=100`);
    const sameHeadRuns = runs.workflow_runs.filter(run => run.head_sha === pr.head.sha && run.pull_requests.some(link => link.id === pr.id));
    // An old pause may close after a new push has already queued a review for the current PR.
    const run = sameHeadRuns.length === 1 && sameHeadRuns[0].id !== source.id ? api(`actions/runs/${sameHeadRuns[0].id}`) : source;
    const attempt = run.status === 'completed' ? run.run_attempt : run.run_attempt - 1;
    const jobs = run.path === '.github/workflows/agent-review.yml' && attempt > 0
      ? api(`actions/runs/${run.id}/attempts/${attempt}/jobs?per_page=100`).jobs : [];
    let action = runs.total_count > runs.workflow_runs.length ? 'collision' : recovery({ pr, run, jobs, runs: runs.workflow_runs, sourceId: source.id });
    if (action === 'published' && run.id !== source.id && !pr.labels.some(label => label.name === 'needs-codex-review')) action = 'reopen';
    if (action === 'rerun') {
      // Full run, including tests and artifact publication in the same attempt as the review.
      execFileSync('gh', ['api', '--method', 'POST', `repos/${repo}/actions/runs/${runId}/rerun`], { stdio: ['ignore', 'ignore', 'inherit'] });
    }
    console.log(action);
  }
}
