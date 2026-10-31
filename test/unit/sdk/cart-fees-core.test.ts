import { describe, expect, it } from "vitest";
import {
  planCartFeeCreate,
  parseCartFee,
  parseCartFeePage,
  type CartFeeCreateParams,
} from "../../../src/sdk/cart-fees-core.js";
const input: CartFeeCreateParams = {
  phase: "LISTING_CONFIGURATION",
  code: "GALLERY_COMMISSION",
  calculation: {
    type: "FIXED",
    amount: 12345678901234567890n,
    currencyMode: "COMPONENT_CURRENCY",
  },
  recipient: {
    type: "FIXED",
    address: "0x1111111111111111111111111111111111111111",
  },
  scope: {
    nfts: [
      {
        chainId: 11155111,
        contract: "0x2222222222222222222222222222222222222222",
        tokenId: 9007199254740993n,
      },
    ],
  },
  priority: 200,
};
describe("Cart fee planning and response normalization", () => {
  it("serializes bigint money and NFT identity without precision loss", () => {
    const plan = planCartFeeCreate({
      ...input,
      phase: "LISTING_CONFIGURATION",
      calculation: {
        type: "FIXED",
        amount: 12345678901234567890n,
        currencyMode: "COMPONENT_CURRENCY",
      },
      recipient: {
        type: "FIXED",
        address: "0x1111111111111111111111111111111111111111",
      },
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error(plan.message);
    expect(plan.value.calculation).toMatchObject({
      amount: "12345678901234567890",
    });
    expect(plan.value.scope.nfts?.[0]).toMatchObject({
      chainId: "11155111",
      tokenId: "9007199254740993",
    });
    expect(() => JSON.stringify(plan.value)).not.toThrow();
    const wire = {
      ...plan.value,
      id: "1",
      ruleId: "2",
      chargeSku: `0x${"ab".repeat(32)}`,
    };
    expect(parseCartFee(wire).calculation).toMatchObject({
      amount: 12345678901234567890n,
    });
    expect(parseCartFee(wire).scope.nfts?.[0]?.tokenId).toBe(9007199254740993n);
    expect(
      parseCartFeePage({ data: [wire], hasNextPage: false }).data,
    ).toHaveLength(1);
  });
  it("rejects invalid fee calculations, windows and unsupported item-scoped checkout rules", () => {
    const valid: CartFeeCreateParams = {
      ...input,
      phase: "LISTING_CONFIGURATION",
      calculation: {
        type: "PERCENTAGE",
        basisPoints: 250,
        currencyMode: "COMPONENT_CURRENCY",
      },
      recipient: {
        type: "FIXED",
        address: "0x1111111111111111111111111111111111111111",
      },
    };
    expect(planCartFeeCreate({ ...valid, phase: "CHECKOUT" }).ok).toBe(false);
    expect(
      planCartFeeCreate({
        ...valid,
        phase: "LISTING_CONFIGURATION",
        calculation: {
          type: "FIXED",
          amount: -1n,
          currencyMode: "COMPONENT_CURRENCY",
        },
      }).ok,
    ).toBe(false);
    expect(
      planCartFeeCreate({
        ...valid,
        phase: "LISTING_CONFIGURATION",
        validFrom: "2026-11-02T00:00:00Z",
        validUntil: "2026-11-01T00:00:00Z",
      }).ok,
    ).toBe(false);
  });
});
