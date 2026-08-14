# AGENTS.md

## Development Approach

Build around a functional core and an imperative shell.

The functional core is pure business logic: inputs in, outputs out. It owns validation, normalization, transformations, request/transaction planning, branching rules, and other domain decisions. It must not perform I/O, HTTP/RPC calls, contract writes, file access, logging, or process termination.

The imperative shell is the thin orchestration layer. It calls APIs/RPC/wallets, reads files and runtime configuration, performs writes, and passes plain data into the functional core. In this repo, SDK client methods, API clients, wallet setup, and modules named `*-shell.ts` are shell code.

Tip: Compare SDK functionality against actual contract implementations in the core repo:

- https://github.com/superrare/core
- https://github.com/superrare/core/blob/main/README.md

## Boundaries

- Put decisions in pure functions before wiring them into SDK methods.
- Keep SDK methods thin and let focused core modules own meaningful behavior and reusable flows.
- Keep downstream clients, including `rare-cli`, as thin wrappers around this SDK rather than adding consumer-specific behavior here.
- Pass dependencies into shell code instead of burying side effects inside core logic.
- Return structured data from core logic instead of logging, terminating a process, or mutating external state.

## SDK Write-Flow Policy

SDK methods that perform durable side effects should order work from cheapest and safest to most expensive and irreversible:

1. Local validation and planning.
2. Remote reads and simulation.
3. External API writes or uploads needed by the transaction.
4. Approval or allowance writes.
5. Final on-chain write.
6. Receipt parsing and post-write verification.

The goal is to fail before creating persistent external state whenever we reasonably can. Contract writes, approvals, uploads, and imports are product-visible actions; callers should not be surprised by a side effect that could have been avoided with local validation or a cheap remote preflight.

### Local validation and planning

- Normalize and validate user inputs before any RPC, HTTP, upload, wallet, or file side effect.
- Put business decisions in pure `plan*`, `build*`, `normalize*`, or `validate*` helpers in core modules.
- Plans should return structured data: normalized amounts, addresses, timestamps, roots, proofs, split recipients, write args, and branch decisions.
- Reject impossible or unsupported inputs in the plan layer: missing required fields, invalid amounts, unsupported modes, malformed roots/proofs, duplicate split recipients, mismatched artifacts, and unsafe numeric inputs.
- Keep SDK shell methods focused on dependency resolution, preflight reads, side effects, and result shaping.

### Remote preflight before writes

- Prefer remote validation before any durable write when the preflight is reliable and not more expensive than the write it protects.
- Use contract reads to check ownership, permissions, active config, current sale state, balances, limits, existing roots, allowlist status, and token/currency metadata when those conditions affect whether a write can succeed.
- Use `publicClient.simulateContract` before `walletClient.writeContract` for target writes when practical, especially for user-facing write flows, release configuration, marketplace actions, minting, and metadata/royalty mutations.
- Simulate the final target operation before approval writes when the target call can be simulated without the approval already being present. If simulation requires a missing approval, document that limitation in the flow and rely on the best available reads.
- Treat API-backed proof/root resolution as remote validation. Verify API results against local artifacts or on-chain active roots when possible before proceeding.
- Do not add simulation only for appearances. If a contract is nondeterministic, state-dependent in a way simulation cannot model, or requires side effects that have not happened yet, use explicit reads and clear error messages instead.

### Uploads, API writes, and other external side effects

- Defer uploads, imports, and other API writes until local planning and relevant remote preflight have passed.
- When an API write produces data consumed by an on-chain write, verify the API response against the local plan before writing on-chain. Examples: generated Merkle roots should match artifact roots; uploaded metadata should satisfy the planned token URI flow.
- Keep upload/API request body construction in pure builders where possible, and keep the HTTP call in shell code.
- If an upload must happen before the final transaction and the transaction later fails, return or throw enough context for the caller to retry without repeating expensive work when possible.

### Approvals and allowance side effects

