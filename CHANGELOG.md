# Changelog

All notable changes to `@rareprotocol/rare-sdk` are documented here. The
project follows semantic versioning.

## Unreleased

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
