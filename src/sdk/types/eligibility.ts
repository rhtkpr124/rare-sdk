import type { Address, Hex } from 'viem';

/** An event-driven rule issues SKU-scoped purchase rights. */
export type EligibilityRuleDefinition = {
  kind: 'PRIMARY_SALE' | 'EVERY_SALE' | 'CURRENT_HOLDER';
  source: { chainId: string; tokenContract: string; tokenIds?: string[] };
  targets: { sku: string; tokenId?: string }[];
  claimExpiresAt?: string;
};

export type CreateEligibilityRule = {
  /** Stable UUID for retrying rule creation without issuing a second rule. */
  idempotencyKey?: string;
  definition: EligibilityRuleDefinition;
  effectiveFrom?: string;
};

export type EligibilityRule = {
  id: string;
  issuerAccountId: string;
  version: number;
  enabled: boolean;
  effectiveFrom: string;
  definition: EligibilityRuleDefinition;
};

/** Reservations and consumption are controlled by checkout, not client mutations. */
export type EligibilityClaim = {
  id: string;
  ruleId: string;
  allowedSkus: string[];
  status: 'AVAILABLE' | 'RESERVED' | 'CONSUMED' | 'REVOKED';
  expiresAt: string | null;
  beneficiaryAccountId: string | null;
};

export type EligibilityListingScope = {
  chainId: string;
  cartAddress: Address;
  listingDigest: Hex;
};

export type EligibilityListOptions = { take?: number; skip?: number };
export type EligibilityClaimListOptions = EligibilityListOptions & { sku?: Hex; ruleId?: string };

export type EligibilityNamespace = {
  createRule: (input: CreateEligibilityRule) => Promise<EligibilityRule>;
  listRules: (options?: EligibilityListOptions) => Promise<EligibilityRule[]>;
  disableRule: (ruleId: string) => Promise<void>;
  listClaims: (options?: EligibilityClaimListOptions) => Promise<EligibilityClaim[]>;
  setListingRequirement: (input: EligibilityListingScope & { ruleId: string }) => Promise<void>;
  clearListingRequirement: (input: EligibilityListingScope) => Promise<void>;
};
