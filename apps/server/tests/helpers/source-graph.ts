import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { repositoryRoot } from './paths';

export type SourceGraph = Map<string, { source: string; runtime: string[]; declarations: string[] }>;

/** Type-only back references do not become runtime cycles or browser bundle dependencies. */
export async function sourceGraph(): Promise<SourceGraph> {
  const directories = ['apps/server/src', 'apps/mobile/src', 'apps/mobile/app', 'packages/core/src', 'packages/design-tokens/src'];
  const entries = await Promise.all(directories.map(async directory => {
    let files: string[];
    try { files = await readdir(path.join(repositoryRoot, directory), { recursive: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    return Promise.all(files.filter(file => /\.tsx?$/.test(file)).map(async file => {
      const name = `${directory}/${file.split(path.sep).join('/')}`;
      return [name, await readFile(path.join(repositoryRoot, name), 'utf8')] as const;
    }));
  }));
  const sources = new Map(entries.flat());
  const resolve = (from: string, specifier: string): string => {
    if (!specifier.startsWith('.') && !specifier.startsWith('@travel/')) return specifier;
    if (specifier.endsWith('.css')) return path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
    const resolution = ts.resolveModuleName(specifier, path.join(repositoryRoot, from), {
      module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    }, ts.sys).resolvedModule;
    const target = resolution && path.relative(repositoryRoot, resolution.resolvedFileName).split(path.sep).join('/');
    assert.ok(target && sources.has(target), `Unresolved dependency: ${from} -> ${specifier}`);
    return target;
  };
  return new Map([...sources].map(([file, source]) => {
    const emitted = ts.transpileModule(source, { fileName: file, compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    const imports = (text: string) => ts.preProcessFile(text, true, true).importedFiles.map(ref => resolve(file, ref.fileName));
    return [file, { source, runtime: imports(emitted), declarations: imports(source) }];
  }));
}

export function assertAcyclic(graph: SourceGraph): void {
  const done = new Set<string>(), active: string[] = [];
  function visit(file: string) {
    assert.ok(!active.includes(file), `Runtime cycle: ${[...active, file].join(' -> ')}`);
    if (done.has(file)) return;
    active.push(file);
    for (const dependency of graph.get(file)?.runtime ?? []) if (graph.has(dependency)) visit(dependency);
    active.pop(); done.add(file);
  }
  for (const file of graph.keys()) visit(file);
}

export function assertBrowserSafe(graph: SourceGraph, entry: string): void {
  const visited = new Set<string>();
  function visit(file: string) {
    if (visited.has(file)) return;
    visited.add(file);
    assert.ok(!/^(?:node:|pg$|next-auth|apps\/server\/src\/(?:auth\.ts|repositories\/|lib\/db\.ts|lib\/auth\/))/.test(file)
      && !/\/server\.ts$/.test(file), `Server dependency in ${entry}: ${file}`);
    const node = graph.get(file);
    if (!node) return;
    for (const match of node.source.matchAll(/process\.env\.([A-Z_]+)/g)) {
      // Next replaces NODE_ENV with a public build-mode constant, including the PWA registration.
      assert.ok(match[1] === 'NODE_ENV' || match[1].startsWith('NEXT_PUBLIC_'), `Private environment variable in ${file}: ${match[1]}`);
    }
    for (const dependency of node.runtime) visit(dependency);
  }
  visit(entry);
}
