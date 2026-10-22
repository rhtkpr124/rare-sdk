# Shared account authentication contract — delivery v1

Status: shared implementation contract, 2026-09-24. Wire changes must be coordinated across the authority, API, SDK and CLI.

## Authority and migration
An encapsulated Fastify v2 module in the existing auth service, sharing its listener, dependencies, Redis connection, TypeScript build and Jest suite. Redis namespaces and credential contracts remain separate from legacy auth. The existing auth Node runtime is unchanged; legacy routes/cookies and current Connect/SuperRare flows retain their behavior. V2 configuration is required at auth startup. No second service, OIDC provider or deployment is introduced.

`apiBaseUrl` is the only SDK/CLI service URL. Auth routes are derived as `<apiBaseUrl>/auth/v2`. Production defaults to `https://api.superrare.com`; the development API base is `https://rare-api-devmainnet-784573620320.us-east1.run.app`. Production host/routing/key provisioning is deployment work. HTTPS required except loopback local development; no credential-bearing redirects. Static public clients `rare-cli` and `rare-sdk`; no dynamic registration. Requested scope `rare:account offline_access`. Fixed configured resource is Rare API audience. Sessions/SDK persisted envelopes are bound to authority, client and API base.

## Routing boundary
Rare API forwards only POST `/auth/v2/wallet/challenge`, `/auth/v2/device/authorization`, `/auth/v2/token` and `/auth/v2/revoke` to its configured `AUTH_SERVICE` internal base. Auth still owns proof verification and session lifecycle. The proxy preserves OAuth responses, refuses redirects, bounds request/response sizes and time, and does not forward caller cookies, Authorization or service credentials. It never exposes introspection, hosted bridge or legacy routes through a wildcard. Introspection and Connect's protected bridge use `AUTH_SERVICE` directly. No load balancer changes are required for either environment.

Auth needs no Rare API URL or URL-based issuer. Rare API validates opaque tokens through its configured `AUTH_SERVICE`. Auth isolates Redis records by stable `K_SERVICE`, falling back to `K_VERSION` or `local`. The namespace change requires fresh login once; image revisions within the same service preserve sessions.

## Public authority API
The paths below are relative to the public API's `/auth/v2` prefix.
- POST `/wallet/challenge` JSON `{client_id,address,chain_id,origin}` -> `{challenge_id,message,expires_in:300}`. Store exact issued SIWE message, address, chain, client and resource; nonce single-use. Signing scheme, domain and URI use the validated origin. Auth uses the existing SIWE origin allowlist, and browser requests must match their HTTP Origin header. The SDK defaults to the browser page's origin, or the selected API origin for non-browser signing. Native callers supply origin in JSON without forging the HTTP header.
- POST `/token` form-urlencoded wallet grant `{grant_type:'urn:superrare:params:oauth:grant-type:siwe',client_id,challenge_id,message,signature}`.
- POST `/device/authorization` form-urlencoded `{client_id,scope:'rare:account offline_access'}` -> RFC8628 `{device_code,user_code,verification_uri,verification_uri_complete?,expires_in:600,interval:5}`.
- POST `/token` form-urlencoded device grant `{grant_type:'urn:ietf:params:oauth:grant-type:device_code',client_id,device_code}`. OAuth pending/slow_down/denied/expired errors.
- POST `/token` form-urlencoded refresh `{grant_type:'refresh_token',client_id,refresh_token}`.
- All successful token responses `{access_token,token_type:'Bearer',expires_in:300,refresh_token,scope:'rare:account offline_access'}`. No credentials in URLs/logs. Cache-Control no-store.
- POST `/revoke` form-urlencoded `{client_id,token:refreshToken,token_type_hint:'refresh_token'}` -> empty 200, revoke whole grant family; unknown token also 200. Never revoke another client's token family.
- Internal POST `/introspect` form-urlencoded `{token:accessToken}` directly on `AUTH_SERVICE` (not exposed by the API passthrough). Returns `{active:false}` or `{active:true,sub:verifiedAddress,client_id,scope,aud,exp,address,chain_id,sid}`; chain_id is a positive integer number. JSON response no-store. Active verifies both token and current family/address binding. Introspection resolves the opaque token and its current session family in Redis; raw bearer tokens are not persisted.
Access and refresh tokens are opaque random credentials. There is no v2 JWT, signing-key/JWKS endpoint or OIDC discovery. Rare API always validates access through introspection.

Wallet verification EOA then EIP1271/6492 on signed allowlisted chain only. Canonical existing account model remains address-global (not chain-qualified). Never use a different chain's successful verification as proof on requested chain; no linking or email identity merge.

