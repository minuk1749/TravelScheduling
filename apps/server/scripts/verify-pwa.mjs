import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';

export async function verifyPwaArtifacts() {
  const manifest = JSON.parse(await readFile('.next/server/app/manifest.webmanifest.body', 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.lang, 'ko');
  for (const size of [192, 512]) {
    const icon = manifest.icons.find((entry) => entry.sizes === `${size}x${size}`);
    assert.ok(icon, `Missing ${size}px icon`);
    const png = await readFile(`public${icon.src}`);
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
  const worker = await readFile('public/sw.js', 'utf8');
  new Script(worker);
  assert.match(worker, /addEventListener\('fetch'/);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  await verifyPwaArtifacts();
  console.log('PWA build artifacts verified');
}
