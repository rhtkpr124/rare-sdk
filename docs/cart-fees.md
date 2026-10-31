# Platform fee administration

Fee methods use the client's authenticated account. Rare API permits them only when the account's canonical user ID is listed in `CART_ADMIN_USER_IDS`. Creators do not gain fee permissions by owning a Product or NFT.

```typescript
const fee = await rare.cart.fees.create({
  phase: 'LISTING_CONFIGURATION',
  code: 'GALLERY_COMMISSION',
  priority: 200,
  calculation: { type: 'PERCENTAGE', basisPoints: 250, currencyMode: 'COMPONENT_CURRENCY' },
  recipient: { type: 'FIXED', address: treasury },
  scope: { nfts: [{ chainId: 11155111, contract, tokenId: 7n }] },
});

const page = await rare.cart.fees.list({ page: 1, perPage: 20 });
await rare.cart.fees.disable(fee.id);
```

Use `scope.collections: [{ chainId, contract }]` for a collection override. The highest-priority applicable assignment wins for each fee code. Use higher priorities for more specific overrides, for example 100 for a collection and 200 for an NFT. Equal highest priorities produce a conflict. Disabling an assignment restores the next applicable rule while retaining its audit records.

Creating a fee atomically creates its internal charge SKU, rule and assignment. Clients do not create charge SKUs directly. Fixed and per-unit `amount` values are base-unit `bigint` values; scope them to the intended settlement currency when token decimals differ. A zero-percent calculation represents an intentional fee waiver.

NFT, collection, SKU and other item-specific overrides use `LISTING_CONFIGURATION`. They apply when new listing terms are prepared; existing seller signatures retain their authorized terms. `CHECKOUT` fees apply to settlement-currency subtotals and accept chain/payment/settlement-currency scopes, not item scopes.

All methods accept a second request-options argument containing `signal`. List results expose `hasNextPage` without inventing a total count.

CLI equivalents are `rare cart fees create --input fee.json --yes`, `rare cart fees list --json`, and `rare cart fees disable --id ID --yes`. JSON files use decimal strings for fixed amounts and NFT token IDs, and numbers for chain IDs.
