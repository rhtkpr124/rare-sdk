// Explicit opt-in acceptance gate. Requires real local authority, Rare API, gql-api,
// Redis and migrated Postgres; this runner never substitutes a service response.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const exec = promisify(execFile);
class PrerequisiteError extends Error {}
let stage = 'configuration';
const required = name => {
  const value = process.env[name];
  if (!value) throw new PrerequisiteError(`Missing ${name}`);
  return value;
};
const localUrl = name => {
  const value = required(name);
  const url = new URL(value);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new PrerequisiteError(`${name} must address an isolated loopback test service`);
  }
  return value.replace(/\/$/, '');
};
const check = (condition, description) => assert.ok(condition, description);

async function run() {
  if (required('RARE_CROSS_REPO') !== '1') throw new PrerequisiteError('Set RARE_CROSS_REPO=1 explicitly');
  const internalAuthBaseUrl = localUrl('CROSS_AUTH_URL');
  const apiBaseUrl = localUrl('CROSS_API_URL');
  const database = new URL(localUrl('CROSS_DATABASE_URL'));
  const schema = process.env.CROSS_DATABASE_SCHEMA || database.searchParams.get('schema') || 'public';
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new PrerequisiteError('Invalid CROSS_DATABASE_SCHEMA');
  const databaseEnv = {
    PGHOST: database.hostname, PGPORT: database.port || '5432',
    PGUSER: decodeURIComponent(database.username), PGPASSWORD: decodeURIComponent(database.password),
    PGDATABASE: decodeURIComponent(database.pathname.slice(1)),
    PGSSLMODE: database.searchParams.get('sslmode') || 'disable',
    PGCONNECT_TIMEOUT: '5',
  };
  const bridgeSecret = required('CROSS_AUTH_INTERNAL_API_KEY');
  const sql = async query => {
    // Connection secrets stay in the environment, never in process argv/output.
    const { stdout } = await exec(process.env.PSQL_BIN || 'psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', query], {
      env: { ...process.env, ...databaseEnv }, timeout: 15000, maxBuffer: 1024 * 1024,
    });
    return stdout.trim();
  };
  let sdk;
  try { sdk = await import('../../dist/sdk/index.js'); }
  catch { throw new PrerequisiteError('Build the SDK first: npm run build'); }
  try {
    stage = 'Postgres preflight';
    await sql(`SELECT 1 FROM "${schema}"."user" LIMIT 1`);
    stage = 'authority preflight';
    const auth = await fetch(`${internalAuthBaseUrl}/introspect`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'token=untrusted', signal: AbortSignal.timeout(5000) });
    check(auth.status === 200 && (await auth.json()).active === false, 'Shared auth v2 introspection must reject an unknown token without service credentials');
    const unauthenticated = await fetch(`${apiBaseUrl}/v1/me`, { signal: AbortSignal.timeout(5000) });
    check(unauthenticated.status === 401, 'Rare API account route is not ready');
  } catch { throw new PrerequisiteError(`${stage} failed; check isolated stack configuration`); }

  stage = 'public auth route isolation';
  for (const path of ['/introspect', '/internal/device/reviews', '/internal/device/reviews/test/challenge', '/internal/device/reviews/test/decision']) {
    const response = await fetch(`${apiBaseUrl}/auth/v2${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${bridgeSecret}` }, body: '{}', redirect: 'error', signal: AbortSignal.timeout(5000) });
    check([401, 403, 404, 405].includes(response.status), `Internal auth route exposed through public API: ${path}`);
  }
  console.log('PASS API passthrough excludes introspection and internal device bridge');

  const wallet = privateKeyToAccount(generatePrivateKey());
  const address = wallet.address.toLowerCase();
  // Generated addresses are hex-only. Never interpolate caller input into SQL.
  check(/^0x[0-9a-f]{40}$/.test(address), 'Invalid generated wallet');
  const row = async () => JSON.parse(await sql(`SELECT COALESCE(json_agg(json_build_object('accountId',u.id::text,'username',u.username,'metadata',u.metadata)), '[]'::json) FROM "${schema}"."user" u JOIN "${schema}".user_address a ON a.user_id=u.id WHERE lower(a.address)='${address}'`));
  const options = { apiBaseUrl, apiFetch: async (input, init) => {
    check(new URL(input instanceof Request ? input.url : input).origin === new URL(apiBaseUrl).origin, 'SDK attempted to bypass public API origin');
    return fetch(input, init);
  } };
  const clients = [];
  const client = () => { const c = sdk.createRareClient(options); clients.push(c); return c; };
  const login = c => c.auth.loginWithWallet({ address: wallet.address, chainId: 1, signMessage: message => wallet.signMessage({ message }), signal: AbortSignal.timeout(15000) });
  const rawMe = token => fetch(`${apiBaseUrl}/v1/me`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
  const bridge = async (path, body) => {
    const response = await fetch(`${internalAuthBaseUrl}/internal/device/reviews${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${bridgeSecret}` },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
    });
    check(response.status === 200, `Device bridge ${path || 'review'} failed (${response.status})`);
    return response.json();
  };
  let cleanupFailed = false;
  try {
    stage = 'wallet login and account persistence';
    check((await row()).length === 0, 'Fresh wallet already exists');
    const first = client();
    await login(first);
    check((await first.auth.getSession()).authBaseUrl === `${apiBaseUrl}/auth/v2`, 'Session must use public API auth URL');
    await assert.rejects(first.profile.get(), error => error.code === 'account_required');
    check((await row()).length === 0, 'Login unexpectedly created an account');
    // Seed an existing account in the disposable database; signup is outside Auth.
    await sql(`WITH created AS (INSERT INTO "${schema}"."user" (username,email,metadata,updated_at) VALUES ('test_${address.slice(2)}','n/a','{}',now()) RETURNING id) INSERT INTO "${schema}".user_address (user_id,address,chain_id,updated_at) SELECT id,'${address}','1',now() FROM created`);
    const profile = await first.profile.get();
    const persisted = await row();
    check(persisted.length === 1 && persisted[0].accountId === profile.accountId, 'Seeded account did not resolve through the API');
    check(profile.address === address && profile.email === 'n/a', 'New account identity mismatch');
    console.log('PASS wallet login does not create an account; an independently seeded account resolves through the API');

    stage = 'profile persistence and account reuse';
    await first.profile.update({ profile: { fullName: 'SDK acceptance', bio: 'Persistent cross-repo proof' } });
    check((await row())[0].metadata.bio === 'Persistent cross-repo proof', 'Profile mutation was not persisted');
    const second = client();
    await login(second);
    const reused = await second.profile.get();
    check(reused.accountId === profile.accountId && reused.profile.fullName === 'SDK acceptance' && (await row()).length === 1, 'Second login failed account reuse');
    await second.profile.update({ profile: { fullName: 'Updated through SDK' } });
    const partialUpdate = await first.profile.get();
    check(partialUpdate.profile.fullName === 'Updated through SDK' && partialUpdate.profile.bio === 'Persistent cross-repo proof', 'Omitted profile field was not preserved');
    console.log('PASS profile GET/PATCH persists; second login reuses account and preserves profile');

    stage = 'refresh and immediate revocation';
    const before = await first.auth.getSession();
    const refreshed = await first.auth.refresh();
    check(refreshed.refreshToken !== before.refreshToken, 'Refresh did not rotate');
    check((await rawMe(refreshed.accessToken)).status === 200, 'Refreshed token not accepted by actual API');
    await first.auth.logout();
    check((await rawMe(refreshed.accessToken)).status === 401, 'Revoked access token accepted');
    check((await rawMe(before.accessToken)).status === 401, 'Earlier family access token accepted after revoke');
    check((await second.profile.get()).accountId === profile.accountId, 'Revocation affected another installation');
    console.log('PASS refresh rotates; logout immediately revokes family at Rare API and preserves other session');

    stage = 'device approval and polling';
    const deviceClient = client();
    let pending = await deviceClient.auth.startDeviceAuthorization();
    const review = await bridge('', { user_code: pending.userCode });
    const challenge = await bridge(`/${review.review_id}/challenge`, { address: wallet.address, chain_id: 1, origin: new URL(apiBaseUrl).origin });
    await bridge(`/${review.review_id}/decision`, {
      decision: 'approve', challenge_id: challenge.challenge_id, message: challenge.message,
      signature: await wallet.signMessage({ message: challenge.message }),
    });
    let authorized = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      await sleep(Math.max(0, pending.nextPollAt - Date.now()));
      const result = await deviceClient.auth.pollDeviceAuthorization(pending, { signal: AbortSignal.timeout(15000) });
      if (result.status === 'authorized') { authorized = true; break; }
      pending = result.authorization;
    }
    check(authorized, 'Approved device flow did not yield a session');
    check((await deviceClient.profile.get()).accountId === profile.accountId, 'Device flow resolved a different account');
    const deviceSession = await deviceClient.auth.getSession();
    await deviceClient.auth.logout();
    check((await rawMe(deviceSession.accessToken)).status === 401, 'Revoked device token still accepted');
    console.log('PASS device review + fresh wallet signature + SDK polling resolve same persisted account');
    if (process.env.CROSS_CLI_WORKTREE) {
      stage = 'actual CLI process acceptance';
      const { verifyCli } = await import('./cli.mjs');
      await verifyCli({ apiBaseUrl, bridge, wallet, accountId: profile.accountId });
      check((await row())[0].metadata.bio === 'Actual CLI cross-repo acceptance', 'CLI profile mutation was not persisted');
    }
  } finally {
    for (const c of clients) {
      try { if (await c.auth.getSession()) await c.auth.logout(); }
      catch { cleanupFailed = true; }
    }
    // Delete only rows belonging to this newly generated test wallet.
    try {
      await sql(`BEGIN; CREATE TEMP TABLE cross_cleanup_ids ON COMMIT DROP AS SELECT user_id FROM "${schema}".user_address WHERE address='${address}'; DELETE FROM "${schema}".user_address WHERE address='${address}'; DELETE FROM "${schema}"."user" WHERE id IN (SELECT user_id FROM cross_cleanup_ids); COMMIT;`);
    } catch { cleanupFailed = true; }
  }
  check(!cleanupFailed, 'Acceptance cleanup failed; discard isolated test services/database');
  console.log('PASS cross-repository acceptance (social-provider/browser UI continuity not covered)');
}

run().catch(error => {
  // SDK errors and subprocess errors may contain credentials or connection URLs.
  if (error instanceof PrerequisiteError) {
    console.error(`UNAVAILABLE: ${error.message}`);
    process.exitCode = 2;
  } else {
    console.error(`FAIL (${stage}): ${error instanceof assert.AssertionError ? error.message : 'Operation failed; inspect local service diagnostics without exposing credentials'}`);
    process.exitCode = 1;
  }
});
