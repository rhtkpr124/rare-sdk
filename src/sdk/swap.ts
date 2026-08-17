import { type Address } from 'viem';
import { ETH_ADDRESS, type SupportedChain } from '../contracts/addresses.js';
import { liquidRouterAbi } from '../contracts/abis/liquid-router.js';
import { getKnownCanonicalEthPoolKey, getRareAddress } from '../swap/known-pools.js';
import { getLiquidEditionPoolKey } from '../swap/liquid-edition.js';
import { quoteRoute } from '../swap/quoter.js';
import { encodeRoute } from '../swap/route-encoding.js';
import {
  requestUniswapApproval,
  requestUniswapQuote,
  requestUniswapSwap,
  type UniswapQuotePayload,
} from '../swap/uniswap-api.js';
import type { ResolvedRoute } from '../swap/route-types.js';
import {
  ensureTokenAllowance,
  getTokenDecimals,
  PaymentApprovalRequiredError,
  toTokenAmount,
} from './payments-shell.js';
import { runWithApprovalSideEffectAlert } from './approvals-shell.js';
import {
  getConfiguredAccountAddress,
  requireWallet,
  resolveDeadline,
  sendPreparedTransaction,
} from './wallet-shell.js';
import {
  requireConfiguredAddress,
  requireInput,
  validateRouterPayload,
} from './validation-core.js';
import {
  toSafeIntegerNumber,
  toWei,
} from './amounts-core.js';
import {
  assertRecipientSupportedForUniswapFallback,
  assertRequotedMinAmountOut,
  assertRequestedMinAmountOut,
  assertSupportedUniswapRouting,
  buildBuyRareQuoteFromTokenQuote,
  buildCanonicalEthTradeRoute,
  buildLiquidRouterTradeQuote,
  buildUniswapTradeQuote,
  computeMinAmountOut,
  computeSlippageBpsFromAmounts,
  getQuotedRecipientAmount,
  planTokenTradeLocalInputs,
  resolveSlippageBps,
} from '../swap/trade-core.js';
import type {
  AmountInput,
  IntegerInput,
  TransactionResult,
} from './types/common.js';
import type { RareClientConfig } from './types/client.js';
import type {
  BuyRareParams,
  BuyRareQuote,
  BuyRareResult,
  BuyTokenParams,
  SellTokenParams,
  SwapNamespace,
  TokenTradeQuoteParams,
  TokenTradeRawRouteParams,
  TokenTradeRouteMode,
  TokenTradeResult,
  TokenTradeQuote,
} from './types/swap.js';

export type * from './types/swap.js';

type TokenTradeDirection = 'buy' | 'sell';
type LocalTokenTradeQuote = Extract<TokenTradeQuote, { execution: 'liquid-router' }>;
type UniswapTokenTradeQuote = Extract<TokenTradeQuote, { execution: 'uniswap-api' }>;

type LocalBuyTradeParams = {
  direction: 'buy';
  token: Address;
  amountIn: AmountInput;
  minAmountOut?: AmountInput;
  slippageBps?: IntegerInput;
  recipient?: Address;
  route?: TokenTradeRouteMode;
  uniswapApiKey?: string;
  resolveUniswapApiKey?: RareClientConfig['resolveUniswapApiKey'];
};

type LocalSellTradeParams = {
  direction: 'sell';
  token: Address;
  amountIn: AmountInput;
  minAmountOut?: AmountInput;
  slippageBps?: IntegerInput;
  recipient?: Address;
  route?: TokenTradeRouteMode;
  uniswapApiKey?: string;
  resolveUniswapApiKey?: RareClientConfig['resolveUniswapApiKey'];
};

type LocalTradeParams = LocalBuyTradeParams | LocalSellTradeParams;

type LocalTokenTradeQuoteDetails = {
  kind: 'local';
  quote: LocalTokenTradeQuote;
};

type LocalTokenTradeQuoteUnavailableReason = 'no-canonical-route';

