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

export type CartRoutingSettlement = {
  settlementCurrency: Address;
  amount: string;
  routed: boolean;
};

export type CartRoutingRoute = {
  commands: Hex;
  inputs: Hex[];
  routerValue: string;
};

export type CartRoutingQuoteEvidence = {
  source: 'direct' | 'uniswap-api';
  mode: CartRoutingMode;
  quoteIds: string[];
  quotedInput: string;
  protectedMaximumInput: string;
  exactOutputs: Array<{ settlementCurrency: Address; amount: string }>;
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
  expectedPaymentInput: string;
  maximumPaymentInput: string;
  directPaymentInput: string;
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
  quote: (params: CartRoutingQuoteParams) => Promise<CartRoutingQuoteResult>;
  assertFresh: (quote: CartRoutingQuoteResult, nowMs?: number) => CartRoutingQuoteResult;
};
