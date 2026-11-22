import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const lookup = fileURLToPath(new URL('./model-for.mjs', import.meta.url));

function pick(role, task) {
  return execFileSync(process.execPath, [lookup, role, task], { encoding: 'utf8' }).trim();
}

test('remaining implementation and review tasks resolve to their assigned models', () => {
  for (const task of ['T8B', 'T24', 'T30']) {
    assert.equal(pick('codex', task), 'gpt-6.2-sol\thigh');
  }
  for (const task of ['T27', 'T29']) {
    assert.equal(pick('codex', task), 'gpt-6.2-astra\txhigh');
  }
  assert.equal(pick('codex-review', 'T22'), 'gpt-6.2-astra\thigh');

  for (const task of ['T22', 'T25', 'T26A']) {
    assert.equal(pick('claude-implement', task), 'claude-opus-5-5');
  }
  for (const task of ['T26', 'T28']) {
    assert.equal(pick('claude-implement', task), 'claude-sonnet-5-5');
  }
  for (const task of ['T22', 'T25', 'T26A', 'T27', 'T29', 'R1']) {
    assert.equal(pick('claude', task), 'claude-opus-5-5');
    assert.equal(pick('claude-effort', task), 'high');
  }
  assert.equal(pick('claude', 'T8B'), 'claude-sonnet-5-5');
  assert.equal(pick('claude-effort', 'T8B'), 'high');
  assert.equal(pick('claude-refactor', 'R1'), 'claude-opus-5-5');
});
