import { createDatabasePool } from '../src/lib/db';
import { migrate } from '../src/lib/migrations';

async function main() {
  const pool = createDatabasePool();
  try {
    const client = await pool.connect();
    try {
      const result = await migrate(client);
      console.log(JSON.stringify(result));
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('Migration failed:', error instanceof Error ? error.message : 'Unknown error');
  process.exitCode = 1;
});
