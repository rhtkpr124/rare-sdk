import { describe, expectTypeOf, it } from 'vitest';
import type {
  AmountInput,
  AuctionCreateParams,
  BridgeParams,
  CollectionRoyaltyInfoParams,
  DeployLiquidEditionParams,
  ListingCreateParams,
  OfferCreateParams,
  RouterBuyParams,
} from '../../../src/sdk/index.js';

describe('public crypto value input types', () => {
  it('requires bigint base units across public SDK namespaces', () => {
    expectTypeOf<AmountInput>().toEqualTypeOf<bigint>();
    expectTypeOf<ListingCreateParams['price']>().toEqualTypeOf<bigint>();
    expectTypeOf<OfferCreateParams['price']>().toEqualTypeOf<bigint>();
    expectTypeOf<AuctionCreateParams['price']>().toEqualTypeOf<bigint>();
    expectTypeOf<BridgeParams['amount']>().toEqualTypeOf<bigint>();
    expectTypeOf<RouterBuyParams['amountIn']>().toEqualTypeOf<bigint>();
    expectTypeOf<DeployLiquidEditionParams['totalSupply']>().toEqualTypeOf<bigint | undefined>();
    expectTypeOf<CollectionRoyaltyInfoParams['price']>().toEqualTypeOf<bigint | undefined>();
  });
});
