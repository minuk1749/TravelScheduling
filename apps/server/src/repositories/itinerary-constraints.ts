import type { Pool, PoolClient } from 'pg';
import type { ConstraintLoad, ConstraintRepository, ReceiptLookup } from '../services/itinerary/editing';
import type { Constraints, ConstraintWriteOptions, ResultSnapshot } from '../results/model';
import { loadTripInputs } from './trip-snapshot';
import { parseConstraints } from '../results/input';

/** Read the input, generation and optional proof from a single PostgreSQL snapshot. */
export async function loadConstraintInputs(client: PoolClient, tripId: string, lookup?: ReceiptLookup): Promise<ConstraintLoad | null> {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const loaded = await loadTripInputs(client, tripId);
    if (loaded?.status !== 'READY') { await client.query('COMMIT'); return loaded; }
    const { rows: [meta] } = await client.query<{ version: string; operation: string | null }>(`SELECT constraint_write_version AS version,
      CASE WHEN constraint_operation_id = $3 AND constraint_operation_revision = $4 THEN constraint_operation_id END AS operation
      FROM trips WHERE id = $1 AND ($2::uuid IS NULL OR owner_id = $2)`, [tripId, lookup?.ownerId, lookup?.operationId, loaded.inputHash]);
    await client.query('COMMIT');
    return meta ? { ...loaded, writeVersion: meta.version,
      ...(meta.operation ? { receipt: { operationId: meta.operation, revision: loaded.inputHash } } : {}) } : null;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}

export async function saveConstraints(client: PoolClient, tripId: string, ownerId: string, revision: string, constraints: Constraints,
  options: ConstraintWriteOptions = {}): Promise<ResultSnapshot | null> {
  await client.query('BEGIN');
  try {
    const locked = await client.query(`SELECT 1 FROM trips WHERE id = $1 AND owner_id = $2
      AND ($3::uuid IS NULL OR constraint_write_version = $3)
      AND ($4::uuid IS NULL OR (constraint_operation_id = $4 AND constraint_operation_revision = $5))
      FOR UPDATE`, [tripId, ownerId, options.expectedWriteVersion, options.expectedOperationId, revision]);
    const current = locked.rowCount ? await loadTripInputs(client, tripId) : null;
    if (current?.status !== 'READY' || current.inputHash !== revision) { await client.query('ROLLBACK'); return null; }
    const valid = parseConstraints(constraints, current.input);
    await client.query(`UPDATE trip_places tp SET priority = r.priority,
      fixed_date = r.fixed_date, fixed_time = r.fixed_time, fixed_order = r.fixed_order
      FROM jsonb_to_recordset($2::jsonb) AS r(id uuid, priority text, fixed_date date, fixed_time time, fixed_order integer)
      WHERE tp.trip_id = $1 AND tp.id = r.id`, [tripId, JSON.stringify(valid.visits.map(v => ({
      id: v.id, priority: v.priority === 'WISH' ? 'WISHLIST' : 'REQUIRED', fixed_date: v.fixedDate, fixed_time: v.fixedTime, fixed_order: v.fixedOrder,
    })))]);
    const { rows: [generation] } = await client.query<{ version: string }>(`UPDATE trips SET leg_modes = $2::jsonb WHERE id = $1
      RETURNING constraint_write_version AS version`, [tripId, JSON.stringify(valid.legModes)]);
    const saved = await loadTripInputs(client, tripId);
    if (saved?.status !== 'READY') throw new Error('Invalid saved constraints');
    const receipt = options.operationId ? { operationId: options.operationId, revision: saved.inputHash } : undefined;
    if (receipt) await client.query('UPDATE trips SET constraint_operation_id = $2, constraint_operation_revision = $3 WHERE id = $1',
      [tripId, receipt.operationId, receipt.revision]);
    await client.query('COMMIT');
    return { input: saved.input, revision: saved.inputHash, writeVersion: generation.version, ...(receipt ? { receipt } : {}) };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}
export class PostgresConstraintRepository implements ConstraintRepository {
  constructor(private readonly pool: Pool) {}
  async loadInputs(tripId: string, lookup?: ReceiptLookup) {
    const client = await this.pool.connect();
    try { return await loadConstraintInputs(client, tripId, lookup); } finally { client.release(); }
  }
  async save(tripId: string, ownerId: string, revision: string, constraints: Constraints, options?: ConstraintWriteOptions) {
    const client = await this.pool.connect();
    try { return await saveConstraints(client, tripId, ownerId, revision, constraints, options); } finally { client.release(); }
  }
}
