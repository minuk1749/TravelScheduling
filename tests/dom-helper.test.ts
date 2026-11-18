import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installDom } from './helpers/dom';

// Regression: React's Scheduler flushes passive effects in a setImmediate task that reads `window.event`.
// Restoring globals synchronously after the test body left that task to throw "window is not defined" under CI load.
test('T15A UI test DOM teardown runs queued scheduler work before removing window, then restores globals', async () => {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const dom = installDom('http://localhost/');
  const seen: string[] = [];
  // Models a scheduler that yields after a slice and re-posts its loop twice.
  const work = (remaining: number) => setImmediate(() => {
    seen.push(typeof window);
    if (remaining > 0) work(remaining - 1);
  });
  work(2);
  await dom.restore();
  assert.deepEqual(seen, ['object', 'object', 'object']);
  assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, 'window'), before);
});
