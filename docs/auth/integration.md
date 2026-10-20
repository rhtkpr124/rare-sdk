# Cross-repository acceptance

Run from the SDK checkout with Node 24, a built SDK, a built auth service, `psql`,
and `redis-server`. These commands are explicitly opt-in and are not part of the
ordinary unit suite. No production endpoints or database may be used.

## Real dependencies

The gate calls the built SDK, real authority HTTP routes and device bridge, real
Rare API HTTP routes, and gql-api backed by migrated Postgres. The auth launcher uses the actual shared Fastify server (legacy plus v2 routes) and
real Redis against a newly launched disposable Redis process. It generates only
temporary service credentials and the legacy JWT secret; v2 needs no signing keys.
Stopping it destroys all test sessions. EOA signing uses a new
random in-memory wallet on each run. No real wallet or social-provider credentials
are needed.

The runner does **not** supply a fake account resolver or mock GraphQL responses.
Start the actual backend account services first (or a backend-owned narrow server
that mounts the real routes, GraphQL resolver/service, service guard and persistent
database). Configure any publisher dependencies with their real local emulators.
Using an in-memory account map or mocked GraphQL transport does not satisfy this
gate.

## Environment and commands

Supply paths and test-only secrets through the environment. The harness contains
no developer-specific checkout paths. Generate one random internal API key
locally and share it between backend and authority configuration; do not commit
them or paste credential values into test reports.

```sh
export RARE_CROSS_REPO=1
export CROSS_AUTH_WORKTREE=/absolute/path/to/auth-worktree
export CROSS_AUTH_URL=http://127.0.0.1:3031/auth/v2
export CROSS_API_URL=http://127.0.0.1:3032
export CROSS_DATABASE_URL=postgresql://test_user:test_password@127.0.0.1:5433/sdk_acceptance
# Also set CROSS_AUTH_INTERNAL_API_KEY to a random value (at least 32 characters).
# Optional executable overrides: PSQL_BIN and REDIS_SERVER_BIN.

npm run build
node test/cross-repo/authority.mjs
```

Run the last command in its own terminal. It prints `READY` only after the actual
authority listens. It requires the auth checkout's root `build/` output from `npm run build`
and installed root dependencies. Stop it with Ctrl-C when finished.

The backend must use `CROSS_DATABASE_URL` and these matching settings:

- Device approval credential: `CROSS_AUTH_INTERNAL_API_KEY`.
- `AUTH_SERVICE`: the origin of `CROSS_AUTH_URL`, for internal transport.
- `RARE_API_PUBLIC_URL`: `CROSS_API_URL`, selecting the local API listener.
  Auth needs no API URL setting. Its origin allowlist includes both local origins.
- Introspection accepts the access token alone; no service key is sent.
- Existing accounts are managed through GET/PATCH `/v1/me`; login does not provision an account.
- Actual authenticated GraphQL transport to the account resolver.

With the backend listening and the same environment in another terminal:

```sh
node test/cross-repo/run.mjs
```

Alternatively, the reusable local composition launcher starts both the authority
and actual Rare API, generates matching ephemeral service credentials, runs the
gate, then stops only the processes it launched. First start the backend-owned
GraphQL harness with real Postgres and Pub/Sub as documented in the monorepo's
`docs/sdk-auth-delivery.md`. Supply its generated private environment file:

```sh
export CROSS_MONOREPO_WORKTREE=/absolute/path/to/superrare-monorepo-worktree
export CROSS_BACKEND_ENV_FILE=/absolute/path/to/sdk-account-harness.env
# CROSS_DATABASE_URL must match the backend database. Its schema query parameter
# is supported, or set CROSS_DATABASE_SCHEMA explicitly (default: public).
# Optional: test the actual built CLI as well, with isolated file storage:
export CROSS_CLI_WORKTREE=/absolute/path/to/rare-cli-worktree
node test/cross-repo/local-stack.mjs
```

The earlier `RARE_CROSS_REPO`, `CROSS_AUTH_WORKTREE`, `CROSS_AUTH_URL`,
`CROSS_API_URL`, and `CROSS_DATABASE_URL` variables are also required. This launcher
generates the shared internal API key itself; they need not be exported. It uses
`pnpm` (`PNPM_BIN` can override its executable) and the backend test environment
template. An already running GraphQL service is required; it does not create or
migrate the database. The provided API port overrides the backend harness default.