Policy: 5-minute access/challenge, 10-minute device, 30-day refresh idle, 365-day absolute family maximum. Strict rotation, replay revokes family; ambiguous lost refresh response requires reauthentication (no silent retry). Atomic consumption and revocation fencing across instances. SDK/CLI serialize refresh using shared store lock. API does online introspection per request; unavailable authority means 503, inactive token means 401. In-flight operations cannot be retroactively cancelled.

## Account API
Auth verifies the wallet and manages tokens only. It does not resolve or create accounts. Rare API resolves the verified address using existing gql-api operations; wallets without an account receive `account_required` on account endpoints. Signup remains separate.
GET/PATCH `/v1/me` new bearer credentials only. Response `{data:{accountId,address,username,email,profile:{fullName,bio,avatar}}}`. Email and three profile fields nullable in the response. Rare API verifies that the authenticated address belongs to the account and is not compromised. Strict PATCH `{username?,profile?:{fullName?:string,bio?:string,avatar?:string}}`, at least one field; omission preserves stored values. Email mutation deferred. The existing gql-api writer merges supplied metadata with stored fields; when an account ID is supplied, it updates an existing row and never creates a replacement. Unique username conflicts return 409. 400 invalid input; 401 invalid auth; 403 compromised/forbidden; 409 conflict; 503 upstream unavailable. Private responses no-store. No caller accountId/address fields.

## Hosted approval
New `/device` UI in connect-com. Reuse Reown configured provider/social/email/wallet connection; sign a fresh v2 SIWE challenge rather than exchanging legacy sessions. Explicit reviewed approve/deny, requesting app/user code/account displayed; account switch invalidates review. Same-origin protected server proxy (Origin/CSRF) to authority bridge. Proof binds decision to exact interaction/device request. Never return CLI token/device secret to browser, accept browser-selected accountId, or follow arbitrary return URL.

The Connect server uses a shared server-only `AUTH_INTERNAL_API_KEY` Bearer credential for `/auth/v2` endpoints:
- POST `/internal/device/reviews` with `{user_code}` returns `{review_id,client_id,client_name,user_code,scope,expires_in}`.
- POST `/internal/device/reviews/:reviewId/challenge` with `{address,chain_id,origin}` returns a fresh review-bound wallet challenge.
- POST `/internal/device/reviews/:reviewId/decision` accepts `{decision:'approve',challenge_id,message,signature}` or `{decision:'deny'}` and returns the corresponding status.

Review capabilities remain in protected state, never URLs or logs. Device-bound proofs cannot be redeemed by the public wallet grant. The authority uses a distributed one-time claim for each normalized user code and separately consumes the review decision. Ambiguous decisions require a new device login. Redis state transitions handle review creation, approval/denial and one-time device redemption directly. There is no provider cookie jar, HTML form parsing or internal HTTP resume. The auth repository's `docs/auth-v2-device-bridge.md` documents the server mechanism.

## SDK / CLI
One `createRareClient` supports API/account features with optional chain configuration. Managed browser sessions persist through an origin-local store and native Web Locks; Node defaults to memory. Session store `get/set/clear/withLock`; read-after-lock and await durable writes. No user signing/waiting under session lock. All session fields sensitive. Credential envelope includes authBaseUrl,apiBaseUrl,clientId,accessToken,refreshToken,expiresAt(epoch ms),scope and a revision. A durable write-ahead `refreshBlocked` marker prevents replay after a crashed or ambiguous refresh; the retained credential may still be explicitly revoked. Logout writes a nonsecret revision tombstone to fence pending login completion across processes.

Device state includes expiry/interval/nextPollAt, session revision and auth URL/client/API binding, allowing separate start/poll/resume commands. SDK poll returns updated state for persistence; obey server cadence across invocations. CLI stores pending state under a separate lock, no device tokens in argv/stdout. JSON only safe result objects. Logout retains credentials on transport failure for retry; explicit local clear available.

## Verification / rollout
Real Redis protocol/race tests; real Postgres account/profile integration; SDK local HTTP tests plus cross-repo real integration; CLI process tests; hosted browser state/CSRF tests. Social-provider same-wallet continuity requires an authenticated external test and must be reported if unverified. No credentials are checked in. V2 needs no signing-key file; legacy JWT configuration remains unchanged. Deliver configuration templates with empty defaults and docs, not production activation. Preserve existing test suites. SDK release dependency for CLI coordinated before PR completion.

Auth uses `/auth/v2` routes and derives `/device` from its public `CONNECT_URL`. Its audience is fixed to `rare-api`; service secrets have matching names across repositories. SDK/CLI derive auth routes from their single API base; internal auth routing remains server-side configuration.
