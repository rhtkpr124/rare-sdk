import { getAddress, isHex, type Address } from 'viem';
import { readOptionalProcessEnv } from '../runtime-env.js';

export { getQuotedRecipientAmount } from './trade-core.js';

const DEFAULT_UNISWAP_TRADE_API_BASE_URL = 'https://trade-api.gateway.uniswap.org/v1';

export type UniswapTransactionRequest = {
  to: Address;
  from: Address;
  data: `0x${string}`;
  value: string;
  chainId: number;
  gasLimit?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  gasPrice?: string;
}

export type UniswapApprovalResponse = {
  requestId: string;
  approval: UniswapTransactionRequest | null;
  cancel: UniswapTransactionRequest | null;
  gasFee?: string;
  cancelGasFee?: string;
}

export type UniswapQuoteRouteToken = {
  chainId: number;
  decimals: string;
  address: Address;
  symbol?: string;
}

export type UniswapQuoteRouteHop = {
  type: string;
  address?: string;
  tokenIn: UniswapQuoteRouteToken;
  tokenOut: UniswapQuoteRouteToken;
  fee?: string;
  tickSpacing?: string;
  hooks?: Address;
  amountIn?: string;
  amountOut?: string;
}

export type UniswapQuotePayload = {
  chainId: number;
  input: {
    amount: string;
    token: Address;
    maximumAmount?: string;
  };
  output: {
    amount: string;
    token: Address;
    recipient: Address;
    minimumAmount?: string;
  };
  swapper: Address;
  route: UniswapQuoteRouteHop[][];
  slippage?: number;
  slippageTolerance?: number;
  tradeType: 'EXACT_INPUT' | 'EXACT_OUTPUT';
  quoteId: string;
  routeString?: string;
  aggregatedOutputs?: Array<{
    amount: string;
    token: Address;
    recipient: Address;
    bps: number;
    minAmount: string;
  }>;
  txFailureReasons?: string[];
}

export type UniswapQuoteResponse = {
  requestId: string;
  routing: string;
  quote: UniswapQuotePayload;
  permitData: unknown;
}

export type UniswapSwapResponse = {
  requestId: string;
  swap: UniswapTransactionRequest;
  gasFee?: string;
}

type UniswapApiRequestOptions = {
  apiKey?: string;
  baseUrl?: string;
}

type QuoteRequestParams = {
  apiKey?: string;
  baseUrl?: string;
  chainId: number;
  tokenIn: Address;
  tokenOut: Address;
  amount: bigint;
  swapper: Address;
  slippageBps: number;
  tradeType?: UniswapQuotePayload['tradeType'];
}

function getBaseUrl(options?: UniswapApiRequestOptions): string {
  return options?.baseUrl ?? readOptionalProcessEnv('UNISWAP_TRADE_API_BASE_URL') ?? DEFAULT_UNISWAP_TRADE_API_BASE_URL;
}

function requireApiKey(options?: UniswapApiRequestOptions): string {
  const apiKey = options?.apiKey;
  if (!apiKey) {
    throw new Error(
      'A Uniswap API key is required to use the Uniswap route. ' +
        'Pass `apiKey` in the Uniswap request options.',
    );
  }
  return apiKey;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Uniswap API response field "${field}" must be a string.`);
  }
  return value;
}

function parseOptionalString(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : parseString(value, field);
}

function parseNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Uniswap API response field "${field}" must be a finite number.`);
  }
  return value;
}

function parseOptionalNumber(value: unknown, field: string): number | undefined {
  return value === undefined ? undefined : parseNumber(value, field);
}

function parseAddress(value: unknown, field: string): Address {
  const raw = parseString(value, field);
  try {
    return getAddress(raw);
  } catch {
    throw new Error(`Uniswap API response field "${field}" must be a valid EVM address.`);
  }
}

function parseOptionalAddress(value: unknown, field: string): Address | undefined {
  return value === undefined ? undefined : parseAddress(value, field);
}

function parseHex(value: unknown, field: string): `0x${string}` {
  const raw = parseString(value, field);
  if (!isHex(raw)) {
    throw new Error(`Uniswap API response field "${field}" must be a hex string.`);
  }
  return raw;
}

function parseRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Uniswap API response field "${field}" must be an object.`);
  }
  return value;
}

function parseTradeType(value: unknown, field: string): UniswapQuotePayload['tradeType'] {
  if (value === 'EXACT_INPUT' || value === 'EXACT_OUTPUT') {
    return value;
  }
  throw new Error(`Uniswap API response field "${field}" has an unsupported trade type.`);
}

function parseStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Uniswap API response field "${field}" must be an array.`);
  }

  return value.map((entry, index) => parseString(entry, `${field}[${index}]`));
}

function parseQuoteRouteToken(value: unknown, field: string): UniswapQuoteRouteToken {
  const record = parseRecord(value, field);
  const symbol = parseOptionalString(record.symbol, `${field}.symbol`);
  return {
    ...record,
    chainId: parseNumber(record.chainId, `${field}.chainId`),
    decimals: parseString(record.decimals, `${field}.decimals`),
    address: parseAddress(record.address, `${field}.address`),
    ...(symbol !== undefined ? { symbol } : {}),
  };
}

function parseQuoteRouteHop(value: unknown, field: string): UniswapQuoteRouteHop {
  const record = parseRecord(value, field);
  const address = parseOptionalString(record.address, `${field}.address`);
  const fee = parseOptionalString(record.fee, `${field}.fee`);
  const tickSpacing = parseOptionalString(record.tickSpacing, `${field}.tickSpacing`);
  const hooks = parseOptionalAddress(record.hooks, `${field}.hooks`);
  const amountIn = parseOptionalString(record.amountIn, `${field}.amountIn`);
  const amountOut = parseOptionalString(record.amountOut, `${field}.amountOut`);

  return {
    ...record,
    type: parseString(record.type, `${field}.type`),
    tokenIn: parseQuoteRouteToken(record.tokenIn, `${field}.tokenIn`),
    tokenOut: parseQuoteRouteToken(record.tokenOut, `${field}.tokenOut`),
    ...(address !== undefined ? { address } : {}),
    ...(fee !== undefined ? { fee } : {}),
    ...(tickSpacing !== undefined ? { tickSpacing } : {}),
    ...(hooks !== undefined ? { hooks } : {}),
    ...(amountIn !== undefined ? { amountIn } : {}),
    ...(amountOut !== undefined ? { amountOut } : {}),
  };
}

function parseQuoteRoute(value: unknown, field: string): UniswapQuoteRouteHop[][] {
  if (!Array.isArray(value)) {
    throw new Error(`Uniswap API response field "${field}" must be an array.`);
  }

  return value.map((route, routeIndex) => {
    if (!Array.isArray(route)) {
      throw new Error(`Uniswap API response field "${field}[${routeIndex}]" must be an array.`);
    }
    return route.map((hop, hopIndex) => parseQuoteRouteHop(hop, `${field}[${routeIndex}][${hopIndex}]`));
  });
}

function parseQuoteInput(value: unknown, field: string): UniswapQuotePayload['input'] {
  const record = parseRecord(value, field);
  const maximumAmount = parseOptionalString(record.maximumAmount, `${field}.maximumAmount`);
  return {
    amount: parseString(record.amount, `${field}.amount`),
    token: parseAddress(record.token, `${field}.token`),
    ...(maximumAmount !== undefined ? { maximumAmount } : {}),
  };
}

function parseQuoteOutput(value: unknown, field: string): UniswapQuotePayload['output'] {
  const record = parseRecord(value, field);
  const minimumAmount = parseOptionalString(record.minimumAmount, `${field}.minimumAmount`);
  return {
    amount: parseString(record.amount, `${field}.amount`),
    token: parseAddress(record.token, `${field}.token`),
    recipient: parseAddress(record.recipient, `${field}.recipient`),
    ...(minimumAmount !== undefined ? { minimumAmount } : {}),
  };
}