type LocalTokenTradeQuoteUnavailable = {
  kind: 'unavailable';
  reason: LocalTokenTradeQuoteUnavailableReason;
};

type LocalTokenTradeQuoteResult = LocalTokenTradeQuoteDetails | LocalTokenTradeQuoteUnavailable;

type UniswapTokenTradeQuoteDetails = {
  kind: 'uniswap';
  quote: UniswapTokenTradeQuote;
  rawQuote: UniswapQuotePayload;
  tokenIn: Address;
  tokenOut: Address;
  apiKey?: string;
};

type TokenTradeQuoteDetails = LocalTokenTradeQuoteDetails | UniswapTokenTradeQuoteDetails;
type UniswapQuoteResponse = Awaited<ReturnType<typeof requestUniswapQuote>>;

async function resolveCanonicalEthTradeRoute(
  publicClient: RareClientConfig['publicClient'],
  chain: SupportedChain,
  token: Address,
  direction: TokenTradeDirection,
): Promise<ResolvedRoute | null> {
  const knownPoolKey = getKnownCanonicalEthPoolKey(chain, token);
  if (knownPoolKey) {
    return buildCanonicalEthTradeRoute({
      chain,
      token,
      direction,
      poolKey: knownPoolKey,
      routeSource: 'known-pool',
    });
  }

  const liquidPoolKey = await getLiquidEditionPoolKey(publicClient, token);
  if (!liquidPoolKey) {
    return null;
  }

  return buildCanonicalEthTradeRoute({
    chain,
    token,
    direction,
    poolKey: liquidPoolKey,
    routeSource: 'liquid-edition',
  });
}

async function buildLocalTokenTradeQuote(
  publicClient: RareClientConfig['publicClient'],
  chain: SupportedChain,
  addresses: { v4Quoter?: Address },
  params: LocalTradeParams,
): Promise<LocalTokenTradeQuoteResult> {
  const route = await resolveCanonicalEthTradeRoute(publicClient, chain, params.token, params.direction);
  if (!route) {
    return { kind: 'unavailable', reason: 'no-canonical-route' };
  }

  const quoterAddress = requireConfiguredAddress(addresses.v4Quoter, 'Uniswap V4 quoter', chain);
  const amountIn =
    params.direction === 'buy'
      ? toWei(params.amountIn)
      : await toTokenAmount(publicClient, params.token, params.amountIn, 'amountIn');
  const defaultSlippageBps = resolveSlippageBps(params.slippageBps);
  const estimatedQuote = await quoteRoute(publicClient, quoterAddress, route, amountIn, 0n);
  const minAmountOut =
    params.direction === 'buy'
      ? params.minAmountOut !== undefined
        ? await toTokenAmount(publicClient, params.token, params.minAmountOut, 'minAmountOut')
        : computeMinAmountOut(estimatedQuote.amountOut, defaultSlippageBps)
      : params.minAmountOut !== undefined
        ? toWei(params.minAmountOut)
        : computeMinAmountOut(estimatedQuote.amountOut, defaultSlippageBps);
  const routeQuote = { ...estimatedQuote, minAmountOut };
  const { commands, inputs } = encodeRoute(routeQuote, amountIn, route.tokenIn, route.tokenOut);

  return {
    kind: 'local',
    quote: buildLiquidRouterTradeQuote({
      amountIn,
      route,
      routeQuote,
      minAmountOut,
      inputDecimals: await getTokenDecimals(publicClient, route.tokenIn),
      outputDecimals: await getTokenDecimals(publicClient, route.tokenOut),
      defaultSlippageBps,
      usedMinAmountOutOverride: params.minAmountOut !== undefined,
      commands,
      inputs,
    }),
  };
}

