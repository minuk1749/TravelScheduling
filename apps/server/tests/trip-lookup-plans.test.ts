import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Pool, type QueryConfig } from 'pg';
import { tripOwner } from '../src/lib/auth/store';
import { migrate } from '../src/lib/migrations';
import { LivingSettingsRepository } from '../src/repositories/living-settings';
import { insertTrip } from '../src/repositories/trip-inputs';
import { tripDraft } from './fixtures/trip-input';
import { withDatabase } from './helpers/database';

interface PlanNode {
  'Node Type': string;
  'Index Name'?: string;
  'Index Cond'?: string;
  'Actual Rows': number;
  'Shared Hit Blocks': number;
  Plans?: PlanNode[];
}

function planNodes(plan: PlanNode): PlanNode[] {
  return [plan, ...(plan.Plans ?? []).flatMap(planNodes)];
}

test('T8B PostgreSQL lookup plans on 10,001 trips', async t => {
  await withDatabase(async (client, schema) => {
    await migrate(client);
    const owner = randomUUID(), other = randomUUID();
    await client.query(`INSERT INTO users (id,google_id,email) VALUES
      ($1,'t8b-owner','owner@example.test'), ($2,'t8b-other','other@example.test')`, [owner, other]);
    const id = await insertTrip(client, owner, tripDraft);
    await client.query(`INSERT INTO trips (id,owner_id)
      SELECT gen_random_uuid(), $1 FROM generate_series(1,10000)`, [other]);
    await client.query('ANALYZE trips');
    assert.equal((await client.query('SELECT count(*)::int AS n FROM trips')).rows[0].n, 10_001);
    assert.equal((await client.query('SHOW enable_seqscan')).rows[0].enable_seqscan, 'on');

    const pool = new Pool({
      connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}`,
      max: 1, idleTimeoutMillis: 0,
    });
    try {
      const connection = await pool.connect();
      const sent = t.mock.method(connection, 'query').mock;
      connection.release();
      const settings = new LivingSettingsRepository(pool);

      async function checkPlan(context: TestContext, operation: () => Promise<unknown>, lock = false) {
        sent.resetCalls();
        await operation();
        // On save, the first parent SELECT must lock the trip before the revision check and writes.
        const parent = sent.calls
          .map(({ arguments: [query, values] }): QueryConfig<unknown[]> =>
            typeof query === 'string' ? { text: query, values } : query)
          .find(({ text }) => /^\s*SELECT\b/i.test(text) && /\bFROM\s+trips\b/i.test(text));
        assert.ok(parent, 'expected a SELECT from trips');
        assert.deepEqual(parent.values, [id]);
        const { rows } = await client.query<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(
          `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${parent.text}`, parent.values);
        const root = rows[0]['QUERY PLAN'][0].Plan;
        const nodes = planNodes(root);
        const path = nodes.map(node => [node['Node Type'], node['Index Name']].filter(Boolean).join(' ')).join(' → ');
        context.diagnostic(`${path}, rows=${root['Actual Rows']}, shared hits=${root['Shared Hit Blocks']}`);
        assert.equal(root['Actual Rows'], 1);
        if (lock) assert.equal(root['Node Type'], 'LockRows', path);
        const index = nodes.find(node => node['Index Name'] === 'trips_pkey');
        assert.ok(index, `expected trips_pkey in ${path}`);
        assert.match(index['Index Cond'] ?? '', /\bid\s*=/);
      }

      await t.test('tripOwner looks up the owner with trips_pkey', async t => {
        // The auth store owns its pool. Route this call to the same schema and let pg execute its SQL.
        t.mock.method(Pool.prototype, 'query', pool.query.bind(pool), { times: 1 });
        await checkPlan(t, async () => assert.equal(await tripOwner(id), owner));
      });
      await t.test('load reads the settings snapshot with trips_pkey', async t => {
        await checkPlan(t, () => settings.load(id, owner));
      });
      await t.test('save locks the settings snapshot with trips_pkey', async t => {
        const snapshot = await settings.load(id, owner);
        await checkPlan(t, () => settings.save(id, owner, snapshot.revision, { ...snapshot.settings, taxiPolicy: 'PREFER' }), true);
      });
    } finally { await pool.end(); }
  });
});
