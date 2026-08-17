import type { Address } from 'viem';
import type { AmountInput, IntegerInput, TransactionResult } from './common.js';

type Hex = `0x${string}`;

export type RouterBuyParams = {
  token: Address;
  amountIn: AmountInput;
  minAmountOut: AmountInput;
  commands: `0x${string}`;
  inputs: readonly `0x${string}`[];
  recipient?: Address;
  deadline?: IntegerInput;
}

export type RouterSellParams = {
  token: Address;
  amountIn: AmountInput;
  minAmountOut: AmountInput;
  commands: `0x${string}`;
  inputs: readonly `0x${string}`[];
  recipient?: Address;
  deadline?: IntegerInput;
  autoApprove?: boolean;
}

export type RouterSwapTokensParams = {
  tokenIn: Address;
  amountIn: AmountInput;
  tokenOut: Address;
  minAmountOut: AmountInput;
  commands: `0x${string}`;
  inputs: readonly `0x${string}`[];
  recipient?: Address;
  deadline?: IntegerInput;
  autoApprove?: boolean;
}

export type BuyRareParams = {
  amountIn: AmountInput;
  minAmountOut?: AmountInput;
  slippageBps?: IntegerInput;
  recipient?: Address;
  deadline?: IntegerInput;
}

export type TokenTradeRouteMode = 'auto' | 'local' | 'uniswap';
export type TokenTradeExecutionRoute = TokenTradeRouteMode | 'raw';

export type TokenTradeBaseParams = {
  token: Address;
  amountIn: AmountInput;
  minAmountOut?: AmountInput;
  slippageBps?: IntegerInput;
  recipient?: Address;
  deadline?: IntegerInput;
}

export type TokenTradeQuoteParams = TokenTradeBaseParams & {
  route?: TokenTradeRouteMode;
}

export type TokenTradeRawRouteParams = Omit<TokenTradeBaseParams, 'minAmountOut' | 'slippageBps'> & {
  route: 'raw';
  minAmountOut: AmountInput;
  commands: Hex;
  inputs: readonly Hex[];
}

export type TokenTradeWriteOptions = {
  autoApprove?: boolean;
}

export type BuyTokenParams = (TokenTradeQuoteParams | TokenTradeRawRouteParams) & TokenTradeWriteOptions;
export type SellTokenParams = (TokenTradeQuoteParams | TokenTradeRawRouteParams) & TokenTradeWriteOptions;

export type TokenTradeRouteSource = 'liquid-edition' | 'known-pool' | 'uniswap-api' | 'raw';
export type TokenTradeExecution = 'liquid-router' | 'uniswap-api' | 'raw-router';

export type TokenTradeQuoteBase = {
  amountIn: bigint;
  estimatedAmountOut: bigint;
  minAmountOut: bigint;
  tokenIn: Address;
  tokenOut: Address;
  inputDecimals: number;
  outputDecimals: number;
  slippageBps: number;
  routeDescription: string;
}

export type LiquidRouterTokenTradeQuote = {
  routeSource: Extract<TokenTradeRouteSource, 'liquid-edition' | 'known-pool'>;
  execution: 'liquid-router';
  commands: `0x${string}`;
  inputs: readonly `0x${string}`[];
} & TokenTradeQuoteBase

export type UniswapApiTokenTradeQuote = {
  routeSource: 'uniswap-api';
  execution: 'uniswap-api';
} & TokenTradeQuoteBase

export type TokenTradeQuote = LiquidRouterTokenTradeQuote | UniswapApiTokenTradeQuote;

export type TokenTradeResult = {
  estimatedAmountOut: bigint;
  minAmountOut: bigint;
  routeSource: TokenTradeRouteSource;
  execution: TokenTradeExecution;
  commands?: Hex;
  inputs?: readonly Hex[];
  approvalTxHash?: Hex;
  approvalResetTxHash?: Hex;
} & TransactionResult

export type BuyRareQuote = {
  ethAmount: bigint;
  rareAddress: Address;
  estimatedRareOut: bigint;
  minRareOut: bigint;
  slippageBps: number;
  commands: `0x${string}`;
  inputs: readonly `0x${string}`[];
}

export type BuyRareResult = {
  estimatedRareOut: bigint;
  minRareOut: bigint;
  commands: `0x${string}`;
  inputs: readonly `0x${string}`[];
} & TransactionResult

export type SwapNamespace = {
  buy: (params: RouterBuyParams) => Promise<TransactionResult>;
  sell: (params: RouterSellParams) => Promise<TransactionResult>;
  swapTokens: (params: RouterSwapTokensParams) => Promise<TransactionResult>;
  quoteBuyToken: (params: TokenTradeQuoteParams) => Promise<TokenTradeQuote>;
  buyToken: (params: BuyTokenParams) => Promise<TokenTradeResult>;
  quoteSellToken: (params: TokenTradeQuoteParams) => Promise<TokenTradeQuote>;
  sellToken: (params: SellTokenParams) => Promise<TokenTradeResult>;
  quoteBuyRare: (params: BuyRareParams) => Promise<BuyRareQuote>;
  buyRare: (params: BuyRareParams) => Promise<BuyRareResult>;
}
