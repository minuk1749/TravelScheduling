import { cityProfileRow, createIsolatedSchema, isolateDatabase } from './database';

/**
 * Creates and migrates this run's schema (see database.ts) and drops it after the run. The teardown also fails the run
 * if the base schema's TOKYO fare profile changed, so the e2e upsert can never reach a development database again.
 */
export default async function globalSetup() {
  const database = isolateDatabase();
  const tokyoBefore = await cityProfileRow(database.baseUrl, 'TOKYO');
  const drop = await createIsolatedSchema(database);
  return async () => {
    try {
      const tokyoAfter = await cityProfileRow(database.baseUrl, 'TOKYO');
      if (tokyoAfter !== tokyoBefore) throw new Error(`e2e changed the base schema's TOKYO profile: ${tokyoBefore} → ${tokyoAfter}`);
    } finally {
      await drop();
    }
  };
}