function parseAggregatedOutput(value: unknown, field: string): NonNullable<UniswapQuotePayload['aggregatedOutputs']>[number] {
  const record = parseRecord(value, field);
  return {
    ...record,
    amount: parseString(record.amount, `${field}.amount`),
    token: parseAddress(record.token, `${field}.token`),
    recipient: parseAddress(record.recipient, `${field}.recipient`),
    bps: parseNumber(record.bps, `${field}.bps`),
    minAmount: parseString(record.minAmount, `${field}.minAmount`),
  };
}

function parseAggregatedOutputs(value: unknown, field: string): UniswapQuotePayload['aggregatedOutputs'] {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`Uniswap API response field "${field}" must be an array.`);
  }
  return value.map((output, index) => parseAggregatedOutput(output, `${field}[${index}]`));
}

function parseQuotePayload(value: unknown, field: string): UniswapQuotePayload {
  const record = parseRecord(value, field);
  const routeString = parseOptionalString(record.routeString, `${field}.routeString`);
  const slippage = parseOptionalNumber(record.slippage, `${field}.slippage`);
  const slippageTolerance = parseOptionalNumber(record.slippageTolerance, `${field}.slippageTolerance`);
  const aggregatedOutputs = parseAggregatedOutputs(record.aggregatedOutputs, `${field}.aggregatedOutputs`);
  const txFailureReasons =
    record.txFailureReasons === undefined
      ? undefined
      : parseStringArray(record.txFailureReasons, `${field}.txFailureReasons`);

  return {
    ...record,
    chainId: parseNumber(record.chainId, `${field}.chainId`),
    input: parseQuoteInput(record.input, `${field}.input`),
    output: parseQuoteOutput(record.output, `${field}.output`),
    swapper: parseAddress(record.swapper, `${field}.swapper`),
    route: parseQuoteRoute(record.route, `${field}.route`),
    ...(slippage !== undefined ? { slippage } : {}),
    ...(slippageTolerance !== undefined ? { slippageTolerance } : {}),
    tradeType: parseTradeType(record.tradeType, `${field}.tradeType`),
    quoteId: parseString(record.quoteId, `${field}.quoteId`),
    ...(routeString !== undefined ? { routeString } : {}),
    ...(aggregatedOutputs !== undefined ? { aggregatedOutputs } : {}),
    ...(txFailureReasons !== undefined ? { txFailureReasons } : {}),
  };
}

function parseTransactionRequest(value: unknown, field: string): UniswapTransactionRequest {
  const record = parseRecord(value, field);
  const gasLimit = parseOptionalString(record.gasLimit, `${field}.gasLimit`);
  const maxFeePerGas = parseOptionalString(record.maxFeePerGas, `${field}.maxFeePerGas`);
  const maxPriorityFeePerGas = parseOptionalString(record.maxPriorityFeePerGas, `${field}.maxPriorityFeePerGas`);
  const gasPrice = parseOptionalString(record.gasPrice, `${field}.gasPrice`);

  return {
    to: parseAddress(record.to, `${field}.to`),
    from: parseAddress(record.from, `${field}.from`),
    data: parseHex(record.data, `${field}.data`),
    value: parseString(record.value, `${field}.value`),
    chainId: parseNumber(record.chainId, `${field}.chainId`),
    ...(gasLimit !== undefined ? { gasLimit } : {}),
    ...(maxFeePerGas !== undefined ? { maxFeePerGas } : {}),
    ...(maxPriorityFeePerGas !== undefined ? { maxPriorityFeePerGas } : {}),
    ...(gasPrice !== undefined ? { gasPrice } : {}),
  };
}

function parseNullableTransactionRequest(value: unknown, field: string): UniswapTransactionRequest | null {
  return value === null || value === undefined ? null : parseTransactionRequest(value, field);
}

function parseUniswapQuoteResponse(value: unknown): UniswapQuoteResponse {
  const record = parseRecord(value, 'response');
  return {
    requestId: parseString(record.requestId, 'response.requestId'),
    routing: parseString(record.routing, 'response.routing'),
    quote: parseQuotePayload(record.quote, 'response.quote'),
    permitData: record.permitData ?? null,
  };
}

