import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

export type SourceGraph = Map<string, { source: string; runtime: string[]; declarations: string[] }>;

/** Type-only back references do not become runtime cycles or browser bundle dependencies. */
export async function sourceGraph(): Promise<SourceGraph> {
  const sources = new Map(await Promise.all((await readdir('src', { recursive: true }))
    .filter(file => /\.tsx?$/.test(file)).map(async file => {
      const name = `src/${file}`;
      return [name, await readFile(name, 'utf8')] as const;
    })));
  const resolve = (from: string, specifier: string): string => {
    if (!specifier.startsWith('.')) return specifier;
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
    if (base.endsWith('.css')) return base;
    const target = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find(file => sources.has(file));
    assert.ok(target, `Unresolved dependency: ${from} -> ${specifier}`);
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
    assert.ok(!/^(?:node:|pg$|next-auth|src\/(?:auth\.ts|repositories\/|lib\/db\.ts|lib\/auth\/))/.test(file)
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