async function buildUniswapFallbackTradeQuote(
  publicClient: RareClientConfig['publicClient'],
  chainId: number,
  token: Address,
  accountAddress: Address,
  params: LocalTradeParams,
): Promise<UniswapTokenTradeQuoteDetails> {
  assertRecipientSupportedForUniswapFallback(params.recipient, accountAddress);
  const apiKey = await resolveUniswapApiKey(params);

  const tokenIn = params.direction === 'buy' ? ETH_ADDRESS : token;
  const tokenOut = params.direction === 'buy' ? token : ETH_ADDRESS;
  const amountIn =
    params.direction === 'buy'
      ? toWei(params.amountIn)
      : await toTokenAmount(publicClient, token, params.amountIn, 'amountIn');
  const requestedMinAmountOut =
    params.direction === 'buy'
      ? params.minAmountOut !== undefined
        ? await toTokenAmount(publicClient, token, params.minAmountOut, 'minAmountOut')
        : undefined
      : params.minAmountOut !== undefined
        ? toWei(params.minAmountOut)
        : undefined;
  const defaultSlippageBps = resolveSlippageBps(params.slippageBps);

  const initialQuoteResponse = await requestUniswapQuote({
    apiKey,
    chainId,
    tokenIn,
    tokenOut,
    amount: amountIn,
    swapper: accountAddress,
    slippageBps: defaultSlippageBps,
  });

  assertSupportedUniswapRouting(initialQuoteResponse.routing);

  const quoteResponse = requestedMinAmountOut === undefined
    ? initialQuoteResponse
    : await requoteForRequestedMinAmountOut({
        initialQuoteResponse,
        requestedMinAmountOut,
        chainId,
        tokenIn,
        tokenOut,
        amountIn,
        accountAddress,
        uniswapApiKey: apiKey,
      });

  return {
    kind: 'uniswap',
    rawQuote: quoteResponse.quote,
    tokenIn,
    tokenOut,
    apiKey,
    quote: buildUniswapTradeQuote({
      amountIn,
      quote: quoteResponse.quote,
      recipient: accountAddress,
      tokenIn,
      tokenOut,
      inputDecimals: await getTokenDecimals(publicClient, tokenIn),
      outputDecimals: await getTokenDecimals(publicClient, tokenOut),
      routing: quoteResponse.routing,
    }),
  };
}

async function resolveUniswapApiKey(params: {
  uniswapApiKey?: string;
  resolveUniswapApiKey?: RareClientConfig['resolveUniswapApiKey'];
}): Promise<string | undefined> {
  if (params.uniswapApiKey !== undefined) {
    return params.uniswapApiKey;
  }
  return params.resolveUniswapApiKey?.();
}

async function requoteForRequestedMinAmountOut(params: {
  initialQuoteResponse: UniswapQuoteResponse;
  requestedMinAmountOut: bigint;
  chainId: number;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  accountAddress: Address;
  uniswapApiKey?: string;
}): Promise<UniswapQuoteResponse> {
  const quotedAmounts = getQuotedRecipientAmount(params.initialQuoteResponse.quote, params.accountAddress);
  assertRequestedMinAmountOut(quotedAmounts.estimatedAmountOut, params.requestedMinAmountOut);

  const derivedSlippageBps = computeSlippageBpsFromAmounts(quotedAmounts.estimatedAmountOut, params.requestedMinAmountOut);
  const quoteResponse = await requestUniswapQuote({
    apiKey: params.uniswapApiKey,
    chainId: params.chainId,
    tokenIn: params.tokenIn,
    tokenOut: params.tokenOut,
    amount: params.amountIn,
    swapper: params.accountAddress,
    slippageBps: derivedSlippageBps,
  });

  const requotedAmounts = getQuotedRecipientAmount(quoteResponse.quote, params.accountAddress);
  assertRequotedMinAmountOut(requotedAmounts.minAmountOut, params.requestedMinAmountOut);
  return quoteResponse;
}

