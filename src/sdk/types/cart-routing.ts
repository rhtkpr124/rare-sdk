import type { Address, Hex } from 'viem';
import type { SupportedChain } from '../../contracts/addresses.js';

export type CartRoutingMode = 'exact-output' | 'exact-input';

export type CartSettlementObligation = {
  settlementCurrency: Address;
  amount: bigint;
};

export type CartRoutingQuoteParams = {
  paymentCurrency: Address;
  obligations: readonly CartSettlementObligation[];
  mode?: CartRoutingMode;
};

export type CartRoutingInputQuoteParams = {
  paymentCurrency: Address;
  outputCurrency: Address;
  inputAmount: bigint;
};

export type CartRoutingInputQuoteResult = {
  inputAmount: bigint;
  outputAmount: bigint;
  quotedAt: string;
  expiresAt: string;
};

export type CartRoutingSettlement = {
  settlementCurrency: Address;
  amount: bigint;
  routed: boolean;
};

export type CartRoutingRoute = {
  commands: Hex;
  inputs: Hex[];
  routerValue: bigint;
};

export type CartRoutingQuoteEvidence = {
  source: 'direct' | 'uniswap-api' | 'known-pool-rpc';
  mode: CartRoutingMode;
  quoteIds: string[];
  compilerRequestIds: string[];
  quotedInput: bigint;
  protectedMaximumInput: bigint;
  exactOutputs: Array<{ settlementCurrency: Address; amount: bigint }>;
  quotedAt: string;
  expiresAt: string;
  routeDescription: string;
};

export type CartRoutingQuoteResult = {
  schemaVersion: 1;
  chain: SupportedChain;
  chainId: number;
  paymentCurrency: Address;
  mode: CartRoutingMode;
  expectedPaymentInput: bigint;
  maximumPaymentInput: bigint;
  directPaymentInput: bigint;
  settlements: CartRoutingSettlement[];
  route: CartRoutingRoute;
  quotedAt: string;
  expiresAt: string;
  evidence: CartRoutingQuoteEvidence;
};

export type CartRoutingErrorCode =
  | 'unsupported_chain'
  | 'unsupported_currency'
  | 'unsupported_pair'
  | 'no_route'
  | 'insufficient_liquidity'
  | 'quote_unavailable'
  | 'quote_expired'
  | 'invalid_response'
  | 'cart_incompatible_route';

export type CartRoutingErrorDetails = {
  paymentCurrency?: Address;
  settlementCurrency?: Address;
  quoteId?: string;
  reason?: string;
  providerStatus?: number;
  providerRequestId?: string;
  route?: { commands: Hex; inputCount: number };
};

export type CartRoutingNamespace = {
  /** Convert an input budget into a fixed output, including protocol spread protection. */
  quoteInput: (params: CartRoutingInputQuoteParams) => Promise<CartRoutingInputQuoteResult>;
  quote: (params: CartRoutingQuoteParams) => Promise<CartRoutingQuoteResult>;
  assertFresh: (quote: CartRoutingQuoteResult, nowMs?: number) => CartRoutingQuoteResult;
};
