import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  { settings: { next: { rootDir: new URL('./apps/server/', import.meta.url).pathname } } },
  globalIgnores(['**/.next/**', '**/out/**', '**/dist/**', '**/next-env.d.ts']),
]);
