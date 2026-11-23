import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Only a successful standard CI check on the exact candidate can replace the common suite.
// The workflow file, check driver and automation tests must also match the trusted base.
export function completedCommonRun(pr, runs, getJobs) {
  const candidates = runs.workflow_runs.filter(run =>
    run.path === '.github/workflows/ci.yml' && run.event === 'pull_request' &&
    run.repository?.id === pr.base.repo.id && run.head_repository?.id === pr.head.repo.id &&
    run.head_sha === pr.head.sha && run.status === 'completed' && run.conclusion === 'success' &&
    run.pull_requests.some(link => link.id === pr.id && link.number === pr.number));
  if (runs.total_count !== runs.workflow_runs.length || candidates.length !== 1) return null;
  const [run] = candidates;
  const jobs = getJobs(run.id, run.run_attempt).jobs.filter(job =>
    job.run_id === run.id && job.head_sha === pr.head.sha && job.name === 'check');
  if (jobs.length !== 1 || jobs[0].status !== 'completed' || jobs[0].conclusion !== 'success') return null;
  const proof = `Common checks passed for PR ${pr.number} base ${pr.base.sha} head ${pr.head.sha}`;
  const succeeded = name => jobs[0].steps.some(step => step.name === name && step.conclusion === 'success');
  return ['Check', 'Agent automation regression tests', proof].every(succeeded) ? run.id : null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { pull_request: pr } = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const tree = cwd => execFileSync('git', ['rev-parse', 'HEAD:.github'], { cwd, encoding: 'utf8' }).trim();
  const api = path => JSON.parse(execFileSync('gh', ['api', `repos/${process.env.GITHUB_REPOSITORY}/actions/${path}`], { encoding: 'utf8' }));
  let runId = null;
  try {
    if (pr.base.ref === 'develop' && !pr.draft && pr.head.repo.id === pr.base.repo.id && tree('control') === tree('candidate')) {
      const runs = api(`workflows/ci.yml/runs?event=pull_request&head_sha=${pr.head.sha}&per_page=100`);
      runId = completedCommonRun(pr, runs, (id, attempt) => api(`runs/${id}/attempts/${attempt}/jobs?per_page=100`));
    }
  } catch {
    console.error('Could not verify the standard CI result. Running all checks.');
  }
  console.error(runId ? `Using common checks from CI run ${runId}; running E2E locally on this job.` : 'Running the full suite on this candidate.');
  console.log(`mode=${runId ? '--e2e-only' : '--e2e'}`);
}