async function buildTokenTradeQuote(
  publicClient: RareClientConfig['publicClient'],
  chain: SupportedChain,
  chainId: number,
  addresses: { v4Quoter?: Address },
  accountAddress: Address | undefined,
  params: LocalTradeParams,
): Promise<TokenTradeQuoteDetails> {
  const route = params.route ?? 'auto';
  if (route !== 'uniswap') {
    const localQuote = await buildLocalTokenTradeQuote(publicClient, chain, addresses, params);
    if (localQuote.kind === 'local') {
      return localQuote;
    }
    if (route === 'local') {
      throw new Error('No canonical local route is available for this token.');
    }
  }

  if (!accountAddress) {
    throw new Error('An account is required to quote this token route via the Uniswap API.');
  }

  return buildUniswapFallbackTradeQuote(publicClient, chainId, params.token, accountAddress, params);
}

async function buildBuyRareQuote(
  publicClient: RareClientConfig['publicClient'],
  chain: SupportedChain,
  addresses: { v4Quoter?: Address },
  params: Pick<BuyRareParams, 'amountIn' | 'minAmountOut' | 'slippageBps'>,
): Promise<BuyRareQuote> {
  const rareAddress = getRareAddress(chain);
  const amountIn = requireInput(params.amountIn, 'amountIn');
  const tokenQuote = await buildLocalTokenTradeQuote(publicClient, chain, addresses, {
    direction: 'buy',
    token: rareAddress,
    amountIn,
    minAmountOut: params.minAmountOut,
    slippageBps: params.slippageBps,
  });

  if (tokenQuote.kind === 'unavailable') {
    throw new Error('Failed to build the canonical RARE route.');
  }

  return buildBuyRareQuoteFromTokenQuote(rareAddress, tokenQuote.quote);
}

async function executeRawRouterBuy(params: {
  publicClient: RareClientConfig['publicClient'];
  config: RareClientConfig;
  chain: SupportedChain;
  addresses: { swapRouter?: Address };
  token: Address;
  amountIn: AmountInput;
  minAmountOut: AmountInput;
  commands: `0x${string}`;
  inputs: readonly `0x${string}`[];
  recipient?: Address;
  deadline?: IntegerInput;
}): Promise<TransactionResult & { minAmountOut: bigint }> {
  const { walletClient, account, accountAddress } = requireWallet(params.config);
  const router = requireConfiguredAddress(params.addresses.swapRouter, 'Liquid router', params.chain);
  validateRouterPayload(params.commands, params.inputs);

  const recipient = params.recipient ?? accountAddress;
  const amountIn = requireInput(params.amountIn, 'amountIn');
  const minAmountOutInput = requireInput(params.minAmountOut, 'minAmountOut');
  const ethAmount = toWei(amountIn);
  const minTokensOut = await toTokenAmount(params.publicClient, params.token, minAmountOutInput, 'minAmountOut');
  const targetTxHash = await walletClient.writeContract({
    address: router,
    abi: liquidRouterAbi,
    functionName: 'buy',
    args: [params.token, recipient, minTokensOut, params.commands, [...params.inputs], resolveDeadline(params.deadline)],
    account,
    chain: undefined,
    value: ethAmount,
  });

  const targetReceipt = await params.publicClient.waitForTransactionReceipt({ hash: targetTxHash });
  return { txHash: targetTxHash, receipt: targetReceipt, minAmountOut: minTokensOut };
}