The optional CLI gate requires the built CLI's explicit `--auth-directory` support.
It starts device login without opening a browser, approves the code using the real
bridge, resumes login in another CLI process, verifies status, reads/updates the
profile, then logs out. It uses a new private temporary storage directory and
explicit file storage; it never changes HOME or accesses the native keychain.

## Assertions and result semantics

The SDK and CLI receive only `CROSS_API_URL`. Their public login, refresh and
revocation requests pass through Rare API at `/auth/v2`. `CROSS_AUTH_URL` remains
the direct internal listener address used solely for bridge and introspection
checks; it is not an SDK configuration option. The SDK transport asserts that
every request stays on the public API origin.

The runner verifies:

0. Introspection and internal device approval routes are rejected through the public API
   (401/403/404/405; backend proxy tests separately verify upstream noninvocation).

1. Wallet login leaves the database unchanged and binds its stored session to the
   public API auth URL. The runner then seeds an account in the disposable database.
2. SDK profile reads and writes match persisted data.
3. A separate login reuses that account and preserves its profile.
4. Explicit SDK refresh rotates credentials and the actual API accepts the result.
5. Logout makes both previous and refreshed access tokens immediately unauthorized,
   while a separate installation remains authorized.
6. Device review and a fresh review-bound wallet signature, followed by SDK polling
   at its actual cadence, resolve to the same persisted account.
7. Revoking the device session makes its access token unauthorized.

Tokens, private keys, service secrets, and device codes are never printed. Database
credentials are passed to `psql` via its environment rather than command arguments.
The gate revokes sessions and deletes only the newly generated wallet's account
rows. Always use an isolated disposable database because real publication can
produce downstream effects outside those rows.

- Exit **0** and final `PASS`: the assertions completed.
- Exit **2** and `UNAVAILABLE`: prerequisites or reachable local services are missing;
  this is not a skipped success or a completed acceptance gate.
- Exit **1** and `FAIL`: a runtime assertion/operation failed after preflight.

This gate deliberately exercises the private bridge directly. It does not establish
browser CSRF/UI behavior, social-provider account continuity, deployed configuration,
smart-wallet RPC verification, or CLI OS-keychain behavior; those require their
separate gates. Do not describe this result as proof of those behaviors.

## Public auth limits and Redis retention

This manual check needs built Auth and Rare API checkouts, `redis-server`, and Node. It starts private loopback services and disposable Redis. It does not require an account, GraphQL, or a deployed environment because these authentication paths do not call account services.

```sh
CROSS_AUTH_WORKTREE=/absolute/path/to/auth \
CROSS_MONOREPO_WORKTREE=/absolute/path/to/superrare-monorepo \
node test/cross-repo/public-boundaries.mjs
```

The check exercises the actual Rare API auth route handlers and actual Auth service. A stalled HTTP listener deliberately injects an RPC transport failure; it never returns a fabricated signature-verification result. The check verifies that a supported large hex-signature envelope reaches Auth, RPC timeout fails closed within the public deadline, oversized bodies are rejected, private introspection remains unexposed, trusted introspection survives anonymous quota exhaustion, wrong credentials cannot bypass that quota, and logout invalidates access after 100 refresh rotations. It reports retained-record memory and TTL without printing credentials. This does not prove successful large ERC-1271 contract verification or deployed Redis configuration. No CI job is added.

### Public messaging regression coverage

`npm run test:integration:messaging:public` uses deployed Rare API/Auth and the
existing dedicated account wallets. Set `RARE_ACCOUNT_TEST_API_URL`,
`RARE_ACCOUNT_TEST_PRIVATE_KEY`, `RARE_ACCOUNT_TEST_SECOND_PRIVATE_KEY`, and
`RARE_MESSAGING_TEST_PUBLIC_CONTEXTS` with auction, liquid-edition and
announcement fixtures. The trusted-producer case also requires
`RARE_MESSAGING_TEST_INTERNAL_API_KEY` from the paired non-production service.
It creates and deletes its own announcement fixture.

The suite checks anonymous history, liquid-edition address normalization,
subscription visibility in the authenticated inbox, persisted reaction totals,
per-viewer reactions, report-and-hide isolation, and canonical system-message
retries. Changed array order must conflict even when object key order does not.

Use `account.messaging.historyPublic(roomId, options)` for a signed-in public
view. `api.messaging.history(roomId, options)` stays anonymous. CLI users can
select the signed-in view with `rare messaging public history <room-id>
--authenticated` or the equivalent flag on `watch`.
