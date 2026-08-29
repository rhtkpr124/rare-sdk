# Changelog

All notable changes to `@rareprotocol/rare-sdk` are documented here. The
project follows semantic versioning.

## Unreleased

- **Breaking:** replace implementation-shaped Cart Listing Root methods with
  separate `rare.cart.catalog.products.search` and `.variants.search` resources
  plus `rare.cart.listing.prepare` / `.publish`; keep
  advanced artifact, authorization, order, route, hashing, and Merkle builders
  under `utils`.
- **Breaking:** remove authenticated Product creation, SKU creation, and
  Product-SKU attachment from the high-level Cart SDK. Connect-authenticated
  applications should call those Rare API account-management routes directly.
- **Breaking:** replace Cart's signed-order `checkout.prepare` / `checkout.execute`
  split with wallet-independent `checkout.prepare(intent)` and one-stop
  `checkout.purchase({ preparation, autoApprove })` orchestration.
- **Breaking:** move Cart collection authorization from Listing methods to
  `rare.cart.approval.status`, `.approve`, and `.revoke`; Cart resolves its own
  operator address and approval writes are idempotent.
- Align Cart Listing and Order Line terminology and EIP-712 hashes with the
  contract's `listingSalt` and `listingDigest` fields, and publish the upgraded
  Sepolia CartLens and optional CartHashes helper deployment.
- Align Cart route hashing, ABIs, Lens deployment, and prepared-purchase wire
  data with the signed Universal Router `routerValue` settlement boundary.
- Add the chain-bound Cart SDK with deterministic seller Listing Root artifacts,
  fixed-quote Purchase Orders, policy-compatible route construction, optional
  Lens diagnostics, explicit payment and asset approvals, and verified checkout
  execution on the deployed Ethereum Sepolia Cart.
- Add batch-oriented Cart artifact parsing, validation, leaf lookup, and
  multi-root authorization builders for order-book storage and checkout assembly.
- Expose Cart EIP-712 hashes and contract-compatible sorted-pair Listing Merkle
  verification from the public `utils` entry point, including bigint chain IDs.

- Removed the unsupported `recipient` input from RareMinter direct-sale release mint parameters. Mint results still report the connected wallet as the observed recipient.

- Establish SDK-owned code generation, lint rules, tests, documentation, and
  package validation.
- **Breaking:** approval-capable writes now default to `autoApprove: false`.
  Pass `autoApprove: true` to preserve one-call approval-and-write behavior, or
  catch the exported approval-required errors and retry after user consent.
- **Breaking:** Lazy ERC-721 deployment uses `variant` with `standard`,
  `royalty-guard`, or `deadman-royalty-guard` values instead of the public
  `contractType` field and `lazy-*` values.
- **Breaking:** public crypto-denominated inputs now require bigint base units.
  Applications must convert decimal UI values with `parseEther`, `parseUnits`,
  or an equivalent caller-owned conversion before invoking the SDK.
- **Breaking:** batch listing creation now accepts the same token-tree artifact
  as batch auction and offer creation, with price, currency, and splits passed
  as explicit method parameters. Mixed listing registration artifacts are no
  longer accepted by the create method.

## 0.1.3 - 2026-07-24

- Correct the ERC-1155 payment approval spender used by marketplace writes.

## 0.1.2 - 2026-07-22

- Preserve transaction fallback behavior for Reown social wallets and expose
  the context needed to diagnose fallback transactions.

## 0.1.1 - 2026-07-07

- Regenerate Rare API types from the production schema.

## 0.1.0 - 2026-07-06

- Extract the Rare Protocol SDK from `@rareprotocol/rare-cli`.
- Publish dual ESM and CommonJS output with package subpath exports.
- Add packaging and library-hygiene validation for the standalone package.
