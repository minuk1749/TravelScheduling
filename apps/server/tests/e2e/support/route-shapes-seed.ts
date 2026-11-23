import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { PostgresMobileSessionStore } from '../../../src/lib/auth/session-store';
import { hashOpaqueToken, newOpaqueToken } from '../../../src/lib/opaque-token';
import { saveItinerary } from '../../../src/repositories/itineraries';
import { insertTrip } from '../../../src/repositories/trip-inputs';
import { loadTripInputs } from '../../../src/repositories/trip-snapshot';
import { FixtureTravel, sampleDraft, sampleTrip } from '../../fixtures/itinerary';
import { service } from '../../helpers/itinerary-service';
import { openRunDatabase, type RunDatabaseTarget, type SuiteHooks } from './database';

/** What route-shapes-auth.spec.ts reads back over HTTP: three session tokens and one trip with two saved itineraries. */
export interface RouteShapesSeed {
  ownerToken: string; visitorToken: string; expiredToken: string;
  path: string; inputHash: string; firstId: string; latestId: string; legCount: number;
}

/**
 * The route shapes spec's whole database setup, registered on its suite: route-shapes-auth.spec.ts passes Playwright's
 * `test`, e2e-database.test.ts passes a hook recorder and another target. The seed is openRunDatabase's `prepare`, so it
 * only runs once the pool is shown to use the run's schema: as a separate beforeAll it would still run after a failed
 * check (Playwright runs the remaining hooks) and write to whatever schema the connection did reach. The returned
 * function reads the seed inside a test and throws if the setup did not complete.
 */
export function registerRouteShapesSeed(hooks: SuiteHooks, target?: RunDatabaseTarget): () => RouteShapesSeed {
  let seed: RouteShapesSeed | undefined;
  openRunDatabase(hooks, async pool => { seed = await seedRouteShapes(pool); }, target);
  return () => {
    if (!seed) throw new Error('the route shapes seed is not ready: the schema check or the seed failed');
    return seed;
  };
}

/** An owner and a visitor with mobile sessions (one of the owner's expired) and the owner's trip with an older and a newer saved itinerary for the same input. */
async function seedRouteShapes(pool: Pool): Promise<RouteShapesSeed> {
  const owner = randomUUID(), visitor = randomUUID();
  const ownerToken = newOpaqueToken(), visitorToken = newOpaqueToken(), expiredToken = newOpaqueToken();
  const client = await pool.connect();
  try {
    await client.query(`INSERT INTO users (id, google_id, email)
      SELECT id, id::text, 'shapes@example.test' FROM unnest($1::uuid[]) AS u(id)`, [[owner, visitor]]);
    const sessions = new PostgresMobileSessionStore(() => client);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    await sessions.issue(owner, hashOpaqueToken(ownerToken), future);
    await sessions.issue(visitor, hashOpaqueToken(visitorToken), future);
    await sessions.issue(owner, hashOpaqueToken(expiredToken), new Date(0).toISOString());

    const trip = await insertTrip(client, owner, sampleDraft(sampleTrip([{ key: 'tsukiji', minutes: 30 }])));
    const loaded = await loadTripInputs(client, trip);
    assert.ok(loaded?.status === 'READY');
    const { inputHash } = loaded;
    const first = await saveItinerary(client, trip, inputHash, await service().service.compute(loaded.input));
    assert.ok(first.status === 'SAVED');
    const travel = new FixtureTravel(({ mode }) => mode === 'WALK' ? 3_600 : 0);
    const result = await service({ travel }).service.compute(loaded.input);
    const legCount = result.comparisons.length;
    assert.ok(legCount > 0);
    const latest = await saveItinerary(client, trip, inputHash, result);
    assert.ok(latest.status === 'SAVED');
    return {
      ownerToken, visitorToken, expiredToken, inputHash, legCount,
      firstId: first.itineraryId, latestId: latest.itineraryId,
      path: `/api/trips/${trip}/itinerary/shapes?inputHash=${inputHash}`,
    };
  } finally { client.release(); }
}
