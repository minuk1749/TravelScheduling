import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { PoolClient } from 'pg';
import { authorizeTrip } from '../src/lib/auth/authorization';
import { JoseGoogleIdTokenVerifier } from '../src/lib/auth/google-id-token';
import { MobileSessionService } from '../src/lib/auth/mobile-sessions';
import { SessionRequestAuthenticator } from '../src/lib/auth/request-authenticator';
import { PostgresMobileSessionStore } from '../src/lib/auth/session-store';
import { migrate } from '../src/lib/migrations';
import { hashOpaqueToken } from '../src/lib/opaque-token';
import { tripAccessHandler } from '../src/trips/http';
import { withDatabase } from './helpers/database';
import { fixtureJwks, googleIdToken, IOS_CLIENT } from './helpers/google-id-tokens';

// T18: migration 007 and the SQL session store against PostgreSQL 16.
async function upsertUser(client: PoolClient, googleId: string, email: string) {
  const { rows } = await client.query<{ id: string }>(`INSERT INTO users (id, google_id, email) VALUES ($1, $2, $3)
    ON CONFLICT (google_id) DO UPDATE SET email = EXCLUDED.email RETURNING id`, [randomUUID(), googleId, email]);
  return rows[0].id;
}
const tripOwner = (client: PoolClient) => async (id: string) =>
  (await client.query<{ owner_id: string }>('SELECT owner_id FROM trips WHERE id::text = $1', [id])).rows[0]?.owner_id ?? null;

test('mobile_sessions stores hashes with expiry, timestamps, FK index, and cascades on withdrawal', async () => {
  await withDatabase(async client => {
    await migrate(client);
    const store = new PostgresMobileSessionStore(() => client);
    const user = await upsertUser(client, 'g-1', 'a@example.test');
    const other = await upsertUser(client, 'g-2', 'b@example.test');
    const [live, old, second, theirs] = ['live', 'old', 'second', 'theirs'].map(hashOpaqueToken);
    const future = new Date(Date.now() + 86_400_000).toISOString();

    await client.query(`INSERT INTO mobile_sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now() - interval '1 second')`, [randomUUID(), user, old]);
    await store.issue(user, live, future);
    assert.equal(await store.userIdFor(live), user);
    assert.equal(await store.userIdFor(old), null, 'expired tokens do not authenticate');
    assert.equal((await client.query('SELECT 1 FROM mobile_sessions WHERE token_hash = $1', [old])).rowCount, 0, 'issue purges expired rows');
    await store.issue(user, second, future);
    await store.issue(other, theirs, future);

    const recent = (column: string) => `${column} BETWEEN now() - interval '1 minute' AND now()`;
    const { rows: [row] } = await client.query(`SELECT expires_at, ${recent('created_at')} AS created_now, ${recent('updated_at')} AS updated_now
      FROM mobile_sessions WHERE token_hash = $1`, [live]);
    assert.equal(row.expires_at.toISOString(), future);
    assert.equal(row.created_now, true);
    assert.equal(row.updated_now, true);
    const { rows: [updated] } = await client.query(`UPDATE mobile_sessions SET updated_at = '2000-01-01T00:00:00Z' WHERE token_hash = $1
      RETURNING updated_at = statement_timestamp() AS refreshed`, [live]);
    assert.equal(updated.refreshed, true, 'updated_at trigger');
    assert.equal((await client.query(`SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'mobile_sessions_user_id_idx'`)).rowCount, 1);
    await assert.rejects(client.query('INSERT INTO mobile_sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now())', [randomUUID(), user, 'plain-token']), /check/i);
    await assert.rejects(store.issue(other, live, future), /unique|duplicate/i);

    await store.revoke(live);
    await store.revoke(live);
    assert.equal(await store.userIdFor(live), null);
    assert.equal(await store.userIdFor(second), user);

    await client.query('DELETE FROM users WHERE id = $1', [user]);
    assert.equal(await store.userIdFor(second), null);
    assert.deepEqual((await client.query('SELECT user_id FROM mobile_sessions')).rows, [{ user_id: other }], 'withdrawal deletes every session of that user only');
  });
});

test('Google login → Bearer token → owner trip 200, other trip 403; logout and withdrawal make the token 401', async () => {
  await withDatabase(async client => {
    await migrate(client);
    const store = new PostgresMobileSessionStore(() => client);
    const service = new MobileSessionService(new JoseGoogleIdTokenVerifier([IOS_CLIENT], fixtureJwks().keys), store,
      { upsertGoogleUser: (googleId, email) => upsertUser(client, googleId, email) });
    const authenticator = new SessionRequestAuthenticator(store);
    const access = tripAccessHandler({ userId: request => authenticator.userId(request), findOwner: tripOwner(client) });

    const issued = (await service.signIn(await googleIdToken()))!;
    const user = (await client.query<{ id: string }>("SELECT id FROM users WHERE google_id = 'google-user-1'")).rows[0].id;
    const stranger = await upsertUser(client, 'g-stranger', 's@example.test');
    const [mine, theirs] = [randomUUID(), randomUUID()];
    await client.query('INSERT INTO trips (id, owner_id) VALUES ($1, $2), ($3, $4)', [mine, user, theirs, stranger]);
    const stored = (await client.query('SELECT token_hash FROM mobile_sessions')).rows;
    assert.deepEqual(stored, [{ token_hash: hashOpaqueToken(issued.token) }], 'only the hash is persisted');

    const get = (id: string, token = issued.token) => access(new Request(`https://api.example.test/api/trips/${id}`, { headers: { authorization: `Bearer ${token}` } }), id);
    const mineResponse = await get(mine);
    assert.equal(mineResponse.status, 200);
    assert.deepEqual(await mineResponse.json(), { id: mine });
    const forbidden = await get(theirs);
    assert.equal(forbidden.status, 403);
    assert.equal((await forbidden.json()).code, 'FORBIDDEN');
    assert.equal((await get(randomUUID())).status, 404);
    assert.equal(await authorizeTrip(await authenticator.userId(new Request('https://api.example.test', { headers: { authorization: `Bearer ${issued.token}` } })), theirs, tripOwner(client)), 403);

    await service.signOut(issued.token);
    assert.equal((await get(mine)).status, 401, 'revoked');
    const again = (await service.signIn(await googleIdToken()))!;
    await client.query(`UPDATE mobile_sessions SET expires_at = now() - interval '1 second'`);
    assert.equal((await get(mine, again.token)).status, 401, 'expired');
    const last = (await service.signIn(await googleIdToken()))!;
    assert.equal((await get(mine, last.token)).status, 200);
    await client.query('DELETE FROM users WHERE id = $1', [user]);
    assert.equal((await get(mine, last.token)).status, 401, 'withdrawn');
    assert.equal((await client.query('SELECT 1 FROM trips WHERE id = $1', [mine])).rowCount, 0);
  });
});