async function executeRawRouterSell(params: {
  publicClient: RareClientConfig['publicClient'];
  config: RareClientConfig;
  chain: SupportedChain;
  addresses: { swapRouter?: Address };
  token: Address;
  amountIn: AmountInput;
  minAmountOut: AmountInput;
  commands: `0x${string}`;
  inputs: readonly `0x${string}`[];
  recipient?: Address;
  deadline?: IntegerInput;
  autoApprove?: boolean;
}): Promise<TransactionResult & { minAmountOut: bigint; tokenAmount: bigint; approvalTxHash?: `0x${string}` }> {
  const { walletClient, account, accountAddress } = requireWallet(params.config);
  const router = requireConfiguredAddress(params.addresses.swapRouter, 'Liquid router', params.chain);
  validateRouterPayload(params.commands, params.inputs);

  const amountIn = requireInput(params.amountIn, 'amountIn');
  const minAmountOutInput = requireInput(params.minAmountOut, 'minAmountOut');
  const tokenAmount = await toTokenAmount(params.publicClient, params.token, amountIn, 'amountIn');
  const minEthOut = toWei(minAmountOutInput);

  const approvalTxHash = await ensureTokenAllowance(
    params.publicClient,
    walletClient,
    account,
    accountAddress,
    params.token,
    router,
    tokenAmount,
    params.autoApprove,
  );

  const { txHash, receipt } = await runWithApprovalSideEffectAlert({
    operation: 'swap sell',
    approvals: [{
      type: 'erc20',
      approvalTxHash,
      target: params.token,
      spender: router,
    }],
    run: async () => {
      const targetTxHash = await walletClient.writeContract({
        address: router,
        abi: liquidRouterAbi,
        functionName: 'sell',
        args: [
          params.token,
          tokenAmount,
          params.recipient ?? accountAddress,
          minEthOut,
          params.commands,
          [...params.inputs],
          resolveDeadline(params.deadline),
        ],
        account,
        chain: undefined,
      });

      const targetReceipt = await params.publicClient.waitForTransactionReceipt({ hash: targetTxHash });
      return { txHash: targetTxHash, receipt: targetReceipt };
    },
  });
  return { txHash, receipt, minAmountOut: minEthOut, tokenAmount, approvalTxHash };
}

function isRawTokenTradeParams(
  params: BuyTokenParams | SellTokenParams,
): params is TokenTradeRawRouteParams & { autoApprove?: boolean } {
  return params.route === 'raw';
}

function resolveUniswapDeadline(value: IntegerInput | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const deadline = toSafeIntegerNumber(value, 'deadline');
  if (deadline <= 0) {
    throw new Error('deadline must be greater than 0.');
  }
  return deadline;
}

