import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { createRareClient } from "../../../src/sdk/client.js";
import { createMemoryAccountSessionStore } from "../../../src/sdk/account-session-store.js";
const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Error(
      `${name} is required for fee administration integration coverage.`,
    );
  return value;
};
const client = async (token: string) => {
  const apiBaseUrl = required("RARE_API_BASE_URL").replace(/\/$/, "");
  const sessionStore = createMemoryAccountSessionStore();
  await sessionStore.set({
    revision: randomBytes(16).toString("hex"),
    apiBaseUrl,
    authBaseUrl: `${apiBaseUrl}/auth/v2`,
    clientId: "rare-sdk",
    accessToken: token,
    refreshToken: randomBytes(32).toString("hex"),
    expiresAt: Date.now() + 300000,
    scope: "rare:account offline_access",
  });
  return createRareClient({
    publicClient: createPublicClient({ chain: sepolia, transport: http() }),
    apiBaseUrl,
    sessionStore,
  });
};
describe("SDK fee administration against a real Rare API", () => {
  it("creates, reads and disables scoped overrides while rejecting a non-admin account", async () => {
    const admin = await client(required("RARE_API_AUTH_TOKEN")),
      other = await client(required("RARE_API_NON_ADMIN_AUTH_TOKEN"));
    const input = {
      phase: "LISTING_CONFIGURATION",
      code: "GALLERY_COMMISSION",
      priority: 200,
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
            contract: `0x${randomBytes(20).toString("hex")}`,
            tokenId: 9007199254740993n,
          },
        ],
      },
    };
    const created = await admin.cart.fees.create({
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
    try {
      expect(created.calculation).toMatchObject({
        amount: 12345678901234567890n,
      });
      expect(created.scope.nfts?.[0]?.tokenId).toBe(9007199254740993n);
      expect(
        (await admin.cart.fees.list({ page: 1, perPage: 100 })).data.some(
          (fee) => fee.id === created.id,
        ),
      ).toBe(true);
      await expect(other.cart.fees.list()).rejects.toThrow();
      await expect(other.cart.fees.disable(created.id)).rejects.toThrow();
    } finally {
      await admin.cart.fees.disable(created.id);
    }
    expect(
      (await admin.cart.fees.list({ page: 1, perPage: 100 })).data.some(
        (fee) => fee.id === created.id,
      ),
    ).toBe(false);
  }, 60000);
});
