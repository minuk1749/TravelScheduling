import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

test('production build serves the PWA shell, manifest, icons and service worker', { timeout: 30000 }, async () => {
  // Reserve an available port without conflicting with a developer server.
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const address = socket.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  const server = spawn(process.execPath, [createRequire(import.meta.url).resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  server.stdout.on('data', (chunk) => { logs += String(chunk); });
  server.stderr.on('data', (chunk) => { logs += String(chunk); });
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { ready = (await fetch(base)).ok; } catch { /* wait for startup */ }
      if (ready) break;
      if (server.exitCode !== null) throw new Error(logs);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, logs);
    const html = await (await fetch(base)).text();
    assert.match(html, /lang="ko"/);
    assert.match(html, /rel="manifest"/);
    const manifestResponse = await fetch(`${base}/manifest.webmanifest`);
    assert.equal(manifestResponse.status, 200);
    const manifest = await manifestResponse.json();
    assert.equal(manifest.display, 'standalone');
    for (const icon of manifest.icons) {
      const response = await fetch(`${base}${icon.src}`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') ?? '', /image\/png/);
    }
    const worker = await fetch(`${base}/sw.js`);
    assert.equal(worker.status, 200);
    assert.match(worker.headers.get('content-type') ?? '', /javascript/);
    assert.match(worker.headers.get('cache-control') ?? '', /no-store/);
    assert.equal(await worker.text(), await readFile('public/sw.js', 'utf8'));
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      const exited = once(server, 'exit');
      server.kill('SIGTERM');
      await exited;
    }
  }
});
