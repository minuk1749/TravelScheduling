#!/bin/bash
set -euo pipefail

node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));
for (const name of ['lint', 'typecheck', 'build', 'test']) {
  if (typeof scripts?.[name] !== 'string' || !scripts[name].trim()) {
    throw new Error(`필수 npm 스크립트 누락: ${name}`);
  }
}
JS

npm ci
npm run lint
npm run typecheck
npm run build
npm test

if [[ ${1:-} = --e2e ]] && node -e 'process.exit(require("./package.json").scripts?.["test:e2e"] ? 0 : 1)'; then
  npx playwright install --with-deps chromium
  npm run test:e2e -- --trace off
fi
