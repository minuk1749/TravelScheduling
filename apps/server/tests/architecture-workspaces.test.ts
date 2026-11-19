import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { repositoryRoot as root } from './helpers/paths';
import { sourceGraph } from './helpers/source-graph';

type Manifest = {
  name: string; workspaces?: string[]; scripts?: Record<string, string>;
  dependencies?: Record<string, string>; peerDependencies?: Record<string, string>; optionalDependencies?: Record<string, string>;
};
const json = async (file: string): Promise<Manifest> => JSON.parse(await readFile(path.join(root, file), 'utf8'));
const directories = ['apps/server', 'apps/mobile', 'packages/core', 'packages/design-tokens'];
const commands = ['lint', 'typecheck', 'build', 'test', 'migrate'];
const exec = promisify(execFile);

test('T17 root commands execute every workspace script and propagate a workspace failure', { timeout: 30_000 }, async () => {
  const manifest = await json('package.json');
  assert.deepEqual(manifest.workspaces, ['apps/*', 'packages/*']);
  const fixture = await mkdtemp(path.join(tmpdir(), 'travel-workspaces-'));
  try {
    await writeFile(path.join(fixture, 'package.json'), JSON.stringify(manifest));
    for (const directory of directories) {
      await mkdir(path.join(fixture, directory), { recursive: true });
      const { name } = await json(`${directory}/package.json`);
      await writeFile(path.join(fixture, directory, 'package.json'), JSON.stringify({ name, version: '0.1.0',
        scripts: Object.fromEntries(commands.map(command => [command, 'node check.cjs'])),
      }));
      await writeFile(path.join(fixture, directory, 'check.cjs'),
        "console.log(process.env.npm_package_name + ':' + process.env.npm_lifecycle_event); if (process.env.FAIL_WORKSPACE === process.env.npm_package_name) process.exit(7);\n");
    }
    for (const command of commands) {
      assert.equal(manifest.scripts?.[command], `npm run ${command} --workspaces --if-present`);
      const { stdout } = await exec('npm', ['run', command, '--silent'], { cwd: fixture, timeout: 10_000 });
      for (const directory of directories) assert.ok(stdout.includes(`${(await json(`${directory}/package.json`)).name}:${command}`));
      await assert.rejects(exec('npm', ['run', command, '--silent'], {
        cwd: fixture, timeout: 10_000, env: { ...process.env, FAIL_WORKSPACE: '@travel/mobile' },
      }));
    }
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

test('T17 packages declare only allowed runtime dependencies; implemented packages have real checks', async () => {
  const server = await json('apps/server/package.json');
  const mobile = await json('apps/mobile/package.json');
  const core = await json('packages/core/package.json');
  const tokens = await json('packages/design-tokens/package.json');
  const dependencies = (manifest: Manifest) => ({ ...manifest.dependencies, ...manifest.peerDependencies, ...manifest.optionalDependencies });
  assert.deepEqual(Object.keys(dependencies(core)), ['@js-temporal/polyfill']);
  assert.deepEqual(dependencies(tokens), {});
  assert.equal(dependencies(server)['@travel/core'], '0.1.0');
  assert.ok(!Object.hasOwn(dependencies(server), '@travel/mobile'));
  for (const name of Object.keys(dependencies(mobile))) assert.ok(!['@travel/server', 'pg', 'next', 'next-auth'].includes(name));
  for (const manifest of [core, server]) {
    for (const command of commands.filter(command => command !== 'migrate')) assert.ok(manifest.scripts?.[command]);
  }
  assert.equal(server.scripts?.migrate, 'tsx scripts/migrate.ts');
  for (const [file, node] of await sourceGraph()) {
    for (const dependency of node.declarations) {
      if (file.startsWith('apps/mobile/')) assert.ok(!dependency.startsWith('apps/server/'), `${file} -> ${dependency}`);
      if (file.startsWith('apps/server/')) assert.ok(!dependency.startsWith('apps/mobile/'), `${file} -> ${dependency}`);
    }
  }
});

test('T17 compatibility modules re-export the same core functions and error constructors', async () => {
  const files = (await readdir(path.join(root, 'apps/server/src'), { recursive: true })).filter(file => file.endsWith('.ts'));
  let forwarded = 0;
  for (const file of files) {
    const filename = path.join(root, 'apps/server/src', file);
    const source = await readFile(filename, 'utf8');
    const forwarding = source.match(/^export \* from '(@travel\/core\/[^']+)';\s*$/);
    if (!forwarding) continue;
    const original = await import(pathToFileURL(filename).href);
    const shared = await import(forwarding[1]);
    assert.deepEqual(Object.keys(original), Object.keys(shared), file);
    for (const key of Object.keys(original)) assert.equal(original[key], shared[key], `${file}: ${key}`);
    forwarded++;
  }
  assert.ok(forwarded >= 13, 'Missing compatibility exports');
  const settings = await import('../src/settings/model');
  const sharedSettings = await import('@travel/core/contracts/settings/model');
  assert.equal(settings.SettingsError, sharedSettings.SettingsError);
  const sharing = await import('../src/sharing/model');
  const sharedSharing = await import('@travel/core/contracts/sharing');
  assert.equal(sharing.isShareToken, sharedSharing.isShareToken);
});
