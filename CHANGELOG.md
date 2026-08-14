# Changelog

All notable changes to `@rareprotocol/rare-sdk` are documented here. The
project follows semantic versioning.

## Unreleased

- Establish SDK-owned CI, code generation, lint rules, tests, documentation,
  and package validation.

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