export function createSwapNamespace(
  config: RareClientConfig,
  chain: SupportedChain,
  chainId: number,
  addresses: { swapRouter?: Address; v4Quoter?: Address },
): SwapNamespace {
  const { publicClient } = config;

  return {
    async buy(params): Promise<TransactionResult> {
      const result = await executeRawRouterBuy({
        publicClient,
        config,
        chain,
        addresses,
        ...params,
      });
      return { txHash: result.txHash, receipt: result.receipt };
    },

    async sell(params): Promise<TransactionResult> {
      const result = await executeRawRouterSell({
        publicClient,
        config,
        chain,
        addresses,
        ...params,
      });
      return { txHash: result.txHash, receipt: result.receipt };
    },

    async swapTokens(params): Promise<TransactionResult> {
      const { walletClient, account, accountAddress } = requireWallet(config);
      const router = requireConfiguredAddress(addresses.swapRouter, 'Liquid router', chain);
      validateRouterPayload(params.commands, params.inputs);

      const amountIn = await toTokenAmount(publicClient, params.tokenIn, params.amountIn, 'amountIn');
      const minAmountOut = await toTokenAmount(publicClient, params.tokenOut, params.minAmountOut, 'minAmountOut');

      const approvalTxHash = params.tokenIn === ETH_ADDRESS
        ? undefined
        : await ensureTokenAllowance(
            publicClient,
            walletClient,
            account,
            accountAddress,
            params.tokenIn,
            router,
            amountIn,
            params.autoApprove,
          );

      const { txHash, receipt } = await runWithApprovalSideEffectAlert({
        operation: 'swap tokens',
        approvals: [{
          type: 'erc20',
          approvalTxHash,
          target: params.tokenIn,
          spender: router,
        }],
        run: async () => {
          const targetTxHash = await walletClient.writeContract({
            address: router,
            abi: liquidRouterAbi,
            functionName: 'swap',
            args: [
              params.tokenIn,
              amountIn,
              params.tokenOut,
              params.recipient ?? accountAddress,
              minAmountOut,
              params.commands,
              [...params.inputs],
              resolveDeadline(params.deadline),
            ],
            account,
            chain: undefined,
            value: params.tokenIn === ETH_ADDRESS ? amountIn : undefined,
          });

          const targetReceipt = await publicClient.waitForTransactionReceipt({ hash: targetTxHash });
          return { txHash: targetTxHash, receipt: targetReceipt };
        },
      });
      return { txHash, receipt };
    },

    async quoteBuyToken(params: TokenTradeQuoteParams): Promise<TokenTradeQuote> {
      const localInputs = planTokenTradeLocalInputs(params);
      const quote = await buildTokenTradeQuote(
        publicClient,
        chain,
        chainId,
        addresses,
        getConfiguredAccountAddress(config),
        {
          direction: 'buy',
          token: params.token,
          amountIn: localInputs.amountIn,
          minAmountOut: localInputs.minAmountOut,
          slippageBps: localInputs.slippageBps,
          recipient: params.recipient,
          route: params.route,
          uniswapApiKey: config.uniswapApiKey,
          resolveUniswapApiKey: config.resolveUniswapApiKey,
        },
      );
      return quote.quote;
    },

    async buyToken(params): Promise<TokenTradeResult> {
      if (isRawTokenTradeParams(params)) {
        const result = await executeRawRouterBuy({
          publicClient,
          config,
          chain,
          addresses,
          token: params.token,
          amountIn: params.amountIn,
          minAmountOut: params.minAmountOut,
          commands: params.commands,
          inputs: params.inputs,
          recipient: params.recipient,
          deadline: params.deadline,
        });
        return {
          txHash: result.txHash,
          receipt: result.receipt,
          estimatedAmountOut: 0n,
          minAmountOut: result.minAmountOut,
          routeSource: 'raw',
          execution: 'raw-router',
          commands: params.commands,
          inputs: params.inputs,
        };
      }

      const localInputs = planTokenTradeLocalInputs(params);
      const { walletClient, account, accountAddress } = requireWallet(config);
      const uniswapDeadline = resolveUniswapDeadline(params.deadline);
      const quoteDetails = await buildTokenTradeQuote(publicClient, chain, chainId, addresses, accountAddress, {
        direction: 'buy',
        token: params.token,
        amountIn: localInputs.amountIn,
        minAmountOut: localInputs.minAmountOut,
        slippageBps: localInputs.slippageBps,
        recipient: params.recipient,
        route: params.route,
        uniswapApiKey: config.uniswapApiKey,
        resolveUniswapApiKey: config.resolveUniswapApiKey,
      });

      if (quoteDetails.kind === 'local') {
        const router = requireConfiguredAddress(addresses.swapRouter, 'Liquid router', chain);

        const targetTxHash = await walletClient.writeContract({
          address: router,
          abi: liquidRouterAbi,
          functionName: 'buy',
          args: [
            params.token,
            params.recipient ?? accountAddress,
            quoteDetails.quote.minAmountOut,
            quoteDetails.quote.commands,
            [...quoteDetails.quote.inputs],
            resolveDeadline(params.deadline),
          ],
          account,
          chain: undefined,
          value: quoteDetails.quote.amountIn,
        });

        const targetReceipt = await publicClient.waitForTransactionReceipt({ hash: targetTxHash });
        return {
          txHash: targetTxHash,
          receipt: targetReceipt,
          estimatedAmountOut: quoteDetails.quote.estimatedAmountOut,
          minAmountOut: quoteDetails.quote.minAmountOut,
          routeSource: quoteDetails.quote.routeSource,
          execution: quoteDetails.quote.execution,
          commands: quoteDetails.quote.commands,
          inputs: quoteDetails.quote.inputs,
        };
      }

      const swapResponse = await requestUniswapSwap({
        apiKey: quoteDetails.apiKey,
        quote: quoteDetails.rawQuote,
        deadline: uniswapDeadline,
      });
      const sent = await sendPreparedTransaction(publicClient, walletClient, account, swapResponse.swap, {
        accountAddress,
        chainId,
      });
      return {
        ...sent,
        estimatedAmountOut: quoteDetails.quote.estimatedAmountOut,
        minAmountOut: quoteDetails.quote.minAmountOut,
        routeSource: quoteDetails.quote.routeSource,
        execution: quoteDetails.quote.execution,
      };
    },

    async quoteSellToken(params: TokenTradeQuoteParams): Promise<TokenTradeQuote> {
      const localInputs = planTokenTradeLocalInputs(params);
      const quote = await buildTokenTradeQuote(
        publicClient,
        chain,
        chainId,
        addresses,
        getConfiguredAccountAddress(config),
        {
          direction: 'sell',
          token: params.token,
          amountIn: localInputs.amountIn,
          minAmountOut: localInputs.minAmountOut,
          slippageBps: localInputs.slippageBps,
          recipient: params.recipient,
          route: params.route,
          uniswapApiKey: config.uniswapApiKey,
          resolveUniswapApiKey: config.resolveUniswapApiKey,
        },
      );
      return quote.quote;
    },

    async sellToken(params): Promise<TokenTradeResult> {
      if (isRawTokenTradeParams(params)) {
        const result = await executeRawRouterSell({
          publicClient,
          config,
          chain,
          addresses,
          token: params.token,
          amountIn: params.amountIn,
          minAmountOut: params.minAmountOut,
          commands: params.commands,
          inputs: params.inputs,
          recipient: params.recipient,
          deadline: params.deadline,
          autoApprove: params.autoApprove,
        });
        return {
          txHash: result.txHash,
          receipt: result.receipt,
          estimatedAmountOut: 0n,
          minAmountOut: result.minAmountOut,
          routeSource: 'raw',
          execution: 'raw-router',
          commands: params.commands,
          inputs: params.inputs,
        };
      }

      const localInputs = planTokenTradeLocalInputs(params);
      const { walletClient, account, accountAddress } = requireWallet(config);
      const uniswapDeadline = resolveUniswapDeadline(params.deadline);
      const quoteDetails = await buildTokenTradeQuote(publicClient, chain, chainId, addresses, accountAddress, {
        direction: 'sell',
        token: params.token,
        amountIn: localInputs.amountIn,
        minAmountOut: localInputs.minAmountOut,
        slippageBps: localInputs.slippageBps,
        recipient: params.recipient,
        route: params.route,
        uniswapApiKey: config.uniswapApiKey,
        resolveUniswapApiKey: config.resolveUniswapApiKey,
      });

      if (quoteDetails.kind === 'local') {
        const router = requireConfiguredAddress(addresses.swapRouter, 'Liquid router', chain);

        const amountIn = requireInput(params.amountIn, 'amountIn');
        const tokenAmount = await toTokenAmount(publicClient, params.token, amountIn, 'amountIn');
        const approvalTxHash = await ensureTokenAllowance(
          publicClient,
          walletClient,
          account,
          accountAddress,
          params.token,
          router,
          tokenAmount,
          params.autoApprove,
        );

        const { txHash, receipt } = await runWithApprovalSideEffectAlert({
          operation: 'sell token',
          approvals: [{
            type: 'erc20',
            approvalTxHash,
            target: params.token,
            spender: router,
          }],
          run: async () => {
            const targetTxHash = await walletClient.writeContract({
              address: router,
              abi: liquidRouterAbi,
              functionName: 'sell',
              args: [
                params.token,
                tokenAmount,
                params.recipient ?? accountAddress,
                quoteDetails.quote.minAmountOut,
                quoteDetails.quote.commands,
                [...quoteDetails.quote.inputs],
                resolveDeadline(params.deadline),
              ],
              account,
              chain: undefined,
            });

            const targetReceipt = await publicClient.waitForTransactionReceipt({ hash: targetTxHash });
            return { txHash: targetTxHash, receipt: targetReceipt };
          },
        });

        return {
          txHash,
          receipt,
          estimatedAmountOut: quoteDetails.quote.estimatedAmountOut,
          minAmountOut: quoteDetails.quote.minAmountOut,
          routeSource: quoteDetails.quote.routeSource,
          execution: quoteDetails.quote.execution,
          commands: quoteDetails.quote.commands,
          inputs: quoteDetails.quote.inputs,
          approvalTxHash,
        };
      }

      const approval = await requestUniswapApproval({
        apiKey: quoteDetails.apiKey,
        chainId,
        walletAddress: accountAddress,
        token: params.token,
        amount: quoteDetails.quote.amountIn,
        tokenOut: ETH_ADDRESS,
      });
      if (params.autoApprove !== true && (approval.cancel !== null || approval.approval !== null)) {
        throw new PaymentApprovalRequiredError({
          requiredAmount: quoteDetails.quote.amountIn,
          spenderAddress: approval.approval?.to ?? approval.cancel?.to ?? params.token,
        });
      }
      const approvalResetTxHash = approval.cancel
        ? (await sendPreparedTransaction(publicClient, walletClient, account, approval.cancel, {
            accountAddress,
            chainId,
          })).txHash
        : undefined;

      const approvalTxHash = approval.approval
        ? (await sendPreparedTransaction(publicClient, walletClient, account, approval.approval, {
            accountAddress,
            chainId,
          })).txHash
        : undefined;

      const sent = await runWithApprovalSideEffectAlert({
        operation: 'sell token',
        approvals: [
          {
            type: 'erc20-reset',
            approvalTxHash: approvalResetTxHash,
            target: params.token,
            spender: approval.cancel?.to,
          },
          {
            type: 'erc20',
            approvalTxHash,
            target: params.token,
            spender: approval.approval?.to,
          },
        ],
        run: async () => {
          const swapResponse = await requestUniswapSwap({
            apiKey: quoteDetails.apiKey,
            quote: quoteDetails.rawQuote,
            deadline: uniswapDeadline,
          });
          return sendPreparedTransaction(publicClient, walletClient, account, swapResponse.swap, {
            accountAddress,
            chainId,
          });
        },
      });
      return {
        ...sent,
        estimatedAmountOut: quoteDetails.quote.estimatedAmountOut,
        minAmountOut: quoteDetails.quote.minAmountOut,
        routeSource: quoteDetails.quote.routeSource,
        execution: quoteDetails.quote.execution,
        approvalTxHash,
        approvalResetTxHash,
      };
    },

    async quoteBuyRare(params): Promise<BuyRareQuote> {
      return buildBuyRareQuote(publicClient, chain, addresses, params);
    },

    async buyRare(params): Promise<BuyRareResult> {
      const { walletClient, account, accountAddress } = requireWallet(config);
      const router = requireConfiguredAddress(addresses.swapRouter, 'Liquid router', chain);
      const quote = await buildBuyRareQuote(publicClient, chain, addresses, params);

      const targetTxHash = await walletClient.writeContract({
        address: router,
        abi: liquidRouterAbi,
        functionName: 'buy',
        args: [quote.rareAddress, params.recipient ?? accountAddress, quote.minRareOut, quote.commands, [...quote.inputs], resolveDeadline(params.deadline)],
        account,
        chain: undefined,
        value: quote.ethAmount,
      });

      const targetReceipt = await publicClient.waitForTransactionReceipt({ hash: targetTxHash });
      return {
        txHash: targetTxHash,
        receipt: targetReceipt,
        estimatedRareOut: quote.estimatedRareOut,
        minRareOut: quote.minRareOut,
        commands: quote.commands,
        inputs: quote.inputs,
      };
    },
  };
}