- Approvals are persistent side effects. Only perform them after local validation and all feasible remote preflight for the target operation.
- Prefer checking existing allowance/approval first. Do not write an approval if the current state is already sufficient.
- Support `autoApprove: false` or an equivalent caller-controlled path for flows where users may want to stop before approval.
- Wrap target-operation failures after a mined approval with a catchable error that includes the approval transaction and approved target/spender/minter. `ApprovalSideEffectError` is the model.
- After writing an approval, verify that the approval or allowance is readable before continuing when the next operation depends on it.
- Avoid broad approvals unless the protocol flow requires them. If broad approval is required, make that behavior explicit in the helper and result shape.

### Final writes and post-write verification

- Keep final `writeContract` / `sendTransaction` calls as late as possible in the method.
- Parse receipts for expected events when the event is part of the public result contract.
- Verify post-write state when event logs are insufficient or when the contract/API can report the updated configuration directly.
- Throw with enough context to diagnose failed verification: operation name, contract, token/root/config, tx hash, and relevant observed values.
- Return structured results from SDK methods: tx hash, receipt, normalized inputs, derived amounts, addresses, approval tx hashes, and parsed event/config data.

### Acceptable exceptions

- Some target writes cannot be fully simulated before an approval because the approval is itself a precondition. In those cases, do every other cheap preflight first, perform the approval, verify it, and wrap later failures as approval side-effect errors.
- Some flows require uploads or API registration before an on-chain write because the transaction consumes a URI, CID, Merkle root, or server-generated proof. Validate everything available before the upload, verify the returned data, then proceed.
- Some writes are intentionally simple pass-through operations. Even then, perform local normalization first and consider simulation if the write is user-facing or likely to fail for predictable reasons.
- Reads used for status methods may be best-effort where contracts vary by generation. Do not apply best-effort swallowing to write preflight unless the write flow has a clear fallback and error story.

### Review questions for new SDK writes

- Did every input-dependent decision happen before the first side effect?
- Is there a pure planner/builder for the meaningful business logic?
- Can the final target write be simulated before approvals or uploads? If not, why not?
- Are ownership, permission, allowance, active config, root/proof, and amount assumptions checked before writing?
- Are durable pre-final side effects unavoidable, caller-controlled where appropriate, and surfaced in errors/results?
- Does the method verify the receipt or final state rather than assuming the write did what we expected?
- Would an SDK consumer have enough structured data to retry, recover, or clean up after a partial failure?

## Public SDK Design

Treat package exports as product APIs. Only export symbols that we intend consumers to import, document, test, and rely on across releases.

- Keep `@rareprotocol/rare-sdk` and `@rareprotocol/rare-sdk/client` focused on the high-level SDK client: `createRareClient`, public namespace params/results, public response model types, and catchable public errors.
- Put lower-level viem building blocks behind explicit subpaths such as `@rareprotocol/rare-sdk/contracts` for addresses, chain metadata, and ABIs.
- Put standalone pure helpers behind explicit user-intent subpaths such as `@rareprotocol/rare-sdk/utils`; also expose the same flows through `rare.utils.*` when they are part of the client experience.
- Keep Rare API access behind `@rareprotocol/rare-sdk/data-access`.
- Do not export planners, write builders, shell helpers, validation internals, or implementation-shaped functions from the public client barrel. Keep those behind internal imports.
- Keep `package.json` exports, `typesVersions`, build entry points, README documentation, and package export tests aligned when adding or changing a public subpath.
- Before adding an export, ask: would we document this, test it as public behavior, and treat changes to it as semver-significant? If not, keep it internal.

## Error Handling

The rule of thumb is: **if the caller wants to handle the failure differently in code, return it; if the operation cannot continue, throw it.**

### Throw when

- Crossing an I/O boundary: RPC, HTTP, filesystem, wallet, or contract calls. Viem and `openapi-fetch` already throw rich errors; do not catch and wrap unless adding actionable context or a public catchable error.
- The failure is a bug-class invariant: impossible states, unreachable branches, or programmer errors. Use an explicit message such as `throw new Error('unreachable: ...')`.
- The failure is at the SDK's public surface. SDK consumers expect Promise rejections, not Result types. Throwing keeps the SDK ergonomic and consistent with the JavaScript ecosystem.
- A public operation cannot fulfill its contract because its inputs or current remote state are invalid.

### Return a discriminated result when

