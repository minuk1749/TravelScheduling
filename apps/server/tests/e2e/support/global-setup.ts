import { createIsolatedSchema, isolateDatabase } from './database';

/**
 * Creates and migrates this run's schema (see database.ts) and returns the teardown that drops it. Setup refuses to
 * migrate unless the run's URL resolves to that schema, and nothing here reads the base schema: other processes may
 * keep writing there, and the account only needs to create and drop its own schema.
 */
export async function setUpRunDatabase(env: Record<string, string | undefined>): Promise<() => Promise<void>> {
  return createIsolatedSchema(isolateDatabase(env));
}

export default function globalSetup() {
  return setUpRunDatabase(process.env);
}