function parseUniswapApprovalResponse(value: unknown): UniswapApprovalResponse {
  const record = parseRecord(value, 'response');
  const gasFee = parseOptionalString(record.gasFee, 'response.gasFee');
  const cancelGasFee = parseOptionalString(record.cancelGasFee, 'response.cancelGasFee');

  return {
    requestId: parseString(record.requestId, 'response.requestId'),
    approval: parseNullableTransactionRequest(record.approval, 'response.approval'),
    cancel: parseNullableTransactionRequest(record.cancel, 'response.cancel'),
    ...(gasFee !== undefined ? { gasFee } : {}),
    ...(cancelGasFee !== undefined ? { cancelGasFee } : {}),
  };
}

function parseUniswapSwapResponse(value: unknown): UniswapSwapResponse {
  const record = parseRecord(value, 'response');
  const gasFee = parseOptionalString(record.gasFee, 'response.gasFee');

  return {
    requestId: parseString(record.requestId, 'response.requestId'),
    swap: parseTransactionRequest(record.swap, 'response.swap'),
    ...(gasFee !== undefined ? { gasFee } : {}),
  };
}

function getErrorMessage(parsed: unknown): string | undefined {
  if (isRecord(parsed) && typeof parsed.message === 'string') {
    return parsed.message;
  }
  return undefined;
}

async function parseJsonResponse<T>(response: Response, parse: (value: unknown) => T): Promise<T> {
  const text = await response.text();
  const parsed = parseJsonOrNull(text);

  if (!response.ok) {
    const message = getErrorMessage(parsed) ?? (text.length > 0 ? text : response.statusText);
    throw new Error(`Uniswap API ${response.status} ${response.statusText}: ${message}`);
  }

  return parse(parsed);
}

function parseJsonOrNull(text: string): unknown {
  if (text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function buildHeaders(options?: UniswapApiRequestOptions): HeadersInit {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'x-api-key': requireApiKey(options),
    'x-permit2-disabled': 'true',
    'x-universal-router-version': '2.0',
  };
}

export async function requestUniswapQuote(params: QuoteRequestParams): Promise<UniswapQuoteResponse> {
  const response = await fetch(`${getBaseUrl(params)}/quote`, {
    method: 'POST',
    headers: buildHeaders(params),
    body: JSON.stringify({
      type: params.tradeType ?? 'EXACT_INPUT',
      tokenInChainId: params.chainId,
      tokenOutChainId: params.chainId,
      amount: params.amount.toString(),
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      swapper: params.swapper,
      protocols: ['V4', 'V3', 'V2'],
      routingPreference: 'BEST_PRICE',
      slippageTolerance: params.slippageBps / 100,
    }),
  });

  return parseJsonResponse(response, parseUniswapQuoteResponse);
}

export async function requestUniswapApproval(params: {
  apiKey?: string;
  baseUrl?: string;
  chainId: number;
  walletAddress: Address;
  token: Address;
  amount: bigint;
  tokenOut: Address;
}): Promise<UniswapApprovalResponse> {
  const response = await fetch(`${getBaseUrl(params)}/check_approval`, {
    method: 'POST',
    headers: buildHeaders(params),
    body: JSON.stringify({
      chainId: params.chainId,
      walletAddress: params.walletAddress,
      token: params.token,
      amount: params.amount.toString(),
      tokenOut: params.tokenOut,
      tokenOutChainId: params.chainId,
      includeGasInfo: true,
      urgency: 'normal',
    }),
  });

  return parseJsonResponse(response, parseUniswapApprovalResponse);
}

export async function requestUniswapSwap(params: {
  apiKey?: string;
  baseUrl?: string;
  quote: UniswapQuotePayload;
  deadline?: number;
}): Promise<UniswapSwapResponse> {
  const response = await fetch(`${getBaseUrl(params)}/swap`, {
    method: 'POST',
    headers: buildHeaders(params),
    body: JSON.stringify({
      quote: params.quote,
      refreshGasPrice: true,
      simulateTransaction: true,
      safetyMode: 'SAFE',
      urgency: 'normal',
      ...(params.deadline !== undefined ? { deadline: params.deadline } : {}),
    }),
  });

  return parseJsonResponse(response, parseUniswapSwapResponse);
}
