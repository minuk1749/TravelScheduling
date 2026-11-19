import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

import { repositoryRoot as root } from './helpers/paths';
const architecturePath = path.join(root, 'docs/architecture.md');

test('architecture covers the audit scope and links to existing sources, tests and decisions', async () => {
  const architecture = await readFile(architecturePath, 'utf8');
  for (const topic of ['폴더 구조', '모듈 경계', '데이터 흐름', '핵심 인터페이스', '제공자와 저장소', '시간대', '오류 처리', '코드와 문서 차이']) {
    assert.ok(architecture.split('\n').some(line => line.startsWith('## ') && line.includes(topic)), topic);
  }
  assert.match(architecture, /```mermaid\n[\s\S]+?```/);
  const audit = architecture.split('## 7.')[1].split('## 8.')[0];
  for (let task = 1; task <= 7; task++) assert.match(audit, new RegExp(`T${task}(?!\\d)`));

  const decisions = (await readdir(path.join(root, 'docs/decisions'))).filter(name => name.endsWith('.md'));
  assert.ok(decisions.length >= 2);
  for (const decision of decisions) {
    assert.ok(architecture.includes(`decisions/${decision}`), `Unlinked decision: ${decision}`);
    const content = await readFile(path.join(root, 'docs/decisions', decision), 'utf8');
    for (const heading of ['결정', '이유', '대안']) assert.ok(content.includes(`## ${heading}`), `${decision}: ${heading}`);
  }
  const documents = [architecturePath, ...decisions.map(name => path.join(root, 'docs/decisions', name))];
  for (const document of documents) {
    const content = await readFile(document, 'utf8');
    for (const [, target] of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      if (/^https?:/.test(target)) continue;
      const resolved = path.resolve(path.dirname(document), target.split('#')[0]);
      assert.ok(resolved.startsWith(root + path.sep), `Link outside repository: ${target}`);
      assert.ok((await stat(resolved)).isFile(), `${document}: ${target}`);
    }
  }
});

test('documented scheduler, fare, provider and repository contracts typecheck against public exports', async () => {
  const document = await readFile(architecturePath, 'utf8');
  const blocks = [...document.matchAll(/```typescript\n([\s\S]*?)```/g)].map(match => match[1]);
  assert.ok(blocks.length > 0, 'No executable contracts found');
  const filename = path.join(root, 'docs/architecture.contracts.ts');
  const source = blocks.join('\n');
  const options: ts.CompilerOptions = {
    strict: true, noEmit: true, skipLibCheck: true, esModuleInterop: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) =>
    path.resolve(file) === filename
      ? ts.createSourceFile(file, source, languageVersion, true)
      : getSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([filename], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: file => file,
    getCurrentDirectory: () => root,
    getNewLine: () => '\n',
  }));
});

function assertPureCore(source: string, filename: string): void {
  const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const allowedDirectories = ['packages/core/src'].map(name => path.join(root, name) + path.sep);
  const checkImport = (specifier: string) => {
    if (specifier === '@js-temporal/polyfill') return;
    assert.ok(specifier.startsWith('.'), `External dependency in core: ${specifier}`);
    const resolved = path.resolve(path.dirname(filename), specifier);
    assert.ok(allowedDirectories.some(directory => resolved === directory.slice(0, -1) || resolved.startsWith(directory)),
      `Dependency outside pure core: ${specifier}`);
  };
  const walk = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      assert.ok(ts.isStringLiteral(node.moduleSpecifier));
      checkImport(node.moduleSpecifier.text);
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      checkImport(node.argument.literal.text);
    }
    if (ts.isIdentifier(node)) {
      assert.ok(!['fetch', 'XMLHttpRequest', 'WebSocket', 'process', 'require', 'Buffer', 'Deno', 'Bun'].includes(node.text),
        `I/O or environment access in core: ${node.text}`);
    }
    if (ts.isCallExpression(node)) {
      assert.notEqual(node.expression.kind, ts.SyntaxKind.ImportKeyword, 'Dynamic imports in core are not allowed');
      assert.ok(!['Date.now', 'Math.random', 'Date'].includes(node.expression.getText(parsed)), 'Implicit clock/random input');
    }
    if (ts.isNewExpression(node) && node.expression.getText(parsed) === 'Date') {
      assert.ok(node.arguments?.length, 'Date must receive an explicit instant');
    }
    ts.forEachChild(node, walk);
  };
  walk(parsed);
}

test('all shared core modules stay independent of database, HTTP, environment and implicit clock inputs', async () => {
  for (const directory of ['packages/core/src']) {
    for (const file of await readdir(path.join(root, directory), { recursive: true })) {
      if (!file.endsWith('.ts')) continue;
      const filename = path.join(root, directory, file);
      assertPureCore(await readFile(filename, 'utf8'), filename);
    }
  }
});

test('dependency guard rejects database, provider and nondeterministic dependencies', () => {
  const filename = path.join(root, 'packages/core/src/scheduler/example.ts');
  for (const forbidden of [
    "import { Pool } from 'pg';", "export { createDatabasePool } from '../../../../apps/server/src/lib/db';",
    "import { provider } from '../../../../apps/server/src/travel-time';",
    "import type { Stats } from 'node:fs';", "type Stats = import('node:fs').Stats;", "import { View } from 'react-native';",
    "export * from 'next';", "import React from 'react';", "fetch('https://example.test');",
    'process.env.DATABASE_URL;', 'Date.now();', 'new Date();', 'Math.random();',
    "import('../lib/db');",
  ]) assert.throws(() => assertPureCore(forbidden, filename), assert.AssertionError);
  assert.doesNotThrow(() => assertPureCore("import { Temporal } from '@js-temporal/polyfill'; new Date('2026-12-01T00:00:00Z');", filename));
});