- The failure is expected and part of a pure function's contract: input validation, parsing, or business-rule checks.
- The caller often wants to branch on the failure mode, accumulate errors, or try alternatives rather than propagate.
- The function lives in the functional core. Decisions should return structured data so outputs remain easy to test and reason about.
- The caller should enumerate failure cases at compile time. Prefer a tagged union and exhaustive handling.

### Return `undefined` / `null` when

- A lookup has a single "not found" mode and no useful "why," such as a `find(...)`-style return.
- Avoid this when absence is ambiguous: not found vs not loaded vs intentionally empty.

### Anti-patterns

- **Try/catch as control flow inside the core.** If code uses `try { parseFoo(x) } catch { ... }` to choose a branch, `parseFoo` should usually return a Result instead.
- **Boolean returns for failure.** `function doThing(): boolean` discards the reason. Either throw or return a Result.
- **Catch-rewrap-rethrow without `cause`.** If wrapping an error, preserve the original with `{ cause: original }`.
- **Catching `unknown` and swallowing it.** `catch { return undefined }` silently hides real bugs.
- **Logging or terminating a consumer's process from SDK code.** Throw and let the consuming application choose presentation and process behavior.
- **Domain errors with no `instanceof` discriminator.** Publicly actionable failures should use exported custom error classes; model API failures on `RareApiError` in `src/data-access/errors.ts` and partial-side-effect failures on `ApprovalSideEffectError`.

### Where the two patterns live

- Throwing: public methods and shell modules in `src/sdk/**`, plus API/RPC/wallet/filesystem boundaries.
- Returning: pure `*-core.ts` modules and other functional-core helpers when invalidity is an expected branch.

Both are correct because they sit on opposite sides of the I/O boundary. Match new code to whichever side it belongs on.

## Testing Approach

The core/shell split guides test scope. Use the cheapest test that gives real confidence.

Bias heavily toward integration tests. If behavior is dead simple, do not add a unit test just for coverage; cover it through an integration test instead.

Tests in this repo should focus on the SDK. CLI command wiring and user-visible CLI behavior belong in the `rare-cli` repository.

## Unit Tests

Write unit tests only for functional core logic. They should call pure functions directly with plain inputs and assert returned outputs. They should not need mocks.

Good unit-test targets:

- Domain validation.
- Amount, address, chain, and currency normalization.
- Metadata and attribute transformations.
- Transaction parameter construction.
- Error classification or result shaping, when pure.

Avoid unit tests for pass-through code, logging, formatting-only wrappers, HTTP/RPC calls, file access, or other shell behavior.

## Integration Tests

Integration tests should carry most of the coverage and should focus on SDK behavior across module boundaries.

Avoid mocks in integration tests. Integration tests should exercise the real SDK shell against real or controlled external dependencies, such as the live Rare API, real viem clients, real RPC endpoints, forks, or dedicated testnet services. If a behavior only needs fake clients, fake fetches, or mocked contract calls, it is probably pure functional core logic and belongs in a unit test instead. If testing a behavior requires a real on-chain write transaction, it probably belongs in an E2E test.

Cover:

- Public SDK methods and exported client behavior.
- Package entry points and ESM/CommonJS export compatibility.
- API request/response handling.
- Contract read flows.
- Transaction preparation and write orchestration.
- Realistic success and failure paths.
- On-chain write coverage using a local fork or dedicated testnet.

## E2E Tests

Test public SDK write flows as a consumer would, using built package entry points and asserting observable chain or API effects.

Keep CLI E2E tests in `rare-cli`; this repository should not acquire CLI-only fixtures or process assertions.

## Validation Commands

Run the checks relevant to the change:

- `npm run typecheck`
- `npm run lint`
- `npm run test`

`npm run test` builds the package before running the Vitest suite. Before publishing, use the complete `npm run prepublishOnly` validation.

## Review Checklist

- Business rules live in pure functions.
- Core logic has unit tests only when it contains real decisions.
- SDK behavior has integration coverage for realistic flows.
- Public exports and package metadata remain aligned.
- SDK write flows have E2E coverage when they affect on-chain state.
- Consumer-specific CLI behavior stays in `rare-cli`.
